"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

const POLYMARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

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
  const wsRef = useRef<WebSocket | null>(null);
  const [prices, setPrices] = useState<Map<string, PriceData>>(new Map());
  const [books, setBooks] = useState<Map<string, BookDepthSnapshot>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscribedTokensRef = useRef<Set<string>>(new Set());
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

  const subscribe = useCallback((ws: WebSocket, tokens: string[]) => {
    if (ws.readyState !== WebSocket.OPEN || tokens.length === 0) return;
    const newTokens = tokens.filter(t => !subscribedTokensRef.current.has(t));
    if (newTokens.length === 0) return;
    ws.send(JSON.stringify({ type: "subscribe", channel: "market", assets_ids: newTokens }));
    newTokens.forEach(t => subscribedTokensRef.current.add(t));
  }, []);

  // connect reads everything from refs -- zero deps, never recreated, no stale closures
  const connect = useCallback(() => {
    if (!enabledRef.current || tokenIdsRef.current.length === 0) return;
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }

    subscribedTokensRef.current.clear();

    const ws = new WebSocket(POLYMARKET_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setIsConnected(true);
      subscribe(ws, tokenIdsRef.current);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const message = JSON.parse(event.data);
        const timestamp = message.timestamp ? parseInt(message.timestamp, 10) : Date.now();

        if (message.event_type === "book" && message.asset_id) {
          const buysRaw = message.buys || message.bids || [];
          const sellsRaw = message.sells || message.asks || [];
          // Only derive price if we have real bid/ask levels
          const bestBid = buysRaw[0]?.price ? parseFloat(buysRaw[0].price) : 0;
          const bestAsk = sellsRaw[0]?.price ? parseFloat(sellsRaw[0].price) : 0;
          if (bestBid > 0.005 || bestAsk > 0.005) {
            const existing = pricesRef.current.get(message.asset_id);
            updatePrice(message.asset_id, bestBid, bestAsk, existing?.lastTradePrice ?? null, timestamp);
          }
          updateBook(message.asset_id, buysRaw, sellsRaw, timestamp);
        } else if (message.event_type === "price_change" && message.price_changes) {
          for (const change of message.price_changes) {
            // Skip if bid or ask is missing — don't fabricate 0/1 defaults
            if (change.best_bid === undefined || change.best_ask === undefined) continue;
            const bestBid = parseFloat(change.best_bid);
            const bestAsk = parseFloat(change.best_ask);
            if (!isFinite(bestBid) || !isFinite(bestAsk)) continue;
            const existing = pricesRef.current.get(change.asset_id);
            updatePrice(change.asset_id, bestBid, bestAsk, existing?.lastTradePrice ?? null, timestamp);
          }
        } else if (message.event_type === "last_trade_price" && message.asset_id && message.price) {
          const lastTradePrice = parseFloat(message.price);
          if (isFinite(lastTradePrice) && lastTradePrice > 0.005 && lastTradePrice < 0.995) {
            const existing = pricesRef.current.get(message.asset_id);
            if (existing) {
              // Update last trade price but keep existing bid/ask
              updatePrice(message.asset_id, existing.bestBid, existing.bestAsk, lastTradePrice, timestamp);
            }
            // If no existing price data, skip — wait for a book or price_change event with real bid/ask
          }
        }
      } catch {}
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      wsRef.current = null;
      subscribedTokensRef.current.clear();
      // Reconnect using refs -- always reads latest values, no stale closure
      if (enabledRef.current && tokenIdsRef.current.length > 0) {
        reconnectTimeoutRef.current = setTimeout(connect, 1000);
      }
    };
  }, [subscribe, updatePrice, updateBook]);

  // Main connection effect -- only fires when tokenIds actually change by value or enabled changes
  useEffect(() => {
    if (enabled && stableTokenIds.length > 0) {
      connect();
    }
    return () => {
      if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      subscribedTokensRef.current.clear();
    };
  }, [enabled, stableTokenIds, connect]);

  // Subscribe to new tokens if WS is already open and tokenIds change
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      subscribe(wsRef.current, stableTokenIds);
    }
  }, [stableTokenIds, subscribe]);

  // REST poll fallback — only while the WebSocket is NOT connected. Prior
  // behavior polled unconditionally alongside the WS, doubling the work
  // and causing React re-renders to fight each other.
  useEffect(() => {
    if (!enabled || stableTokenIds.length === 0 || isConnected) return;
    let alive = true;
    const poll = async () => {
      if (!alive || !mountedRef.current) return;
      for (const tokenId of tokenIdsRef.current) {
        if (!alive) break;
        try {
          const resp = await fetch(`/api/polymarket/book?token_id=${tokenId}`);
          if (!resp.ok) continue;
          const book = await resp.json();
          const bids = book.bids || book.buys || [];
          const asks = book.asks || book.sells || [];
          if (bids.length === 0 && asks.length === 0) continue;
          const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;
          const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 0;
          const existing = pricesRef.current.get(tokenId);
          updatePrice(tokenId, bestBid, bestAsk, existing?.lastTradePrice ?? null, Date.now());
          updateBook(tokenId, bids, asks, Date.now());
        } catch {}
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [enabled, stableTokenIds, isConnected, updatePrice, updateBook]);

  return { prices, books, isConnected };
}
