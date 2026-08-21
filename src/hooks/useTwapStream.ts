"use client";

import { useEffect, useRef, useState } from "react";

// Live Chainlink TWAP prices via Polymarket's public Real-Time Data Socket.
//
// Polymarket settles its crypto up/down markets on Chainlink TWAP feeds
// (5m cycles → 30s window, 15m cycles → 60s window) and republishes those
// exact Chainlink numbers on RTDS topics `crypto_prices_twap_thirty` and
// `crypto_prices_twap_sixty`. The browser connects directly — same public
// socket the wallet trade stream already uses, no API key, no server hop.
//
// Payload shape (verified live):
//   { symbol: "btc/usd", value: 64265.77, timestamp: 1786073988000, window_s: 30 }
// Each topic emits roughly one update per second per asset.

const POLYMARKET_RTDS_URL = "wss://ws-live-data.polymarket.com";
const PING_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 1500;

export type TwapSymbol = "BTC" | "ETH" | "SOL" | "XRP";

export interface TwapQuote {
  price: number;
  /** Feed observation time (ms). */
  timestamp: number;
}

export interface TwapRecord {
  twap30: TwapQuote | null;
  twap60: TwapQuote | null;
}

type TwapPrices = Record<TwapSymbol, TwapRecord>;

const RTDS_SYMBOL_MAP: Record<string, TwapSymbol> = {
  "btc/usd": "BTC",
  "eth/usd": "ETH",
  "sol/usd": "SOL",
  "xrp/usd": "XRP",
};

function emptyPrices(): TwapPrices {
  return {
    BTC: { twap30: null, twap60: null },
    ETH: { twap30: null, twap60: null },
    SOL: { twap30: null, twap60: null },
    XRP: { twap30: null, twap60: null },
  };
}

interface UseTwapStreamReturn {
  prices: TwapPrices;
  isConnected: boolean;
}

export function useTwapStream({
  enabled = true,
}: { enabled?: boolean } = {}): UseTwapStreamReturn {
  const [prices, setPrices] = useState<TwapPrices>(emptyPrices);
  const [isConnected, setIsConnected] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // Buffer updates and flush on a short interval so 8 topics × 1Hz
    // doesn't trigger 8 React re-renders per second.
    const pending: Array<{ symbol: TwapSymbol; window: 30 | 60; quote: TwapQuote }> = [];
    const flushTimer = setInterval(() => {
      if (cancelled || !mountedRef.current || pending.length === 0) return;
      const batch = pending.splice(0, pending.length);
      setPrices((prev) => {
        const next = { ...prev };
        for (const u of batch) {
          next[u.symbol] = {
            ...next[u.symbol],
            [u.window === 30 ? "twap30" : "twap60"]: u.quote,
          };
        }
        return next;
      });
    }, 250);

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
    }

    function connect() {
      if (cancelled || !mountedRef.current) return;
      try {
        ws = new WebSocket(POLYMARKET_RTDS_URL);
      } catch {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }

      const socket = ws;

      socket.onopen = () => {
        if (cancelled || !mountedRef.current) {
          try {
            socket.close();
          } catch {}
          return;
        }
        setIsConnected(true);
        try {
          socket.send(
            JSON.stringify({
              action: "subscribe",
              subscriptions: [
                { topic: "crypto_prices_twap_thirty", type: "update" },
                { topic: "crypto_prices_twap_sixty", type: "update" },
              ],
            })
          );
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
          const window =
            msg?.topic === "crypto_prices_twap_thirty"
              ? (30 as const)
              : msg?.topic === "crypto_prices_twap_sixty"
              ? (60 as const)
              : null;
          if (window === null || msg?.type !== "update") return;
          const p = msg.payload || {};
          const symbol = RTDS_SYMBOL_MAP[(p.symbol || "").toLowerCase()];
          const value = Number(p.value);
          if (!symbol || !isFinite(value) || value <= 0) return;
          pending.push({
            symbol,
            window,
            quote: { price: value, timestamp: Number(p.timestamp) || Date.now() },
          });
        } catch {}
      };

      socket.onclose = () => {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (cancelled || !mountedRef.current) return;
        setIsConnected(false);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearInterval(flushTimer);
      teardown();
      if (mountedRef.current) setIsConnected(false);
    };
  }, [enabled]);

  return { prices, isConnected };
}
