import { NextRequest } from "next/server";
import WebSocket from "ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side proxy for Polymarket orderbook data. Mirrors the architecture
// of `/api/wallet-tracker/trades-stream` — the browser opens an EventSource
// here, this route fans the upstream data out as SSE events.
//
// We try Polymarket's CLOB market WebSocket first
// (`wss://ws-subscriptions-clob.polymarket.com/ws/market`), which delivers
// `book` / `price_change` / `last_trade_price` events in real time. If the
// WS fails to deliver any book events within ~6s (Vercel's datacenter
// egress is sometimes throttled by Polymarket's edge — connection holds but
// no data flows), we fall back to a server-side REST polling loop against
// the CLOB `/book` endpoint and synthesize equivalent `book` events. The
// browser sees the same SSE event names either way.

const POLYMARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const CLOB_REST_BASE = "https://clob.polymarket.com";
const PING_INTERVAL_MS = 10_000;
const WS_BOOTSTRAP_GRACE_MS = 6000;
const REST_POLL_INTERVAL_MS = 1500;

interface RawLevel { price?: string; size?: string }
interface RestBook {
  asset_id?: string;
  market?: string;
  timestamp?: string;
  bids?: RawLevel[];
  asks?: RawLevel[];
  buys?: RawLevel[];
  sells?: RawLevel[];
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenIdsParam = url.searchParams.get("tokenIds") || "";
  const tokenIds = tokenIdsParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const encoder = new TextEncoder();
  let alive = true;
  let ws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let bootstrapTimer: NodeJS.Timeout | null = null;
  let restPollTimer: NodeJS.Timeout | null = null;
  let receivedAnyBook = false;
  let restMode = false;

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

      if (tokenIds.length === 0) {
        send("connected", { tokenIds: [], reason: "no token ids" });
        heartbeatTimer = setInterval(() => send("heartbeat", { t: Date.now() }), 15000);
        return;
      }

      // Polymarket's CLOB returns bids/asks in ascending price order
      // (worst-bid first) for both WS book events and REST `/book`
      // responses. The browser hook expects [0] to be the best level
      // (highest bid, lowest ask), so we normalize once on the server.
      const sortBook = <T extends { price?: string }>(
        bids: T[] | undefined,
        asks: T[] | undefined
      ): { bids: T[]; asks: T[] } => ({
        bids: (bids || [])
          .slice()
          .sort((a, b) => parseFloat(b.price ?? "0") - parseFloat(a.price ?? "0")),
        asks: (asks || [])
          .slice()
          .sort((a, b) => parseFloat(a.price ?? "0") - parseFloat(b.price ?? "0")),
      });

      // Forward upstream WS messages. Polymarket emits a single object
      // per message but is documented to occasionally batch as an array
      // — handle both shapes.
      const forwardWs = (msg: unknown) => {
        if (!msg || typeof msg !== "object") return;
        const m = msg as {
          event_type?: string;
          bids?: { price?: string }[];
          asks?: { price?: string }[];
          buys?: { price?: string }[];
          sells?: { price?: string }[];
        };
        const eventType = m.event_type;
        if (eventType === "book") {
          receivedAnyBook = true;
          const sorted = sortBook(m.bids || m.buys, m.asks || m.sells);
          send("book", { ...m, bids: sorted.bids, asks: sorted.asks, buys: sorted.bids, sells: sorted.asks });
        } else if (eventType === "price_change" || eventType === "last_trade_price") {
          send(eventType, m);
        }
      };

