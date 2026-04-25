# Wallet Tracker — Polymarket Real-Time Monitor

A live market monitor and wallet tracker for Polymarket's up/down cycle markets.
Stitches together Binance spot/futures, Chainlink, and Polymarket price feeds
into one synchronized chart, plots any tracked wallet's trades as they happen,
and can log every cycle to CSV for later analysis.

---

## 1. Requirements

| What | Version |
|---|---|
| **Node.js** | 22 or newer (tested on 22.16) |
| **npm** | 10 or newer (ships with Node 22) |
| **macOS / Linux / Windows** | Any (macOS recommended — some file-picker features use the system dialog) |
| **Disk space** | ~500 MB for dependencies + whatever you want for CSV logs |
| **Network** | Outbound WebSocket + HTTPS to `polymarket.com`, `binance.com`, `chain.link` |

No database required. Price feeds, orderbooks, and the live trade stream
all work out of the box with no API keys — Polymarket, Binance, and the
Polymarket Real-Time Data Socket are public. A **Dome API key** (free tier
at [domeapi.io](https://domeapi.io)) is only needed if you want to record
tracked-wallet trades to CSV via the Cycle Logger.

---

## 2. Installation

```bash
# 1. Clone the project
git clone <your-fork-or-this-repo-url> wallet-tracker
cd wallet-tracker

# 2. Install dependencies
npm install

# 3. (Optional) Seed environment variables
cp .env.example .env.local
# …then edit .env.local if you want to bake in any keys.
# You can also skip this and configure keys from the Settings UI at runtime.
```

The install pulls Next.js 15, React 19, and a few WebSocket clients.
First run takes 1–2 minutes; subsequent runs are instant.

---

## 3. Running

```bash
npm run dev
```

This starts the dev server on **http://localhost:3030**. Open that URL in any
modern browser (Chrome, Safari, Firefox, Edge).

When you're done, press **Ctrl+C** in the terminal to stop.

### If `npm run dev` does nothing

The most common cause is a leftover Next.js process holding port 3030. Check
and kill it:

```bash
lsof -tiTCP:3030 -sTCP:LISTEN | xargs kill
npm run dev
```

### If you see `ENOENT: uv_cwd`

The terminal's cached working directory is stale (usually after a volume
unmount/remount). Just `cd` back into the project directory:

```bash
cd /path/to/wallet-tracker
```

---

## 4. First-Time Setup (in the UI)

### 4.1 Settings page

Navigate to **Settings** in the top nav. There are three groups:

**Dome API** *(required for wallet trade logging)*
Used to stream tracked-wallet trades via the Polymarket/Dome bridge and
to log them to CSV.
- **Dome API Key** — from [domeapi.io](https://domeapi.io)

**Chainlink Data Streams** *(optional)*
Fills in a Chainlink-backed BTC price card on the Indicators page. If you
don't care about the Chainlink oracle price alongside Binance, skip this.
- **Chainlink API Key** — from [chain.link/data-streams](https://chain.link/data-streams)
- **Chainlink User Secret** — paired signing secret

**Endpoints** *(optional)*
Override the default Polymarket URLs if you're routing through a proxy.
Leave blank to use Polymarket's public endpoints.

Click **Save changes** after entering any keys. Anything you set here is
stored locally at `~/.wallettracker/config/settings.json` — never sent to
a remote server, never committed to git.

### 4.2 Tracked Wallets

Still on the Settings page, scroll down to **Tracked Wallets**.

1. Paste a Polymarket trader's wallet address (`0x…`)
2. Give them a label (e.g. "Degen Mike")
3. Click **Add wallet**

You can track up to **10 wallets**. Use the **On** / **Off** toggle on each
wallet to choose which trader's activity is plotted on the chart (only one is
active at a time).

### 4.3 Log Output *(only needed if you plan to log cycles)*

At the bottom of Settings, set **Log Output** to a folder where the cycle
logger should write CSVs. Pick any folder **outside** the project directory
(Next.js hot-reloads if you write inside the source tree).

Good defaults:
- macOS: `/Users/you/Documents/wallet-tracker-logs`
- Windows: `C:\Users\you\Documents\wallet-tracker-logs`

You can also click **Browse** to open a system folder picker.

---

## 5. Using the App

### Indicators page (home)

This is the live monitor. You'll see:

- **Status pills** at the top — green when each feed is connected.
- **Price cards** — Binance Spot, Binance Futures, Chainlink, UP/DOWN share prices.
- **Market selector** — pick the asset (BTC / ETH / SOL / XRP) and timeframe (5m / 15m).
- **Cycle info** — current cycle slug, spot/futures spread, progress bar.
- **Chart** — the live overlay. X-axis is the cycle; Y-axis is price.
  - Blue = Binance Spot, Violet = Futures, Amber = Chainlink.
  - Green = UP share price, Red = DOWN share price.
  - Orange/pink markers = trades from the active tracked wallet.
  - Scroll to zoom the price range.
- **Orderbooks** — 10 levels of UP and DOWN book, updated in real time.

### Market Log page

A live feed of every new trade tick on the currently selected market —
useful for watching order flow without the chart noise.

### Cycle Logger (on Indicators)

The **Cycle Logger** panel controls CSV logging. Before starting:
1. Make sure at least one wallet is tracked.
2. Make sure a log folder is set (Settings → Log Output).

Click **Start logger**. While running, every 5-minute cycle produces three files:
- `orderbooks/{cycle}/orderbook.csv` — 300 rows, full order book every second.
- `prices/{cycle}/prices.csv` — 300 rows, prices only (slim version).
- `{wallet-label}/{cycle}/traderactivity.csv` — the tracked wallet's trades
  alongside per-second prices.

Click **Stop logger** to halt. Files are flushed to disk on stop.

---

## 6. How trade tracking works (no API key needed)

The app subscribes to Polymarket's **Real-Time Data Socket** (free, public,
no authentication) and filters every trade by the wallets you've configured.
This means:

- Add a wallet → its trades appear on the chart within a second of hitting the chain.
- You can track anyone — no permission needed from the wallet owner.
- Works entirely through the browser and localhost, no external services.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Links in the top nav don't navigate | Hard-reload the page (Cmd+Shift+R / Ctrl+Shift+R). Usually caused by a stale dev bundle after code changes. |
| `npm run dev` exits immediately with `EADDRINUSE` | Port 3030 is held by a zombie process. Run `lsof -tiTCP:3030 -sTCP:LISTEN \| xargs kill`. |
| `ENOENT: uv_cwd` in terminal | Shell's cached working directory is stale. `cd` back into the project. |
| "Wallet Stream" pill red | No tracked wallet is toggled on. Go to Settings and toggle one. |
| Chart shows "Waiting for next cycle" | Polymarket's upcoming cycle slug hasn't been published yet; it'll populate within ~5 seconds. |
| Cycle logger won't start | Check that (a) at least one wallet is tracked and (b) a Log Output folder is set. |

---

## 8. File layout (for the curious)

```
src/
  app/
    indicators/         — live monitor page (the home page)
    market-log/         — live trade feed page
    settings/           — credentials + wallets + log-path UI
    api/
      crypto/           — Binance / Chainlink / 5m-markets endpoints
      polymarket/       — CLOB book fetcher
      wallet-tracker/
        trades-stream/  — Polymarket RTDS bridge (SSE → browser)
      cycle-logger/     — start/stop/config endpoints for the logger
      settings/         — read/write credentials
  components/
    indicators/         — chart + cycle-logger panel + market selector
    nav/                — top navigation
  hooks/                — Binance / Chainlink / wallet-stream / book WS
  lib/
    cycleLogger/        — the CSV-writing service
    settings.ts         — credentials schema + storage
public/
  logo.png              — the brand logo in the nav
```

User data is stored in `~/.wallettracker/`:
- `config/settings.json` — your saved API keys
- `config/config.json` — tracked wallets + log path

Nothing is synced to a remote server. Everything runs locally.

---

## 9. Building for production

```bash
npm run build
npm run start
```

Production server runs on port 3030 by default. Set `PORT=4000` in front of
the command to change.

---

## 10. Getting help

- Check the **Troubleshooting** table above first.
- Open the browser DevTools Console — most client-side errors surface there with a useful stack trace.
- Check the terminal running `npm run dev` — server-side errors print there.
