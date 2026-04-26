"use client";

import { useEffect, useRef, useState } from "react";

// Real-time tracked-wallet trade stream.
//
// The browser opens a direct WebSocket to Polymarket's public Real-Time
// Data Socket (`wss://ws-live-data.polymarket.com`). This is the same
// firehose every Polymarket frontend uses — no API key required, no
// polling. The user's residential IP gets past Polymarket's edge WAF,
// which is why the previous server-side proxy on Vercel datacenter IPs
// silently dropped trade payloads even though the handshake succeeded.
//
// We subscribe to the activity/trades topic, filter every payload by
// proxyWallet against the tracked-wallet set, and emit normalized
// `WalletTrade` objects for the chart.
//
// If the WebSocket fails to connect three times in a row (Polymarket
// genuinely down, ISP block, browser WS disabled, etc.) we fall through
// to the server-side SSE proxy at `/api/wallet-tracker/trades-stream`
// which uses Dome's SDK as a paid backup. That fallback is the only
// reason DOME_API_KEY exists in env; it is not used otherwise.

const POLYMARKET_RTDS_URL = "wss://ws-live-data.polymarket.com";
const PING_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 1500;
const FALLBACK_AFTER_FAILURES = 3;

export interface WalletTrade {
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
  status?: string;
}

export interface WalletTradeStreamEvent extends WalletTrade {
  wallet: string;
  marketSlug: string;
  conditionId: string;
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

function classifyOutcome(label: string | undefined): "UP" | "DOWN" | "UNKNOWN" {
  const l = (label || "").toLowerCase();
  if (l === "up" || l === "yes") return "UP";
  if (l === "down" || l === "no") return "DOWN";
  return "UNKNOWN";
}

function normalize(
  p: RtdsTradePayload,
  tracked: Set<string>
): WalletTradeStreamEvent | null {
  const wallet = (p.proxyWallet || "").toLowerCase();
  if (!wallet || !tracked.has(wallet)) return null;
  if (!p.asset || !p.side || p.price === undefined) return null;

  const shares = p.size ?? 0;
  const price = p.price;
  const timestamp = p.timestamp ?? Math.floor(Date.now() / 1000);
  const txHash = p.transactionHash || "";

  // Stable id: `tx-asset-side-price-shares` lets the consumer dedupe
  // when the WS replays an event after reconnect.
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

interface UseOptions {
  wallets: string[];
  enabled?: boolean;
}

interface UseReturn {
  trades: WalletTradeStreamEvent[];
  isStreaming: boolean;
  error: string | null;
}

export function useWalletTradeStream({
  wallets,
  enabled = true,
}: UseOptions): UseReturn {
  const [trades, setTrades] = useState<WalletTradeStreamEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seenIdsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  const walletsKey = [...wallets].sort().join(",");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || walletsKey.length === 0) {
      setIsStreaming(false);
      return;
    }

    const tracked = new Set(walletsKey.split(",").filter(Boolean));
    let cancelled = false;
    let ws: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null;
    let consecutiveFailures = 0;
    let usingFallback = false;

    function appendTrade(trade: WalletTradeStreamEvent) {
      if (cancelled || !mountedRef.current) return;
      if (seenIdsRef.current.has(trade.id)) return;
      seenIdsRef.current.add(trade.id);
      setTrades((prev) => {
        // Insertion sort; prev is sorted by timestamp ascending.
        let i = prev.length;
        while (i > 0 && prev[i - 1].timestamp > trade.timestamp) i--;
        if (i === prev.length) return [...prev, trade];
        return [...prev.slice(0, i), trade, ...prev.slice(i)];
      });
    }

    function teardown() {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {}
        ws = null;
      }
      if (es) {
        try {
          es.close();
        } catch {}
        es = null;
      }
    }

    function startFallbackSse() {
      if (cancelled || !mountedRef.current || usingFallback) return;
      usingFallback = true;
      teardown();

      es = new EventSource(
        `/api/wallet-tracker/trades-stream?wallets=${encodeURIComponent(walletsKey)}`
      );
      es.addEventListener("connected", () => {
        if (cancelled || !mountedRef.current) return;
        setIsStreaming(true);
        setError(null);
      });
      es.addEventListener("disconnected", () => {
        if (cancelled || !mountedRef.current) return;
        setIsStreaming(false);
      });
      es.addEventListener("trade", (e) => {
        if (cancelled || !mountedRef.current) return;
        try {
          appendTrade(JSON.parse((e as MessageEvent).data) as WalletTradeStreamEvent);
        } catch {}
      });
      es.onerror = () => {
        if (cancelled || !mountedRef.current) return;
        setIsStreaming(false);
      };
    }

    function connect() {
      if (cancelled || !mountedRef.current) return;
      try {
        ws = new WebSocket(POLYMARKET_RTDS_URL);
      } catch (err) {
        consecutiveFailures += 1;
        scheduleReconnectOrFallback();
        setError((err as Error)?.message || "Failed to open WebSocket");
        return;
      }

      const socket = ws;

      socket.onopen = () => {
        if (cancelled || !mountedRef.current) {
          try { socket.close(); } catch {}
          return;
        }
        consecutiveFailures = 0;
        setIsStreaming(true);
        setError(null);
        try {
          socket.send(
            JSON.stringify({
              action: "subscribe",
              subscriptions: [{ topic: "activity", type: "trades" }],
            })
          );
          // Polymarket RTDS expects a ping every ~30s. The server replies
          // with "pong" and treats the connection as healthy.
          socket.send("ping");
        } catch {}
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          try {
            if (socket.readyState === WebSocket.OPEN) socket.send("ping");
          } catch {}
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        if (cancelled || !mountedRef.current) return;
        const txt = typeof event.data === "string" ? event.data : "";
        if (txt === "pong" || txt.length === 0) return;
        try {
          const msg = JSON.parse(txt);
          if (msg?.topic !== "activity" || msg?.type !== "trades") return;
          const normalized = normalize(
            (msg.payload || {}) as RtdsTradePayload,
            tracked
          );
          if (normalized) appendTrade(normalized);
        } catch {}
      };

      socket.onerror = () => {
        // Don't trigger fallback yet — the close handler counts
        // consecutive failures and decides.
      };

      socket.onclose = () => {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (cancelled || !mountedRef.current) return;
        setIsStreaming(false);
        consecutiveFailures += 1;
        scheduleReconnectOrFallback();
      };
    }

    function scheduleReconnectOrFallback() {
      if (cancelled || !mountedRef.current) return;
      if (consecutiveFailures >= FALLBACK_AFTER_FAILURES) {
        setError(
          "Polymarket RTDS unreachable after multiple attempts; falling back to server SSE (Dome)"
        );
        startFallbackSse();
        return;
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    }

    connect();

    return () => {
      cancelled = true;
      teardown();
      if (mountedRef.current) setIsStreaming(false);
    };
  }, [enabled, walletsKey]);

  // Drop trades from wallets that are no longer tracked.
  useEffect(() => {
    if (walletsKey.length === 0) {
      setTrades([]);
      seenIdsRef.current.clear();
      return;
    }
    const tracked = new Set(walletsKey.split(",").filter(Boolean));
    setTrades((prev) => {
      const next = prev.filter((t) => tracked.has(t.wallet.toLowerCase()));
      return next.length === prev.length ? prev : next;
    });
  }, [walletsKey]);

  return { trades, isStreaming, error };
}
