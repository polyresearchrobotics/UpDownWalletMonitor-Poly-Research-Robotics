import { NextRequest } from "next/server";
import WebSocket from "ws";
import { getApiKey } from "@/lib/settings";
import { getDomeClient } from "@/lib/domeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side proxy for tracked-wallet trade events.
//
// Source priority:
//   1. Dome SDK WebSocket — only if DOME_API_KEY is set in env. Best path:
//      purpose-built for wallet subscriptions, low latency, full order
//      details (taker/maker, status, etc).
//   2. Polymarket RTDS WebSocket (`wss://ws-live-data.polymarket.com`).
//      Free firehose; Vercel datacenter IPs typically get the handshake
//      but no data due to WAF behavior, so this rarely succeeds in prod.
//   3. Polymarket `/activity?user=<addr>` REST polling. Always works as a
//      fallback when the WS goes silent or no Dome key is configured.

interface NormalizedTrade {
  id: string;
  tokenId: string;
  tokenLabel: string;
  side: "BUY" | "SELL";
  outcome: "UP" | "DOWN" | "UNKNOWN";
  price: number;
  priceCents: number;
  shares: number;
  sharesNormalized: number;
  cost: number;
  timestamp: number;
  txHash: string;
  orderHash: string;
  executionRole: "TAKER" | "MAKER" | "UNKNOWN";
  wallet: string;
  marketSlug: string;
  conditionId: string;
}

function classifyOutcome(label: string | undefined): "UP" | "DOWN" | "UNKNOWN" {
  const l = (label || "").toLowerCase();
  if (l === "up" || l === "yes") return "UP";
  if (l === "down" || l === "no") return "DOWN";
  return "UNKNOWN";
}

interface RtdsTradePayload {
  asset?: string;
  conditionId?: string;
  eventSlug?: string;
  outcome?: string;
  outcomeIndex?: number;
  price?: number;
  proxyWallet?: string;
  pseudonym?: string;
  side?: "BUY" | "SELL";
  size?: number;
  slug?: string;
  timestamp?: number;
  transactionHash?: string;
}

interface ActivityRecord {
  proxyWallet?: string;
  timestamp?: number;
  conditionId?: string;
  type?: string;
  size?: number;
  transactionHash?: string;
  price?: number;
  asset?: string;
  side?: "BUY" | "SELL";
  outcome?: string;
  slug?: string;
  eventSlug?: string;
}

function normalizeRtds(
  p: RtdsTradePayload,
  tracked: Set<string>
): NormalizedTrade | null {
  const wallet = (p.proxyWallet || "").toLowerCase();
  if (!wallet || !tracked.has(wallet)) return null;
  if (!p.asset || !p.side || p.price === undefined) return null;

  const shares = p.size ?? 0;
  const price = p.price;
  const timestamp = p.timestamp ?? Math.floor(Date.now() / 1000);
  const txHash = p.transactionHash || "";

  const id = `${p.asset}-${timestamp}-${txHash || `${wallet}-${p.side}-${price}-${shares}`}`;

  return {
    id,
    tokenId: p.asset,
    tokenLabel: p.outcome || "",
    side: p.side,
    outcome: classifyOutcome(p.outcome),
    price,
    priceCents: Math.round(price * 100),
    shares,
    sharesNormalized: shares,
    cost: shares * price,
    timestamp,
    txHash,
    orderHash: "",
    executionRole: "UNKNOWN",
    wallet,
    marketSlug: p.slug || "",
    conditionId: p.conditionId || "",
  };
}

function normalizeActivity(r: ActivityRecord): NormalizedTrade | null {
  if (r.type !== "TRADE") return null;
  const wallet = (r.proxyWallet || "").toLowerCase();
  if (!wallet || !r.asset || !r.side || r.price === undefined) return null;

  const shares = r.size ?? 0;
  const price = r.price;
  const timestamp = r.timestamp ?? Math.floor(Date.now() / 1000);
  const txHash = r.transactionHash || "";

  const id = `${r.asset}-${timestamp}-${txHash || `${wallet}-${r.side}-${price}-${shares}`}`;

  return {
    id,
    tokenId: r.asset,
    tokenLabel: r.outcome || "",
    side: r.side,
    outcome: classifyOutcome(r.outcome),
    price,
    priceCents: Math.round(price * 100),
    shares,
    sharesNormalized: shares,
    cost: shares * price,
    timestamp,
    txHash,
    orderHash: "",
    executionRole: "UNKNOWN",
    wallet,
    marketSlug: r.slug || r.eventSlug || "",
    conditionId: r.conditionId || "",
  };
}

