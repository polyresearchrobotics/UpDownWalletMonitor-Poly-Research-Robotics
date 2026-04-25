import { getDomeClient } from "@/lib/domeClient";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  const marketSlug = url.searchParams.get("marketSlug");
  const upTokenId = url.searchParams.get("upTokenId") || "";
  const downTokenId = url.searchParams.get("downTokenId") || "";

  if (!wallet || !marketSlug) {
    return new Response("wallet and marketSlug are required", { status: 400 });
  }

  const encoder = new TextEncoder();
  let domeWs: any = null;
  let closed = false;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  const walletLower = wallet.toLowerCase();

  const currentMarketSlug = marketSlug;
  const currentUpTokenId = upTokenId;
  const currentDownTokenId = downTokenId;

  let controller: ReadableStreamDefaultController | null = null;

  function send(event: string, data: any) {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch {
      cleanup();
    }
  }

  function cleanup() {
    if (closed) return;
    closed = true;
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    try { domeWs?.close(); } catch {}
    domeWs = null;
  }

  function handleOrder(order: any) {
    if (closed) return;

    // Log every order that mentions this wallet, even if filtered out
    const orderUser = (order.user || "").toLowerCase();
    const orderTaker = (order.taker || "").toLowerCase();
    const isOurWallet = orderUser === walletLower || orderTaker === walletLower;

    if (isOurWallet) {
      console.log("[WalletStream] Order for tracked wallet:", {
        market_slug: order.market_slug,
        expected_slug: currentMarketSlug,
        slug_match: order.market_slug === currentMarketSlug,
        side: order.side,
        price: order.price,
        token_id: order.token_id,
        user: order.user,
        taker: order.taker,
        type: order.type || order.order_type,
        event_type: order.event_type,
      });
    }

    if (!order?.market_slug || order.market_slug !== currentMarketSlug) return;

    if (!isOurWallet) return;

    let executionRole: "TAKER" | "MAKER" | "UNKNOWN" = "UNKNOWN";
    const rawType = (order.type || order.order_type || order.orderType || "").toString().toUpperCase();
    if (rawType === "GTC" || rawType === "GTD") executionRole = "MAKER";
    else if (rawType === "FOK" || rawType === "FAK") executionRole = "TAKER";
    else if (orderTaker === walletLower) executionRole = "TAKER";
    else if (orderUser === walletLower && orderTaker !== walletLower) executionRole = "MAKER";

    const shares = order.shares ?? 0;
    const sharesNormalized = order.shares_normalized ?? order.size_matched ?? order.original_size ?? order.size ?? shares;
    const ts = Date.now() / 1000;

    let outcome: "UP" | "DOWN" | "UNKNOWN" = "UNKNOWN";
    if (currentUpTokenId && order.token_id === currentUpTokenId) outcome = "UP";
    else if (currentDownTokenId && order.token_id === currentDownTokenId) outcome = "DOWN";

    const cost = sharesNormalized * (order.price ?? 0);

    send("trade", {
      id: order.order_id || order.order_hash || order.id || `${order.token_id}-${ts}`,
      tokenId: order.token_id || "", tokenLabel: order.token_label || "",
      side: order.side || "BUY", outcome,
      price: order.price ?? 0, priceCents: Math.round((order.price ?? 0) * 100),
      shares, sharesNormalized, cost,
      timestamp: ts, txHash: order.tx_hash || "", orderHash: order.order_hash || "",
      executionRole, status: order.status,
    });
  }

  const stream = new ReadableStream({
    async start(ctrl) {
      controller = ctrl;

      // Heartbeat every 10s keeps the SSE pipe alive through proxies/load balancers
      heartbeatInterval = setInterval(() => send("heartbeat", { ts: Date.now() }), 10000);

      try {
        const dome = getDomeClient();
        domeWs = (dome as any).polymarket.createWebSocket({
          // Let the SDK handle reconnection + re-subscription internally
          reconnect: { enabled: true, maxAttempts: Infinity, delay: 1000 },
        });

        await domeWs.connect();
        console.log("[WalletStream] Dome WS connected for", wallet);
        const sub = await domeWs.subscribe({ users: [wallet] });
        console.log("[WalletStream] Subscribed:", JSON.stringify(sub));

        send("connected", { wallet, marketSlug: currentMarketSlug });

        domeWs.on("order", handleOrder);

        // Log ALL events from Dome to diagnose missing trades
        const knownEvents = new Set(["order", "open", "close", "error"]);
        for (const evt of ["trade", "fill", "match", "execution", "update"]) {
          domeWs.on(evt, (data: any) => {
            if (!knownEvents.has(evt)) {
              console.log(`[WalletStream] Dome event "${evt}":`, JSON.stringify(data).slice(0, 200));
            }
          });
        }

        // On SDK-managed reconnect, re-subscribe so orders keep flowing
        domeWs.on("open", () => {
          if (closed) return;
          console.log("[WalletStream] Dome WS reconnected, re-subscribing...");
          domeWs.subscribe({ users: [wallet] }).catch((err: any) => {
            console.error("[WalletStream] Re-subscribe failed:", err?.message);
          });
        });

        domeWs.on("error", (err: any) => {
          console.error("[WalletStream] Dome WS error:", err?.message);
        });

        // If the SDK exhausts its reconnect attempts and truly closes,
        // close the SSE stream so the client-side EventSource fires onerror
        // and reopens a fresh stream automatically.
        domeWs.on("close", () => {
          if (closed) return;
          console.error("[WalletStream] Dome WS closed permanently");
          cleanup();
          try { ctrl.close(); } catch {}
        });

        request.signal.addEventListener("abort", () => {
          cleanup();
          try { ctrl.close(); } catch {}
        });
      } catch (err: any) {
        console.error("[WalletStream] Dome connect failed:", err?.message);
        send("error", { message: err?.message || "Failed to connect" });
        cleanup();
        try { ctrl.close(); } catch {}
      }
    },
    cancel() { cleanup(); },
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
