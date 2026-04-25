import * as fs from "fs";
import * as path from "path";
import { PolymarketWS } from "./PolymarketWS";
import { loadConfig, saveConfig } from "./config";
import { getDomeClient } from "@/lib/domeClient";
import { getApiKey } from "@/lib/settings";
import type {
  CycleMarket,
  LoggedTrade,
  TrackedWallet,
  LoggerStatus,
  BookLevel,
} from "./types";

function resolveGammaBase(): string {
  return getApiKey("polymarketProxyGamma") || "https://gamma-api.polymarket.com";
}
const SLUG_PREFIX = "btc-updown-5m";
const CYCLE_DURATION = 300; // 5 minutes in seconds
const PRE_SUBSCRIBE_SECONDS = 15;

// ── Orderbook CSV (1 per cycle, all levels, 300 rows) ──

interface OrderbookRow {
  second: number;
  timestamp: number;
  marketSlug: string;
  upMid: number;
  upBestBid: number;
  upBestAsk: number;
  downMid: number;
  downBestBid: number;
  downBestAsk: number;
  upBids: BookLevel[];
  upAsks: BookLevel[];
  downBids: BookLevel[];
  downAsks: BookLevel[];
}

function orderbookCsvHeader(): string {
  return [
    "second", "timestamp", "market_slug",
    "up_mid", "up_best_bid", "up_best_ask",
    "down_mid", "down_best_bid", "down_best_ask",
    "up_bids", "up_asks", "down_bids", "down_asks",
  ].join(",");
}

function levelsToJson(levels: BookLevel[]): string {
  if (levels.length === 0) return "[]";
  const json = JSON.stringify(levels.map(l => [l.price, l.size]));
  return `"${json.replace(/"/g, '""')}"`;
}

function orderbookRowToCsv(row: OrderbookRow): string {
  return [
    row.second.toString(),
    row.timestamp.toString(),
    row.marketSlug,
    row.upMid.toFixed(4),
    row.upBestBid.toFixed(4),
    row.upBestAsk.toFixed(4),
    row.downMid.toFixed(4),
    row.downBestBid.toFixed(4),
    row.downBestAsk.toFixed(4),
    levelsToJson(row.upBids),
    levelsToJson(row.upAsks),
    levelsToJson(row.downBids),
    levelsToJson(row.downAsks),
  ].join(",");
}

// ── Prices CSV (1 per cycle, UP/DOWN prices only, 300 rows) ──

interface PriceRow {
  second: number;
  timestamp: number;
  marketSlug: string;
  upMid: number;
  upBestBid: number;
  upBestAsk: number;
  downMid: number;
  downBestBid: number;
  downBestAsk: number;
}

function pricesCsvHeader(): string {
  return [
    "second", "timestamp", "market_slug",
    "up_mid", "up_best_bid", "up_best_ask",
    "down_mid", "down_best_bid", "down_best_ask",
  ].join(",");
}

function priceRowToCsv(row: PriceRow): string {
  return [
    row.second.toString(),
    row.timestamp.toString(),
    row.marketSlug,
    row.upMid.toFixed(4),
    row.upBestBid.toFixed(4),
    row.upBestAsk.toFixed(4),
    row.downMid.toFixed(4),
    row.downBestBid.toFixed(4),
    row.downBestAsk.toFixed(4),
  ].join(",");
}

// ── Trader CSV (1 per wallet per cycle, prices + trades, NO orderbook levels) ──

interface TraderRow {
  second: number;
  timestamp: number;
  marketSlug: string;
  upMid: number;
  upBestBid: number;
  upBestAsk: number;
  downMid: number;
  downBestBid: number;
  downBestAsk: number;
  trades: LoggedTrade[];
}

function traderCsvHeader(): string {
  return [
    "second", "timestamp", "market_slug",
    "up_mid", "up_best_bid", "up_best_ask",
    "down_mid", "down_best_bid", "down_best_ask",
    "trades",
  ].join(",");
}