      // REST fallback: poll /book per token every REST_POLL_INTERVAL_MS and
      // emit synthetic `book` events with the same shape the CLOB WS would
      // produce, so the browser hook can use one parser path.
      async function pollOnce() {
        if (!alive) return;
        await Promise.all(
          tokenIds.map(async (tokenId) => {
            try {
              const resp = await fetch(
                `${CLOB_REST_BASE}/book?token_id=${encodeURIComponent(tokenId)}`,
                { headers: { Accept: "application/json" }, cache: "no-store" }
              );
              if (!resp.ok) return;
              const data = (await resp.json()) as RestBook;
              const rawBids = data.bids || data.buys || [];
              const rawAsks = data.asks || data.sells || [];
              if (rawBids.length === 0 && rawAsks.length === 0) return;
              const sorted = sortBook(rawBids, rawAsks);
              const synthetic = {
                event_type: "book",
                asset_id: tokenId,
                market: data.market || "",
                timestamp: data.timestamp || String(Date.now()),
                bids: sorted.bids,
                asks: sorted.asks,
                buys: sorted.bids,
                sells: sorted.asks,
              };
              send("book", synthetic);
            } catch {}
          })
        );
      }

      function startRestFallback() {
        if (restMode) return;
        restMode = true;
        // Tear down WS — no value in keeping it open if it isn't delivering.
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        try { ws?.close(); } catch {}
        ws = null;

        // Re-emit `connected` so the client treats this stream as live —
        // the WS may have already emitted `disconnected` during its
        // bootstrap attempts before we decided to give up on it.
        send("connected", { tokenIds, transport: "rest" });

        // Kick off immediately, then on an interval.
        pollOnce();
        restPollTimer = setInterval(pollOnce, REST_POLL_INTERVAL_MS);
      }

      function connect() {
        if (!alive || restMode) return;
        const socket = new WebSocket(POLYMARKET_WS_URL, {
          headers: {
            Origin: "https://polymarket.com",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        });
        ws = socket;

        socket.on("open", () => {
          if (!alive) { try { socket.close(); } catch {} return; }
          // Subscribe ~100ms after open — pattern from the canonical
          // Xyryllium/polymarket-tracker-bot client which works in prod.
          setTimeout(() => {
            if (!alive || socket.readyState !== WebSocket.OPEN) return;
            try {
              socket.send(
                JSON.stringify({ assets_ids: tokenIds, type: "market" })
              );
            } catch {}
          }, 100);

          if (pingTimer) clearInterval(pingTimer);
          pingTimer = setInterval(() => {
            try {
              if (socket.readyState === WebSocket.OPEN) socket.send("PING");
            } catch {}
          }, PING_INTERVAL_MS);
          send("connected", { tokenIds });
        });

        socket.on("message", (raw) => {
          if (!alive) return;
          const txt = raw.toString();
          if (txt === "pong" || txt === "PONG" || txt.length === 0) return;
          try {
            const parsed = JSON.parse(txt);
            if (Array.isArray(parsed)) {
              for (const item of parsed) forwardWs(item);
            } else {
              forwardWs(parsed);
            }
          } catch {}
        });

        socket.on("error", (err) => {
          send("error", { message: (err as Error)?.message || "Polymarket WS error" });
        });

        socket.on("close", (code, reason) => {
          if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
          if (!alive || restMode) return;
          // During the bootstrap grace window, swallow `disconnected` —
          // the client would briefly flicker offline even though we're
          // about to fall back to REST and recover. After the grace
          // expires (and we still aren't in REST mode for some reason),
          // surface the disconnect normally.
          if (receivedAnyBook) {
            send("disconnected", { ts: Date.now(), code, reason: reason?.toString() });
          }
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 2000);
        });
      }

      // Polymarket's CLOB WS reliably accepts the handshake from Vercel
      // datacenter IPs but never streams data through it (WAF behavior),
      // so the 6s grace period was always wasted. Skip the WS attempt
      // entirely and start REST polling immediately — first book event
      // hits the client in ~300-800ms (the time of one /book fetch)
      // instead of ~6.5s.
      startRestFallback();
      heartbeatTimer = setInterval(() => send("heartbeat", { t: Date.now() }), 15000);
    },
    cancel() {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (bootstrapTimer) clearTimeout(bootstrapTimer);
      if (restPollTimer) clearInterval(restPollTimer);
      try { ws?.close(); } catch {}
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
