require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
console.log("[env] loaded from:", require("path").resolve(".env"));
console.log("[env] ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? "found" : "NOT FOUND");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const TV_BASE  = "https://stocks.tradingvolatility.net/api/v2";
const ENV_PATH = path.resolve(".env");

let TV_API_KEY      = process.env.TV_API_KEY || "";
let ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
let TV_DEMO = (process.env.TV_DEMO || "").trim() === "1";

console.log("[config] TV_DEMO Mode:", TV_DEMO ? "Demo mode ON. Tickers limited" : "OFF (valid TV_API_KEY required)");

function isPlaceholderKey(k) {
  const v = (k || "").trim().toLowerCase();
  return (
    !v ||
    v === "your_tv_api_key_here…" ||
    v === "your_tv_api_key_here" ||
    v.endsWith("…")
  );
}

function hasRealTvKey(k) {
  return !isPlaceholderKey(k);
}

function maskKey(key) {
  if (!key) return null;
  if (key.length <= 8) return "••••••••";
  return `••••${key.slice(-3)}`;
}

function upsertEnvFile(updates) {
  let content = "";
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, "utf8");
  }

  const lines = content ? content.split(/\r?\n/) : [];
  const map = new Map();

  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map.set(m[1], m[2]);
  }

  for (const [k, v] of Object.entries(updates)) {
    map.set(k, v);
  }

  const out = Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";

  fs.writeFileSync(ENV_PATH, out, "utf8");
}

console.log(
  "[config] TV_DEMO Mode:",
  TV_DEMO ? "Demo mode ON. Tickers limited" : "OFF (valid TV_API_KEY required)"
);

// health
app.get("/", (_req, res) => {
  const tvMode = hasRealTvKey(TV_API_KEY) ? "✓ set" : "DEMO MODE";

  res.json({
    status: "ok",
    keys: {
      tv: tvMode,
      anthropic: ANTHROPIC_API_KEY ? "✓ set" : "MISSING — AI disabled",
    },
  });
});

// key status
app.get("/keys/status", (_req, res) => {

  const tvActive = hasRealTvKey(TV_API_KEY);

  res.json({
    tv: {
      active: tvActive,
      invalid: TV_API_KEY && !tvActive,
      masked: TV_API_KEY ? maskKey(TV_API_KEY) : null
    },
    anthropic: {
      active: !!ANTHROPIC_API_KEY,
      masked: ANTHROPIC_API_KEY ? maskKey(ANTHROPIC_API_KEY) : null
    }
  });
});

// save keys
app.post("/keys", async (req, res) => {
  try {
    const { tv, anthropic } = req.body || {};

    // Validate TV key
    if (tv) {
      try {
        const test = await fetch(`${TV_BASE}/tickers/AAPL`, {
          headers: { Authorization: `Bearer ${tv}` }
        });

        if (test.status !== 200) {
          return res.status(400).json({
            error: "Invalid Trading Volatility API key"
          });
        }

        TV_API_KEY = tv;
      } catch {
        return res.status(500).json({
          error: "Unable to validate Trading Volatility key"
        });
      }
    }

    if (anthropic) {
      ANTHROPIC_API_KEY = anthropic;
    }

    res.json({ ok: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Trading Volatility proxy ──────────────────────────────────────────────────
app.get("/tv/*", async (req, res) => {
  try {
    const url = `${TV_BASE}/${req.params[0]}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;

    const headers = {};
    const demoMode = TV_DEMO || isPlaceholderKey(TV_API_KEY);

  
    if (!TV_DEMO && !isPlaceholderKey(TV_API_KEY)) {
      headers.Authorization = `Bearer ${TV_API_KEY}`;
    } else {
      headers["X-TV-Demo"] = "1";
    }

    const r = await fetch(url, { headers });

    // ── Rate limit logging ───────────────────────────────
    if (r.status === 429) {
      const retry = r.headers.get("retry-after") || "unknown";

      console.warn(
        `[TV RATE LIMIT] ${demoMode ? "DEMO" : "KEY"} | ${path} | retry-after=${retry}s`
      );
    }

    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const body = ct.includes("application/json")
      ? await r.json()
      : await r.text();

    res.status(r.status);

    if (ct.includes("application/json")) {
      return res.json(body);
    }

    // normalize non-json errors
    return res.json({
      error: {
        status: r.status,
        message: typeof body === "string" ? body.slice(0, 500) : "Upstream returned non-JSON"
      }
    });

  } catch (err) {
    console.error("[TV]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Anthropic proxy ───────────────────────────────────────────────────────────
app.get("/anthropic", (_req, res) =>
  res.status(405).json({ error: "Use POST /anthropic" })
);

app.post("/anthropic", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    console.error("[Anthropic] ANTHROPIC_API_KEY is not set in .env");
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set in .env" });
  }

  console.log("[Anthropic] →", req.body?.model, "| messages:", req.body?.messages?.length);

  let r, text;
  try {
    r    = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-api-key":       ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    text = await r.text();            // read as text first so we can log on parse failure
  } catch (err) {
    console.error("[Anthropic] fetch failed:", err.message);
    return res.status(500).json({ error: `Fetch failed: ${err.message}` });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error("[Anthropic] non-JSON response (status", r.status, "):\n", text.slice(0, 400));
    return res.status(r.status).send(text);
  }

  if (data.error) {
    console.error("[Anthropic] API error:", JSON.stringify(data.error));
  } else {
    console.log("[Anthropic] ✓ response type:", data.type, "| stop_reason:", data.stop_reason);
  }

  res.status(r.status).json(data);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n✅  Proxy on http://localhost:${PORT}`);
  console.log(`    TV key:    ${TV_API_KEY ? TV_API_KEY.slice(0, 8) + "…" : "NOT SET"}`);
  console.log(`    Anthropic: ${ANTHROPIC_API_KEY ? "✓ set (" + ANTHROPIC_API_KEY.slice(0, 12) + "…)" : "NOT SET"}`);
  console.log(`    Health:    http://localhost:${PORT}/\n`);
});
