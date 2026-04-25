"use client";

import { useEffect, useRef, useState } from "react";

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

    let cancelled = false;
    const es = new EventSource(
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

    es.addEventListener("heartbeat", () => {});

    es.addEventListener("trade", (e) => {
      if (cancelled || !mountedRef.current) return;
      try {
        const trade = JSON.parse(
          (e as MessageEvent).data
        ) as WalletTradeStreamEvent;
        if (seenIdsRef.current.has(trade.id)) return;
        seenIdsRef.current.add(trade.id);
        setTrades((prev) => {
          // Insertion sort — prev is already sorted by timestamp, so
          // finding the insertion point is O(n) once; the old code
          // re-sorted the entire array on every trade.
          let i = prev.length;
          while (i > 0 && prev[i - 1].timestamp > trade.timestamp) i--;
          if (i === prev.length) return [...prev, trade];
          return [...prev.slice(0, i), trade, ...prev.slice(i)];
        });
      } catch {}
    });

    es.addEventListener("error", (e) => {
      if (cancelled || !mountedRef.current) return;
      try {
        const data = JSON.parse((e as MessageEvent).data || "{}");
        if (data?.message) setError(data.message);
      } catch {}
    });

    es.onerror = () => {
      if (cancelled || !mountedRef.current) return;
      setIsStreaming(false);
    };

    return () => {
      cancelled = true;
      es.close();
      if (mountedRef.current) setIsStreaming(false);
    };
  }, [enabled, walletsKey]);

  useEffect(() => {
    if (walletsKey.length === 0) {
      setTrades([]);
      seenIdsRef.current.clear();
      return;
    }
    const tracked = new Set(walletsKey.split(",").filter(Boolean));
    // Only re-render if some trade actually got filtered out — otherwise
    // the setter churned a new array ref every walletsKey change.
    setTrades((prev) => {
      const next = prev.filter((t) => tracked.has(t.wallet.toLowerCase()));
      return next.length === prev.length ? prev : next;
    });
  }, [walletsKey]);

  return { trades, isStreaming, error };
}