function traderRowToCsv(row: TraderRow): string {
  const cols = [
    row.second.toString(),
    row.timestamp.toString(),
    row.marketSlug,
    row.upMid.toFixed(4),
    row.upBestBid.toFixed(4),
    row.upBestAsk.toFixed(4),
    row.downMid.toFixed(4),
    row.downBestBid.toFixed(4),
    row.downBestAsk.toFixed(4),
  ];
  if (row.trades.length > 0) {
    const tradesJson = JSON.stringify(
      row.trades.map((t) => ({
        side: t.side,
        outcome: t.outcome,
        price: t.price,
        shares: t.shares,
        cost: t.cost,
        role: t.executionRole,
      }))
    );
    cols.push(`"${tradesJson.replace(/"/g, '""')}"`);
  } else {
    cols.push("");
  }
  return cols.join(",");
}

// ── Per-cycle market data state ──

interface CycleOrderbookState {
  marketSlug: string;
  rows: OrderbookRow[];
  written: boolean;
}

// ── Per-wallet cycle state ──

interface WalletCycleState {
  walletAddress: string;
  walletLabel: string;
  marketSlug: string;
  rows: TraderRow[];
  pendingTrades: LoggedTrade[];
  domeWs: any;
  written: boolean;
}

// ── Main Service ──

export class CycleLoggerService {
  private polyWs: PolymarketWS;
  private currentMarket: CycleMarket | null = null;
  private nextMarket: CycleMarket | null = null;
  private walletStates = new Map<string, WalletCycleState>();
  // prices are now derived from orderbookState and written alongside orderbook CSV
  private orderbookState: CycleOrderbookState | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private marketPollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private secondsLogged = 0;
  private preSubscribed = false;

  constructor() {
    this.polyWs = new PolymarketWS();
  }

  get status(): LoggerStatus {
    return {
      running: this.running,
      currentCycleSlug: this.currentMarket?.slug ?? null,
      nextCycleSlug: this.nextMarket?.slug ?? null,
      walletsTracked: this.walletStates.size,
      secondsLogged: this.secondsLogged,
      polyWsConnected: this.polyWs.connected,
    };
  }

  /** Start the logging service */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log("[CycleLogger] Starting service...");

