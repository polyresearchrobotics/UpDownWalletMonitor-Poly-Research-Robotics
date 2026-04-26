"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

interface PriceData {
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  lastTradePrice: number | null;
  timestamp: number;
}

export interface BookLevel {
  price: number;
  size: number;
}

export interface BookDepthSnapshot {
  tokenId: string;
  bids: BookLevel[];
  asks: BookLevel[];
  timestamp: number;
}

function calculateMidPrice(bestBid: number, bestAsk: number): number {
  const validBid = bestBid > 0.005 && bestBid < 0.995;
  const validAsk = bestAsk > 0.005 && bestAsk < 0.995;
  if (validBid && validAsk) {
    // Reject if spread is too wide (> 50¢) — no real liquidity
    if (bestAsk - bestBid > 0.50) return 0;
    return (bestBid + bestAsk) / 2;
  }
  if (validBid) return bestBid;
  if (validAsk) return bestAsk;
  return 0;
}

interface UseBTCMarketWebSocketOptions {
  tokenIds: string[];
  enabled?: boolean;
}

interface UseBTCMarketWebSocketReturn {
  prices: Map<string, PriceData>;
  books: Map<string, BookDepthSnapshot>;
  isConnected: boolean;
}

export function useBTCMarketWebSocket({
  tokenIds,
  enabled = true,
}: UseBTCMarketWebSocketOptions): UseBTCMarketWebSocketReturn {
  const esRef = useRef<EventSource | null>(null);
  const [prices, setPrices] = useState<Map<string, PriceData>>(new Map());
  const [books, setBooks] = useState<Map<string, BookDepthSnapshot>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pricesRef = useRef<Map<string, PriceData>>(prices);
  const mountedRef = useRef(true);

  // Keep pricesRef in sync without causing re-renders
  pricesRef.current = prices;

  // Stabilize tokenIds by value, not reference.
  // Only changes when the sorted, joined string representation changes.
  const tokenIdsKey = useMemo(() => [...tokenIds].sort().join(","), [tokenIds]);
  const stableTokenIds = useMemo(() => tokenIds, [tokenIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refs used by stable callbacks. Kept in sync via useEffect (not mutated
  // during render) so React 19 strict-mode double-renders don't leave the
  // refs pointing at a stale value during the second pass.
  const tokenIdsRef = useRef<string[]>(stableTokenIds);
  const enabledRef = useRef(enabled);
  useEffect(() => { tokenIdsRef.current = stableTokenIds; }, [stableTokenIds]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Track unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Stable callbacks that read from refs -- never recreated
  const updatePrice = useCallback((
    tokenId: string, bestBid: number, bestAsk: number,
    lastTradePrice: number | null, timestamp: number
  ) => {
    if (!mountedRef.current) return;
    const midPrice = calculateMidPrice(bestBid, bestAsk);
    if (midPrice === 0) return;

    setPrices((prev) => {
      const next = new Map(prev);
      next.set(tokenId, { tokenId, bestBid, bestAsk, midPrice, lastTradePrice, timestamp });
      return next;
    });
  }, []);

  const updateBook = useCallback((tokenId: string, buysRaw: any[], sellsRaw: any[], timestamp: number) => {
    if (!mountedRef.current) return;
    const bids: BookLevel[] = buysRaw
      .map((l: any) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
      .filter((l: BookLevel) => l.size > 0 && l.price > 0 && l.price < 1)
      .sort((a: BookLevel, b: BookLevel) => b.price - a.price);
    const asks: BookLevel[] = sellsRaw
      .map((l: any) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
      .filter((l: BookLevel) => l.size > 0 && l.price > 0 && l.price < 1)
      .sort((a: BookLevel, b: BookLevel) => a.price - b.price);

    setBooks((prev) => {
      const next = new Map(prev);
      next.set(tokenId, { tokenId, bids, asks, timestamp });
      return next;
    });
  }, []);

  // Handlers split out so we can attach them as named EventSource listeners.
  // EventSource fires by `event:` name, so each Polymarket event_type needs
  // its own addEventListener call. The body is identical to the previous
  // direct-WS onmessage logic.
  const handleBook = useCallback((evt: MessageEvent) => {
    if (!mountedRef.current) return;
    try {
      const message = JSON.parse(evt.data);
      const timestamp = message.timestamp ? parseInt(message.timestamp, 10) : Date.now();
      if (!message.asset_id) return;
      const buysRaw = message.buys || message.bids || [];
      const sellsRaw = message.sells || message.asks || [];
      const bestBid = buysRaw[0]?.price ? parseFloat(buysRaw[0].price) : 0;
      const bestAsk = sellsRaw[0]?.price ? parseFloat(sellsRaw[0].price) : 0;
      if (bestBid > 0.005 || bestAsk > 0.005) {
        const existing = pricesRef.current.get(message.asset_id);
        updatePrice(message.asset_id, bestBid, bestAsk, existing?.lastTradePrice ?? null, timestamp);
      }
      updateBook(message.asset_id, buysRaw, sellsRaw, timestamp);
    } catch {}
  }, [updatePrice, updateBook]);

  const handlePriceChange = useCallback((evt: MessageEvent) => {
    if (!mountedRef.current) return;
    try {
      const message = JSON.parse(evt.data);
      const timestamp = message.timestamp ? parseInt(message.timestamp, 10) : Date.now();
      if (!message.price_changes) return;
      for (const change of message.price_changes) {
        if (change.best_bid === undefined || change.best_ask === undefined) continue;
        const bestBid = parseFloat(change.best_bid);
        const bestAsk = parseFloat(change.best_ask);
        if (!isFinite(bestBid) || !isFinite(bestAsk)) continue;
        const existing = pricesRef.current.get(change.asset_id);
        updatePrice(change.asset_id, bestBid, bestAsk, existing?.lastTradePrice ?? null, timestamp);
      }
    } catch {}
  }, [updatePrice]);

  const handleLastTradePrice = useCallback((evt: MessageEvent) => {
    if (!mountedRef.current) return;
    try {
      const message = JSON.parse(evt.data);
      const timestamp = message.timestamp ? parseInt(message.timestamp, 10) : Date.now();
      if (!message.asset_id || !message.price) return;
      const lastTradePrice = parseFloat(message.price);
      if (isFinite(lastTradePrice) && lastTradePrice > 0.005 && lastTradePrice < 0.995) {
        const existing = pricesRef.current.get(message.asset_id);
        if (existing) {
          updatePrice(message.asset_id, existing.bestBid, existing.bestAsk, lastTradePrice, timestamp);
        }
      }
    } catch {}
  }, [updatePrice]);

  // connect reads everything from refs -- zero deps, never recreated, no stale closures
  const connect = useCallback(() => {
    if (!enabledRef.current || tokenIdsRef.current.length === 0) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }

    const url = `/api/polymarket/market-stream?tokenIds=${encodeURIComponent(tokenIdsRef.current.join(","))}`;
    const es = new EventSource(url);
    esRef.current = es;
    // Same orphan guard as useBinancePrice — when the user switches asset
    // mid-flight, the cleanup closes this EventSource but its buffered
    // events / async error fires AFTER a fresh `connect()` has already
    // replaced `esRef.current`. Without this check, an orphan would null
    // the new ref and schedule a duplicate reconnect.
    const isActive = () => esRef.current === es;

    es.addEventListener("connected", () => {
      if (!mountedRef.current || !isActive()) return;
      setIsConnected(true);
    });

    es.addEventListener("disconnected", () => {
      if (!mountedRef.current || !isActive()) return;
      setIsConnected(false);
    });

    const guard =
      <T extends Event>(fn: (e: T) => void) =>
      (e: T) => {
        if (!isActive()) return;
        fn(e);
      };
    es.addEventListener("book", guard(handleBook) as EventListener);
    es.addEventListener("price_change", guard(handlePriceChange) as EventListener);
    es.addEventListener("last_trade_price", guard(handleLastTradePrice) as EventListener);

    es.onerror = () => {
      if (!isActive()) {
        try { es.close(); } catch {}
        return;
      }
      if (!mountedRef.current) return;
      setIsConnected(false);
      // EventSource auto-reconnects, but if it lands in CLOSED (e.g. server
      // returned non-2xx) we re-open manually after a short backoff.
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null;
        if (enabledRef.current && tokenIdsRef.current.length > 0) {
          reconnectTimeoutRef.current = setTimeout(connect, 1000);
        }
      }
    };
  }, [handleBook, handlePriceChange, handleLastTradePrice]);

  // Main connection effect -- only fires when tokenIds actually change by value or enabled changes
  useEffect(() => {
    if (enabled && stableTokenIds.length > 0) {
      connect();
    }
    return () => {
      if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      setIsConnected(false);
    };
  }, [enabled, stableTokenIds, connect]);

  return { prices, books, isConnected };
}
