import { NextRequest } from "next/server";
import { getApiKey } from "@/lib/settings";
import { getDomeClient } from "@/lib/domeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side fallback for tracked-wallet trade events.
//
// The browser opens a direct WebSocket to Polymarket RTDS as the primary
// source — see `useWalletTradeStream.ts`. This SSE endpoint exists *only*
// as a fallback for the rare case where the user's network can't reach
// Polymarket's WS. It uses Dome's SDK WebSocket (paid) and never polls.
//
// If DOME_API_KEY isn't configured the route returns a stream that
// immediately tells the client "no fallback available" so the panel
// can surface a clear error instead of pretending to be live.

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

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const walletsParam = url.searchParams.get("wallets") || "";
  const wallets = walletsParam
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

  const encoder = new TextEncoder();
  let alive = true;
  let domeWs: { close?: () => void } | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
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

      // Tell the client we're alive immediately so its fallback panel
      // doesn't sit OFFLINE while we wait on Dome's handshake.
      send("connected", { wallets, transport: "init" });

      if (wallets.length === 0) {
        heartbeatTimer = setInterval(() => send("heartbeat", { t: Date.now() }), 15000);
        return;
      }

      const tracked = new Set(wallets);
      const key = getApiKey("domeApiKey");
      if (!key) {
        // No paid fallback available. Heartbeat so the connection
        // stays open (the client treats this as "stream alive but no
        // data"; the real-time browser WS is the primary source so
        // this only matters when the browser's RTDS path also fails).
        send("error", {
          message:
            "No DOME_API_KEY configured. Browser-side Polymarket RTDS is the only trade source.",
        });
        heartbeatTimer = setInterval(() => send("heartbeat", { t: Date.now() }), 15000);
        return;
      }

      try {
        const dome = getDomeClient();
        const ws = (
          dome as { polymarket: { createWebSocket: (cfg: unknown) => unknown } }
        ).polymarket.createWebSocket({
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

              const tokenLabel = String(order.token_label || "");
              const trade: NormalizedTrade = {
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
              };
              send("trade", trade);
            });

            ws.on("error", (err: unknown) => {
              send("error", {
                message:
                  (err as { message?: string })?.message || "Dome WS error",
                source: "dome",
              });
            });
          } catch (err) {
            send("error", {
              message:
                (err as { message?: string })?.message || "Dome connect failed",
              source: "dome",
            });
          }
        })();
      } catch (err) {
        send("error", {
          message: (err as { message?: string })?.message || "Dome init failed",
          source: "dome",
        });
      }

      heartbeatTimer = setInterval(() => send("heartbeat", { t: Date.now() }), 15000);
    },
    cancel() {
      alive = false;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try { domeWs?.close?.(); } catch {}
    },
  });

  request.signal.addEventListener("abort", () => {
    alive = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
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