    this.polyWs.connect();
    await this.pollMarkets();
    this.marketPollTimer = setInterval(() => this.pollMarkets(), 2000);
    this.tickTimer = setInterval(() => this.tick(), 1000);
  }

  /** Stop the logging service */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    console.log("[CycleLogger] Stopping service...");

    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    if (this.marketPollTimer) { clearInterval(this.marketPollTimer); this.marketPollTimer = null; }

    // Write remaining data (prices written alongside orderbook)
    this.writeOrderbookCsv();
    for (const [, state] of this.walletStates) {
      this.writeTraderCsv(state);
      this.closeDomeWs(state);
    }
    this.walletStates.clear();

    this.polyWs.destroy();
    this.currentMarket = null;
    this.nextMarket = null;
  }

  // ── Market polling ──

  private async pollMarkets(): Promise<void> {
    try {
      const now = Date.now();
      const nowSec = Math.floor(now / 1000);
      const intervalMs = 5 * 60 * 1000;
      const roundedTime = Math.floor(now / intervalMs) * intervalMs;
      const timestamps: number[] = [];
      for (let i = -1; i < 4; i++) {
        timestamps.push(Math.floor((roundedTime + i * intervalMs) / 1000));
      }

      const markets: CycleMarket[] = [];
      for (const ts of timestamps) {
        const slug = `${SLUG_PREFIX}-${ts}`;
        try {
          const resp = await fetch(`${resolveGammaBase()}/events/slug/${slug}`, {
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok) continue;
          const data = await resp.json();
          if (data?.markets?.[0]) {
            const m = data.markets[0];
            let clobTokenIds: string[] = [];
            if (m.clobTokenIds) {
              try {
                clobTokenIds =
                  typeof m.clobTokenIds === "string"
                    ? JSON.parse(m.clobTokenIds)
                    : m.clobTokenIds;
              } catch {}
            }
            if (clobTokenIds.length >= 2) {
              markets.push({
                slug,
                clobTokenIds: [clobTokenIds[0], clobTokenIds[1]],
                startTime: ts,
                endTime: ts + CYCLE_DURATION,
              });
            }
          }
        } catch {}
      }

      const live = markets.find((m) => nowSec >= m.startTime && nowSec < m.endTime) ?? null;
      const next = markets.find((m) => m.startTime > nowSec) ?? null;

      if (live && live.slug !== this.currentMarket?.slug) {
        await this.onCycleTransition(live);
      }

      if (next && next.slug !== this.nextMarket?.slug) {
        this.nextMarket = next;
        this.preSubscribed = false;
      }

      if (
        !this.preSubscribed &&
        this.nextMarket &&
        this.currentMarket &&
        nowSec >= this.currentMarket.endTime - PRE_SUBSCRIBE_SECONDS
      ) {
        console.log("[CycleLogger] Pre-subscribing to next cycle:", this.nextMarket.slug);
        this.polyWs.subscribe([
          this.nextMarket.clobTokenIds[0],
          this.nextMarket.clobTokenIds[1],
        ]);
        this.preSubscribed = true;
      }

      if (!this.currentMarket && live) {
        this.currentMarket = live;
        this.polyWs.subscribe([live.clobTokenIds[0], live.clobTokenIds[1]]);
        this.startCycle(live);
      }
    } catch (err) {
      console.error("[CycleLogger] Market poll error:", err);
    }
  }

  private async onCycleTransition(newMarket: CycleMarket): Promise<void> {
    const oldMarket = this.currentMarket;
    console.log(
      "[CycleLogger] Cycle transition:",
      oldMarket?.slug ?? "none",
      "->",
      newMarket.slug
    );

    // Write data for old cycle
    if (oldMarket) {
      this.writeOrderbookCsv();
      for (const [, state] of this.walletStates) {
        if (state.marketSlug === oldMarket.slug) {
          this.writeTraderCsv(state);
          this.closeDomeWs(state);
        }
      }
      const newTokens = new Set(newMarket.clobTokenIds);
      const oldToUnsub = oldMarket.clobTokenIds.filter((t) => !newTokens.has(t));
      if (oldToUnsub.length > 0) this.polyWs.unsubscribe(oldToUnsub);
    }

    this.currentMarket = newMarket;
    this.preSubscribed = false;

    this.polyWs.subscribe([newMarket.clobTokenIds[0], newMarket.clobTokenIds[1]]);
    this.startCycle(newMarket);
  }

  // ── Cycle start (orderbook + wallet tracking) ──

  private startCycle(market: CycleMarket): void {
    // Start fresh orderbook log for this cycle (prices derived from it)
    this.orderbookState = {
      marketSlug: market.slug,
      rows: [],
      written: false,
    };

    // Start wallet tracking (only enabled wallets)
    const config = loadConfig();
    const activeWallets = config.wallets.filter((w) => w.enabled);
    if (activeWallets.length === 0) return;

    for (const wallet of activeWallets) {
      const key = wallet.address;
      const existing = this.walletStates.get(key);
      if (existing) {
        this.writeTraderCsv(existing);
        this.closeDomeWs(existing);
      }

      const state: WalletCycleState = {
        walletAddress: wallet.address,
        walletLabel: wallet.label,
        marketSlug: market.slug,
        rows: [],
        pendingTrades: [],
        domeWs: null,
        written: false,
      };

      this.walletStates.set(key, state);
      this.openDomeWs(state, market);
    }
  }

  private openDomeWs(state: WalletCycleState, market: CycleMarket): void {
    try {
      const dome = getDomeClient();
      const domeWs = (dome as any).polymarket.createWebSocket({
        reconnect: { enabled: true, maxAttempts: 20, delay: 1000 },
      });

      state.domeWs = domeWs;
      const walletLower = state.walletAddress.toLowerCase();
      const [upTokenId, downTokenId] = market.clobTokenIds;

      domeWs
        .connect()
        .then(() => domeWs.subscribe({ users: [state.walletAddress] }))
        .then(() => {
          console.log(
            "[CycleLogger] Dome WS connected for",
            state.walletLabel,
            "on",
            market.slug
          );
        })
        .catch((err: any) => {
          console.error("[CycleLogger] Dome WS connect error:", err?.message);
        });

      domeWs.on("order", (order: any) => {
        if (!order?.market_slug || order.market_slug !== state.marketSlug) return;
        const orderUser = (order.user || "").toLowerCase();
        const orderTaker = (order.taker || "").toLowerCase();
        if (orderUser !== walletLower && orderTaker !== walletLower) return;

        let executionRole: "TAKER" | "MAKER" | "UNKNOWN" = "UNKNOWN";
        const rawType = (
          order.type ||
          order.order_type ||
          order.orderType ||
          ""
        )
          .toString()
          .toUpperCase();
        if (rawType === "GTC" || rawType === "GTD") executionRole = "MAKER";
        else if (rawType === "FOK" || rawType === "FAK") executionRole = "TAKER";
        else if (orderTaker === walletLower) executionRole = "TAKER";
        else if (orderUser === walletLower && orderTaker !== walletLower)
          executionRole = "MAKER";

        const shares =
          order.shares_normalized ??
          order.size_matched ??
          order.original_size ??
          order.size ??
          order.shares ??
          0;
        const price = order.price ?? 0;

        let outcome: "UP" | "DOWN" | "UNKNOWN" = "UNKNOWN";
        if (order.token_id === upTokenId) outcome = "UP";
        else if (order.token_id === downTokenId) outcome = "DOWN";

        const trade: LoggedTrade = {
          id:
            order.order_id ||
            order.order_hash ||
            order.id ||
            `${order.token_id}-${Date.now()}`,
          wallet: state.walletAddress,
          side: order.side || "BUY",
          outcome,
          price,
          shares,
          cost: shares * price,
          executionRole,
          timestamp: Date.now(),
        };

        state.pendingTrades.push(trade);
        console.log(
          `[CycleLogger] Trade: ${state.walletLabel} ${trade.side} ${trade.outcome} ${trade.shares} @ ${trade.price}`
        );
      });

      domeWs.on("error", (err: any) => {
        console.error(
          `[CycleLogger] Dome WS error for ${state.walletLabel}:`,
          err?.message
        );
      });
    } catch (err: any) {
      console.error(
        `[CycleLogger] Failed to open Dome WS for ${state.walletLabel}:`,
        err?.message
      );
    }
  }

  private closeDomeWs(state: WalletCycleState): void {
    if (state.domeWs) {
      try { state.domeWs.close(); } catch {}
      state.domeWs = null;
    }
  }

  // ── Tick (1s snapshot capture) ──

  private tick(): void {
    if (!this.currentMarket) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const market = this.currentMarket;

    if (nowSec >= market.endTime) return;

    const second = nowSec - market.startTime;
    if (second < 0 || second >= CYCLE_DURATION) return;

    const [upToken, downToken] = market.clobTokenIds;
    const upPrice = this.polyWs.getPrice(upToken);
    const downPrice = this.polyWs.getPrice(downToken);
    const upBook = this.polyWs.getBook(upToken);
    const downBook = this.polyWs.getBook(downToken);

    const upMid = upPrice?.midPrice ?? 0;
    const upBestBid = upPrice?.bestBid ?? 0;
    const upBestAsk = upPrice?.bestAsk ?? 0;
    const downMid = downPrice?.midPrice ?? 0;
    const downBestBid = downPrice?.bestBid ?? 0;
    const downBestAsk = downPrice?.bestAsk ?? 0;
    const timestamp = Date.now();

    // Orderbook row — ALL levels (prices derived from this on write)
    if (this.orderbookState && this.orderbookState.marketSlug === market.slug) {
      this.orderbookState.rows.push({
        second,
        timestamp,
        marketSlug: market.slug,
        upMid, upBestBid, upBestAsk,
        downMid, downBestBid, downBestAsk,
        upBids: [...(upBook?.bids ?? [])],
        upAsks: [...(upBook?.asks ?? [])],
        downBids: [...(downBook?.bids ?? [])],
        downAsks: [...(downBook?.asks ?? [])],
      });
    }

    // Trader rows — prices + trades only, no book levels
    for (const [, state] of this.walletStates) {
      if (state.marketSlug !== market.slug) continue;

      const trades = state.pendingTrades.splice(0, state.pendingTrades.length);

      state.rows.push({
        second,
        timestamp,
        marketSlug: market.slug,
        upMid, upBestBid, upBestAsk,
        downMid, downBestBid, downBestAsk,
        trades,
      });
    }

    this.secondsLogged++;
  }

  // ── CSV writing ──

  private writeOrderbookCsv(): void {
    if (!this.orderbookState || this.orderbookState.written || this.orderbookState.rows.length === 0) return;
    this.orderbookState.written = true;

    const config = loadConfig();
    const slug = this.orderbookState.marketSlug;
    const rows = this.orderbookState.rows;

    // Write orderbook CSV
    const obDir = path.join(config.logPath, "orderbooks", slug);
    try {
      fs.mkdirSync(obDir, { recursive: true });
      const csvPath = path.join(obDir, "orderbook.csv");
      const lines = [orderbookCsvHeader(), ...rows.map(orderbookRowToCsv)];
      fs.writeFileSync(csvPath, lines.join("\n") + "\n", "utf-8");
      console.log(`[CycleLogger] Wrote ${rows.length} orderbook rows to ${csvPath}`);
    } catch (err) {
      console.error("[CycleLogger] Failed to write orderbook CSV:", err);
    }

    // Write prices CSV (derived from the same orderbook data, minus book levels)
    const pricesDir = path.join(config.logPath, "prices", slug);
    try {
      fs.mkdirSync(pricesDir, { recursive: true });
      const pricesCsvPath = path.join(pricesDir, "prices.csv");
      const priceLines = [
        pricesCsvHeader(),
        ...rows.map((r) =>
          priceRowToCsv({
            second: r.second,
            timestamp: r.timestamp,
            marketSlug: r.marketSlug,
            upMid: r.upMid,
            upBestBid: r.upBestBid,
            upBestAsk: r.upBestAsk,
            downMid: r.downMid,
            downBestBid: r.downBestBid,
            downBestAsk: r.downBestAsk,
          })
        ),
      ];
      fs.writeFileSync(pricesCsvPath, priceLines.join("\n") + "\n", "utf-8");
      console.log(`[CycleLogger] Wrote ${rows.length} price rows to ${pricesCsvPath}`);
    } catch (err) {
      console.error("[CycleLogger] Failed to write prices CSV:", err);
    }

    this.orderbookState = null;
  }

  private writeTraderCsv(state: WalletCycleState): void {
    if (state.written || state.rows.length === 0) return;
    state.written = true;

    const config = loadConfig();
    const walletDir = path.join(
      config.logPath,
      state.walletLabel || state.walletAddress.slice(0, 10)
    );
    const cycleDir = path.join(walletDir, state.marketSlug);

    try {
      fs.mkdirSync(cycleDir, { recursive: true });
      const csvPath = path.join(cycleDir, "traderactivity.csv");
      const lines = [traderCsvHeader(), ...state.rows.map(traderRowToCsv)];
      fs.writeFileSync(csvPath, lines.join("\n") + "\n", "utf-8");
      console.log(
        `[CycleLogger] Wrote ${state.rows.length} trader rows to ${csvPath}`
      );
    } catch (err) {
      console.error(
        `[CycleLogger] Failed to write trader CSV for ${state.walletLabel}:`,
        err
      );
    }
  }
}

// ── Singleton (survives Next.js hot reloads) ──

const globalKey = "__cycleLoggerService__";

export function getCycleLoggerService(): CycleLoggerService {
  const g = globalThis as any;
  if (!g[globalKey]) {
    g[globalKey] = new CycleLoggerService();
  }
  return g[globalKey];
}
