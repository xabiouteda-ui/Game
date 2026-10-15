// Vice Run server: serves the site and keeps a verified leaderboard.
// Every score is checked by replaying the run's inputs with the same game code.
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const Core = require("./public/game-core.js");

const PORT = process.env.PORT || 3000;
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "600kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m" }));

// ---------- Storage: Postgres if DATABASE_URL is set, otherwise a local JSON file ----------
let store;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
  store = {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS vr_scores (
        handle TEXT PRIMARY KEY,
        display TEXT NOT NULL,
        score INTEGER NOT NULL,
        kills INTEGER NOT NULL,
        ticks INTEGER NOT NULL,
        seed BIGINT NOT NULL,
        inputs JSONB NOT NULL,
        ip TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    },
    async top(n) {
      const r = await pool.query("SELECT display, score, kills, updated_at FROM vr_scores ORDER BY score DESC, updated_at ASC LIMIT $1", [n]);
      return r.rows.map((x) => ({ handle: x.display, score: x.score, kills: x.kills, at: x.updated_at }));
    },
    async submit(e) {
      const r = await pool.query(
        `INSERT INTO vr_scores (handle, display, score, kills, ticks, seed, inputs, ip, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT (handle) DO UPDATE SET display=EXCLUDED.display, score=EXCLUDED.score, kills=EXCLUDED.kills,
           ticks=EXCLUDED.ticks, seed=EXCLUDED.seed, inputs=EXCLUDED.inputs, ip=EXCLUDED.ip, updated_at=now()
         WHERE EXCLUDED.score > vr_scores.score
         RETURNING score`,
        [e.handle, e.display, e.score, e.kills, e.ticks, e.seed, JSON.stringify(e.inputs), e.ip]
      );
      const best = r.rowCount ? e.score : (await pool.query("SELECT score FROM vr_scores WHERE handle=$1", [e.handle])).rows[0].score;
      const rank = (await pool.query("SELECT COUNT(*)::int AS c FROM vr_scores WHERE score > $1", [best])).rows[0].c + 1;
      return { improved: r.rowCount > 0, best, rank };
    },
  };
} else {
  const file = path.join(__dirname, "data", "scores.json");
  let rows = {};
  const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(rows)); };
  store = {
    async init() { try { rows = JSON.parse(fs.readFileSync(file, "utf8")); } catch { rows = {}; } console.log("No DATABASE_URL: saving to data/scores.json (testing only)"); },
    async top(n) {
      return Object.values(rows).sort((a, b) => b.score - a.score || a.at - b.at).slice(0, n)
        .map((x) => ({ handle: x.display, score: x.score, kills: x.kills, at: new Date(x.at) }));
    },
    async submit(e) {
      const cur = rows[e.handle];
      const improved = !cur || e.score > cur.score;
      if (improved) { rows[e.handle] = { ...e, at: Date.now() }; save(); }
      const best = rows[e.handle].score;
      const rank = Object.values(rows).filter((x) => x.score > best).length + 1;
      return { improved, best, rank };
    },
  };
}

// ---------- Runs: the server hands out the seed, so a run can only be verified once ----------
const runs = new Map(); // token -> { seed, started, ip }
setInterval(() => {
  const cutoff = Date.now() - 50 * 60 * 1000;
  for (const [k, v] of runs) if (v.started < cutoff) runs.delete(k);
}, 60 * 1000).unref();

// ---------- Simple per-IP rate limiting ----------
const hits = new Map();
function limited(ip, key, max) {
  const now = Date.now(), k = key + "|" + ip;
  const arr = (hits.get(k) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

const HANDLE_RE = /^@?([A-Za-z0-9_]{1,15})$/;

app.post("/api/start", (req, res) => {
  if (limited(req.ip, "start", 40)) return res.status(429).json({ error: "Too many runs in a row. Wait a minute." });
  if (runs.size > 50000) return res.status(503).json({ error: "Server busy, try again in a moment." });
  const token = crypto.randomBytes(16).toString("hex");
  const seed = crypto.randomBytes(4).readUInt32BE(0);
  runs.set(token, { seed, started: Date.now(), ip: req.ip });
  res.json({ token, seed });
});

app.post("/api/score", async (req, res) => {
  try {
    if (limited(req.ip, "score", 15)) return res.status(429).json({ error: "Too many submissions. Wait a minute." });
    const { token, handle, inputs, ticks, score } = req.body || {};
    const m = typeof handle === "string" && handle.trim().match(HANDLE_RE);
    if (!m) return res.status(400).json({ error: "Enter your X handle, e.g. @yourhandle (letters, numbers and _ only)." });
    const run = typeof token === "string" && runs.get(token);
    if (!run) return res.status(400).json({ error: "This run is no longer valid. Play another one and save it when you finish." });
    if (!Array.isArray(inputs) || inputs.length > 40000) return res.status(400).json({ error: "Invalid run." });
    for (const x of inputs) {
      if (!Array.isArray(x) || x.length !== 2 || !Number.isInteger(x[0]) || x[0] < 0 || (x[1] !== "j" && x[1] !== "r" && x[1] !== "s"))
        return res.status(400).json({ error: "Invalid run." });
    }
    // The run can't be faster than real time (with a small allowance for timer drift).
    const elapsedTicks = ((Date.now() - run.started) / 1000) * Core.TICKS_PER_SEC;
    const result = Core.replay(run.seed, inputs);
    if (!result.valid || result.ticks !== ticks || result.score !== score || result.ticks > elapsedTicks * 1.05 + 30) {
      runs.delete(token);
      return res.status(400).json({ error: "We couldn't verify this run, so it won't enter the leaderboard." });
    }
    runs.delete(token);
    const out = await store.submit({
      handle: m[1].toLowerCase(), display: "@" + m[1], score: result.score, kills: result.kills,
      ticks: result.ticks, seed: run.seed, inputs, ip: req.ip,
    });
    topCache.at = 0;
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Couldn't save. Try again." });
  }
});

let topCache = { at: 0, data: [] };
app.get("/api/top", async (req, res) => {
  try {
    if (Date.now() - topCache.at > 3000) topCache = { at: Date.now(), data: await store.top(20) };
    res.set("Cache-Control", "no-store").json(topCache.data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "ranking_unavailable" });
  }
});

app.get("/healthz", (req, res) => res.send("ok"));

store.init().then(() => app.listen(PORT, () => console.log("Vice Run en http://localhost:" + PORT)));
