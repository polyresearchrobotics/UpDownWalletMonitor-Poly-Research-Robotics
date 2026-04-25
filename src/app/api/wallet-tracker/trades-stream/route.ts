import { NextRequest } from "next/server";
import WebSocket from "ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Normalized shape sent to the browser; matches the WalletTrade type the
// chart consumes.
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

// Polymarket Real-Time Data Socket (RTDS) trade payload.
// https://github.com/Polymarket/real-time-data-client
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

function normalize(
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

  // Stable id. When txHash is absent we compose a deterministic key from
  // the trade fields instead of Math.random() — the old random fallback
  // broke client-side deduping on reconnect (every replay minted fresh
  // ids), causing the same trade to plot twice on the chart.
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
  let reconnectTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let pingTimer: NodeJS.Timeout | null = null;

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

      // Polymarket RTDS firehose. Server-side filters are broken (GH #34), so
      // we subscribe to all trades and filter client-side by proxyWallet.
      function connect() {
        if (!alive) return;
        const socket = new WebSocket("wss://ws-live-data.polymarket.com");
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
          // 30s ping matches Polymarket RTDS keep-alive. The prior 5s
          // cadence generated ~12x the outbound traffic with no benefit.
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
            const normalized = normalize(
              (msg.payload || {}) as RtdsTradePayload,
              tracked
            );
            if (normalized) send("trade", normalized);
          } catch {}
        });

        socket.on("error", (err) => {
          send("error", { message: (err as Error)?.message || "RTDS WS error" });
        });

        socket.on("close", () => {
          if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
          if (!alive) return;
          send("disconnected", { ts: Date.now() });
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 2000);
        });
      }

      connect();
      heartbeatTimer = setInterval(() => send("heartbeat", { t: Date.now() }), 15000);
    },
    cancel() {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (pingTimer) clearInterval(pingTimer);
      try { ws?.close(); } catch {}
    },
  });

  request.signal.addEventListener("abort", () => {
    alive = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pingTimer) clearInterval(pingTimer);
    try { ws?.close(); } catch {}
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
