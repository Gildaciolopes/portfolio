// netlify/functions/github-contributions.js
// Função Netlify para retornar contributionCalendar via GitHub GraphQL (com semanas iniciando no domingo)

export async function handler(event) {
  try {
    const username =
      (event.pathParameters && event.pathParameters.username) ||
      (event.queryStringParameters && event.queryStringParameters.username) ||
      (event.queryStringParameters && event.queryStringParameters.user) ||
      (event.path && event.path.split("/").pop());

    if (!username) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "username é obrigatório na rota ou como query param.",
        }),
      };
    }

    // Datas: de um ano atrás até hoje (pode ser sobrescrito via query params `from` e `to`)
    const today = new Date();
    const toISO =
      (event.queryStringParameters && event.queryStringParameters.to) ||
      today.toISOString();
    const fromISO =
      (event.queryStringParameters && event.queryStringParameters.from) ||
      new Date(
        new Date(toISO).setFullYear(new Date(toISO).getFullYear() - 1)
      ).toISOString();

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    if (!GITHUB_TOKEN) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "GITHUB_TOKEN não configurado no ambiente.",
        }),
      };
    }

    const GRAPHQL_QUERY = `
      query($login:String!, $from:DateTime!, $to:DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              weeks {
                contributionDays {
                  date
                  contributionCount
                }
              }
            }
          }
        }
      }
    `;

    const body = {
      query: GRAPHQL_QUERY,
      variables: { login: username, from: fromISO, to: toISO },
    };

    const ghRes = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "User-Agent": "netlify-github-calendar",
      },
      body: JSON.stringify(body),
    });

    if (!ghRes.ok) {
      const txt = await ghRes.text();
      return {
        statusCode: ghRes.status,
        headers: {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
        },
        body: `GitHub GraphQL error: ${txt}`,
      };
    }

    const json = await ghRes.json();
    if (json.errors && json.errors.length) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "Erro do GitHub GraphQL",
          details: json.errors,
        }),
      };
    }

    const weeks =
      json.data.user.contributionsCollection.contributionCalendar.weeks;

    // Reorganizar em formato [ [domingo..sábado], [domingo..sábado], ... ]
    const calendar = weeks.map((week) => {
      const days = [...week.contributionDays];
      // Garantir que o array tenha 7 dias (GraphQL já devolve domingo → sábado, mas vamos reforçar)
      if (days.length < 7) {
        const missing = 7 - days.length;
        for (let i = 0; i < missing; i++) {
          days.push({ date: null, contributionCount: 0 });
        }
      }
      return days;
    });

    const CACHE_TTL_SECONDS = process.env.CACHE_TTL_SECONDS
      ? Number(process.env.CACHE_TTL_SECONDS)
      : 600; // 10 min

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
      },
      body: JSON.stringify({ calendar }),
    };
  } catch (err) {
    console.error("Error in function:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Erro interno na função",
        details: err.message,
      }),
    };
  }
}
