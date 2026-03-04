# Options Scanner

A real-time options market dashboard that surfaces gamma exposure, volatility structure, skew, and positioning data across multiple tickers — then lets you ask Claude AI for trade ideas and market reads, all in one place.

## What it does

Most options data tools show you raw numbers in a table. This dashboard turns that data into a scannable, visual layout so you can quickly read the tape across 8+ tickers at once:

- **Regime detection** — each ticker is tagged with its current options flow regime (hedging/overwrite, trending, explosive, pinned, rangebound) so you can instantly see where dealers are positioned
- **Expected move bands** — 1-day, 1-week, and 30-day expected move percentages pulled directly from the vol surface, not estimated
- **Gamma structure** — distance to the gamma flip level, GEX per 1% move, max gamma strike, and how much gamma expires at the nearest expiry
- **Skew** — 25-delta put/call IV ratio and spread so you can see where the market is pricing tail risk
- **Positioning** — call/put OI split with a visual bar, PCR (OI and volume), and 30-day PCR change to track smart money flow
- **AI deep dive** — click any ticker to send its full data to Claude and get a concise regime read, gamma implications, and a specific trade idea with rationale
- **AI market summary** — one button reads all loaded tickers simultaneously and returns a cross-market pulse with the top setups and key risks

---

## Platform & OS requirements

| Requirement | Details |
|---|---|
| **OS** | macOS 12+, Windows 10/11, or Linux (Ubuntu 20.04+) |
| **Node.js** | v18 or higher ([nodejs.org](https://nodejs.org)) |
| **npm** | v8+ (bundled with Node 18) |
| **Browser** | Chrome 110+, Firefox 110+, Safari 16+, or Edge 110+ |
| **Network** | Outbound HTTPS to `stocks.tradingvolatility.net` and `api.anthropic.com` |

> **Windows note:** run commands in PowerShell or Windows Terminal. Git Bash also works. Command Prompt (`cmd.exe`) is not recommended.
>
> **Node version check:** run `node -v` to confirm. If you're on an older version, use [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux) or [nvm-windows](https://github.com/coreybutler/nvm-windows) to switch.

---

## API keys required

| Key | Where to get it | Required? |
|---|---|---|
| `TV_API_KEY` | [tradingvolatility.net](https://tradingvolatility.net) | Yes — for market data |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | No — AI features disabled without it |

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure your API keys
cp .env.example .env
# Open .env in any editor and fill in your own TV_API_KEY and ANTHROPIC_API_KEY

# 3. Start everything (proxy + Vite dev server)
npm start
```

Then open **http://localhost:5173** in your browser.

---

## How it works

```
Browser (React, :5173)
    │
    ├── GET  /tv/tickers/:ticker         ──► proxy.js (:3001) ──► tradingvolatility.net
    ├── GET  /tv/tickers/:ticker/explain ──► proxy.js (:3001) ──► tradingvolatility.net
    └── POST /anthropic                  ──► proxy.js (:3001) ──► api.anthropic.com
```

The proxy (`proxy.js`) runs on port 3001 and sits between the browser and both external APIs. This means your API keys never touch the browser — they stay server-side in `.env` — and CORS is handled automatically.

---

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start proxy + Vite dev server together |
| `npm run proxy` | Start only the proxy server |
| `npm run dev` | Start only the Vite dev server |
| `npm run build` | Build for production |

---

## Project structure

```
options-scanner/
├── proxy.js                # Express proxy server (runs on :3001)
├── index.html              # HTML entry point
├── vite.config.js          # Vite config (proxies /tv and /anthropic to :3001)
├── package.json
├── .env.example            # Copy to .env and fill in your keys
└── src/
    ├── main.jsx            # React entry point
    └── OptionsScanner.jsx  # Main dashboard component
```


## Error Messages

**Error: Fetch failed: Cannot convert argument to a ByteString because the character at index 34 has a value of 8230 which is greater than 255.** Your Anthropic key is not valid. Set it in .env