const RTDS_URL = "wss://ws-live-data.polymarket.com";
const ACTIVITY_REST_BASE = "https://data-api.polymarket.com";
const REST_POLL_INTERVAL_MS = 2000;
const WS_BOOTSTRAP_GRACE_MS = 6000;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const walletsParam = url.searchParams.get("wallets") || "";
  const wallets = walletsParam
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

  const encoder = new TextEncoder();
  let alive = true;
  let ws: WebSocket | null = null;
  let domeWs: { close?: () => void } | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let bootstrapTimer: NodeJS.Timeout | null = null;
  let restPollTimer: NodeJS.Timeout | null = null;
  let receivedAnyTrade = false;
  let restMode = false;
  // Per-wallet "last seen trade timestamp" so REST polls only emit new
  // trades after the connection opens — match RTDS semantics where the
  // client only sees forward-moving events.
  const lastSeen = new Map<string, number>();
  const emittedIds = new Set<string>();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (!alive) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          alive = false;
        }
      };

      if (wallets.length === 0) {
        send("connected", { wallets: [], reason: "no wallets tracked" });
        heartbeatTimer = setInterval(() => send("heartbeat", { t: Date.now() }), 15000);
        return;
      }

      const tracked = new Set(wallets);
      // Seed lastSeen 60s in the past so the very first REST poll
      // backfills any trades the wallet just made. The chart's own
      // time-window cull (cycleStartTime/cycleEndTime) will hide
      // anything outside the current cycle anyway.
      const startTs = Math.floor(Date.now() / 1000) - 60;
      for (const w of wallets) lastSeen.set(w, startTs);

      // Tell the client we're alive RIGHT AWAY so the Connections panel
      // shows "Wallet Stream: LIVE" within 100ms of opening the SSE.
      // Without this the panel flickers OFFLINE for up to 6 seconds while
      // the server tries Dome and (silently failed) Polymarket WS before
      // falling back to REST polling. Subsequent transport-specific
      // `connected` events from each backend are treated as no-ops
      // client-side (idempotent setIsStreaming(true)).
      send("connected", { wallets, transport: "init" });

      // Dome SDK path — fires when DOME_API_KEY is configured. This is
      // the most reliable source: a wallet-targeted WS designed for
      // exactly this use case. We still keep the REST fallback wired up
      // so visitors who don't pay for Dome see something.
      function startDomeStream() {
        const key = getApiKey("domeApiKey");
        if (!key) return false;
        try {
          const dome = getDomeClient();
          // The SDK exposes polymarket.createWebSocket; types are loose
          // because the SDK ships limited TS coverage.
          const ws = (dome as { polymarket: { createWebSocket: (cfg: unknown) => unknown } })
            .polymarket.createWebSocket({
              reconnect: { enabled: true, maxAttempts: Infinity, delay: 1000 },
            }) as {
              connect: () => Promise<void>;
              subscribe: (cfg: { users: string[] }) => Promise<unknown>;
              on: (event: string, cb: (data: unknown) => void) => void;
              close: () => void;
            };
          domeWs = ws;

          (async () => {
            try {
              await ws.connect();
              await ws.subscribe({ users: wallets });
              send("connected", { wallets, transport: "dome" });

              ws.on("order", (raw: unknown) => {
                if (!alive) return;
                const order = raw as Record<string, unknown>;
                const orderUser = String(order.user || "").toLowerCase();
                const orderTaker = String(order.taker || "").toLowerCase();
                const wallet =
                  tracked.has(orderUser) ? orderUser :
                  tracked.has(orderTaker) ? orderTaker : "";
                if (!wallet) return;

                const tokenId = String(order.token_id || "");
                const side = (order.side as "BUY" | "SELL") || "BUY";
                const price = Number(order.price ?? 0);
                const shares = Number(order.shares ?? order.size_matched ?? 0);
                const sharesNorm = Number(
                  order.shares_normalized ?? order.size_matched ?? order.size ?? shares
                );
                const ts = Math.floor(Date.now() / 1000);
                const txHash = String(order.tx_hash || "");
                const orderHash = String(order.order_hash || "");
                const id =
                  String(order.order_id || orderHash) ||
                  `${tokenId}-${ts}-${wallet}-${side}-${price}-${shares}`;

                if (emittedIds.has(id)) return;
                emittedIds.add(id);
                receivedAnyTrade = true;

                const tokenLabel = String(order.token_label || "");
                send("trade", {
                  id,
                  tokenId,
                  tokenLabel,
                  side,
                  outcome: classifyOutcome(tokenLabel),
                  price,
                  priceCents: Math.round(price * 100),
                  shares,
                  sharesNormalized: sharesNorm,
                  cost: sharesNorm * price,
                  timestamp: ts,
                  txHash,
                  orderHash,
                  executionRole: orderTaker === wallet ? "TAKER" : "MAKER",
                  wallet,
                  marketSlug: String(order.market_slug || ""),
                  conditionId: String(order.condition_id || ""),
                });
              });

              ws.on("close", () => {
                // Don't emit `disconnected` here — REST polling kicks in
                // automatically and keeps trades flowing. Telling the
                // client we're disconnected just makes the Connections
                // panel flicker OFFLINE.
              });
              ws.on("error", (err: unknown) => {
                send("error", { message: (err as { message?: string })?.message || "Dome WS error", source: "dome" });
              });
            } catch (err) {
              send("error", { message: (err as { message?: string })?.message || "Dome connect failed", source: "dome" });
            }
          })();
          return true;
        } catch {
          return false;
        }
      }
      const domeStarted = startDomeStream();

      async function pollWallet(wallet: string) {
        if (!alive) return;
        try {
          const resp = await fetch(
            `${ACTIVITY_REST_BASE}/activity?user=${encodeURIComponent(wallet)}&limit=50`,
            { headers: { Accept: "application/json" }, cache: "no-store" }
          );
          if (!resp.ok) return;
          const records = (await resp.json()) as ActivityRecord[];
          if (!Array.isArray(records) || records.length === 0) return;

          const since = lastSeen.get(wallet) ?? startTs;
          // Sort ascending by timestamp so we emit in order.
          const fresh = records
            .filter((r) => r.type === "TRADE" && (r.timestamp ?? 0) > since)
            .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

          if (fresh.length === 0) return;

          for (const r of fresh) {
            const normalized = normalizeActivity(r);
            if (!normalized) continue;
            if (emittedIds.has(normalized.id)) continue;
            emittedIds.add(normalized.id);
            send("trade", normalized);
            const ts = r.timestamp ?? 0;
            if (ts > (lastSeen.get(wallet) ?? 0)) lastSeen.set(wallet, ts);
          }
        } catch {}
      }

      async function pollAll() {
        await Promise.all(wallets.map(pollWallet));
      }

      function startRestFallback() {
        if (restMode) return;
        restMode = true;
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        try { ws?.close(); } catch {}
        ws = null;

        send("fallback", { mode: "rest", reason: "no ws trade events in grace period" });
        send("connected", { wallets, transport: "rest" });

        pollAll();
        restPollTimer = setInterval(pollAll, REST_POLL_INTERVAL_MS);
      }

      function connect() {
        if (!alive || restMode) return;
        const socket = new WebSocket(RTDS_URL);
        ws = socket;

        socket.on("open", () => {
          if (!alive) { try { socket.close(); } catch {} return; }
          try {
            socket.send(
              JSON.stringify({
                action: "subscribe",
                subscriptions: [{ topic: "activity", type: "trades" }],
              })
            );
            socket.send("ping");
          } catch {}
          pingTimer = setInterval(() => {
            try { socket.send("ping"); } catch {}
          }, 30000);
          send("connected", { wallets });
        });

        socket.on("message", (raw) => {
          if (!alive) return;
          const txt = raw.toString();
          if (txt === "pong" || txt.length === 0) return;
          try {
            const msg = JSON.parse(txt);
            if (msg?.topic !== "activity" || msg?.type !== "trades") return;
            const normalized = normalizeRtds(
              (msg.payload || {}) as RtdsTradePayload,
              tracked
            );
            if (normalized) {
              receivedAnyTrade = true;
              if (!emittedIds.has(normalized.id)) {
                emittedIds.add(normalized.id);
                send("trade", normalized);
              }
            }
          } catch {}
        });

        socket.on("error", (err) => {
          send("error", { message: (err as Error)?.message || "RTDS WS error" });
        });

        socket.on("close", () => {
          if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
          if (!alive || restMode) return;
          // Suppress disconnect chatter during the bootstrap window — we
          // may be about to fall back to REST and don't want the panel
          // flickering offline.
          if (receivedAnyTrade) {
            send("disconnected", { ts: Date.now() });
          }
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 2000);
        });
      }

      // If Dome is wired, we still attempt the public Polymarket WS as a
      // secondary source (some wallets/markets have edge cases). If Dome
      // ISN'T wired, this is the only WS path before REST polling kicks in.
      if (!domeStarted) {
        connect();
      }
      heartbeatTimer = setInterval(() => send("heartbeat", { t: Date.now() }), 15000);

      // Always arm the REST fallback. With Dome running, REST polling
      // is redundant and bootstraps only if Dome fails to deliver in
      // the grace window. Without Dome, this is the primary path after
      // the public WS proves silent.
      bootstrapTimer = setTimeout(() => {
        if (!receivedAnyTrade && !restMode) {
          startRestFallback();
        }
      }, WS_BOOTSTRAP_GRACE_MS);
    },
    cancel() {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (bootstrapTimer) clearTimeout(bootstrapTimer);
      if (restPollTimer) clearInterval(restPollTimer);
      try { ws?.close(); } catch {}
      try { domeWs?.close?.(); } catch {}
    },
  });

  request.signal.addEventListener("abort", () => {
    alive = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (bootstrapTimer) clearTimeout(bootstrapTimer);
    if (restPollTimer) clearInterval(restPollTimer);
    try { ws?.close(); } catch {}
    try { domeWs?.close?.(); } catch {}
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
