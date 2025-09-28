// server/server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

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

// Cache simples em memória
const cache = new Map();
const CACHE_TTL_MS =
  (process.env.CACHE_TTL_MINUTES ? Number(process.env.CACHE_TTL_MINUTES) : 10) *
  60 *
  1000;

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}
function setCache(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

app.get("/api/github-contributions/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const today = new Date();
    const to = req.query.to ? new Date(req.query.to) : today;
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(new Date(to).setFullYear(to.getFullYear() - 1));

    const fromISO = new Date(from).toISOString();
    const toISO = new Date(to).toISOString();
    const cacheKey = `${username}:${fromISO}:${toISO}`;

    const cached = getCache(cacheKey);
    if (cached) return res.json({ days: cached, cached: true });

    if (!GITHUB_TOKEN) {
      return res
        .status(500)
        .json({ error: "GITHUB_TOKEN não configurado no servidor." });
    }

    const body = {
      query: GRAPHQL_QUERY,
      variables: { login: username, from: fromISO, to: toISO },
    };

    const ghRes = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "User-Agent": "github-calendar-proxy",
      },
      body: JSON.stringify(body),
    });

    if (!ghRes.ok) {
      const txt = await ghRes.text();
      return res.status(ghRes.status).send(txt);
    }

    const json = await ghRes.json();
    if (json.errors && json.errors.length) {
      return res
        .status(500)
        .json({ error: "Erro do GitHub GraphQL", details: json.errors });
    }

    const weeks =
      json.data.user.contributionsCollection.contributionCalendar.weeks;
    const days = [];
    weeks.forEach((w) => {
      w.contributionDays.forEach((d) =>
        days.push({ date: d.date, count: d.contributionCount })
      );
    });

    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    setCache(cacheKey, days);
    return res.json({ days, cached: false });
  } catch (err) {
    console.error("Erro no proxy:", err);
    return res
      .status(500)
      .json({ error: "Erro interno no servidor", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(
    `Proxy GraphQL rodando em http://127.0.0.1:${PORT}/api/github-contributions`
  );
});
