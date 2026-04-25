"use client";

import { useEffect, useState, useRef, useCallback } from "react";

export interface ChainlinkPrice {
  symbol: "BTC" | "ETH" | "SOL" | "XRP";
  price: number;
  timestamp: number;
  change24h: number;
  cycleStartPrice: number;
  cycleStart: number;
  bid: number | null;
  ask: number | null;
  available: boolean;
}

type SymbolKey = "BTC" | "ETH" | "SOL" | "XRP";
type PriceRecord = Record<SymbolKey, ChainlinkPrice>;
type Status = "healthy" | "partial" | "unavailable" | "error" | "connecting" | "disabled";

interface UseChainlinkStreamReturn {
  prices: PriceRecord | null;
  isConnected: boolean;
  status: Status;
}

function computeStatus(record: PriceRecord): Status {
  const availableCount = Object.values(record).filter(p => p.available).length;
  if (availableCount === 4) return "healthy";
  if (availableCount > 0) return "partial";
  return "unavailable";
}

export function useChainlinkStream({
  enabled = true,
}: { enabled?: boolean } = {}): UseChainlinkStreamReturn {
  const [prices, setPrices] = useState<PriceRecord | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<Status>("connecting");

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const enabledRef = useRef(enabled);
  const disabledRef = useRef(false);

  enabledRef.current = enabled;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Stable connect -- reads enabled from ref, never recreated
  const connect = useCallback(() => {
    if (!enabledRef.current) return;
    if (disabledRef.current) return;
    if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
    if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }

    setStatus("connecting");
    const eventSource = new EventSource("/api/crypto/chainlink-prices-stream");
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      if (!mountedRef.current) { eventSource.close(); return; }
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    eventSource.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "init":
            setPrices(data.prices);
            setStatus(data.status);
            break;
          case "update": {
            // Build the new record outside the updater so the state
            // transition stays pure (React 19 strict-mode runs updaters
            // twice — side effects inside would fire twice).
            let nextRecord: PriceRecord | null = null;
            setPrices((prev) => {
              if (!prev) return prev;
              nextRecord = {
                ...prev,
                [data.symbol]: {
                  symbol: data.symbol, price: data.price, timestamp: data.timestamp,
                  change24h: data.change24h, cycleStartPrice: data.cycleStartPrice,
                  cycleStart: data.cycleStart, bid: data.bid, ask: data.ask, available: true,
                },
              };
              return nextRecord;
            });
            if (nextRecord && mountedRef.current) {
              setStatus(computeStatus(nextRecord));
            }
            break;
          }
          case "error":
            setStatus("error");
            break;
          case "disabled":
            // Server reported no API credentials are configured. Latch
            // this so onerror (fired by EventSource when the server
            // closes the stream) doesn't trigger a reconnect storm.
            disabledRef.current = true;
            setStatus("disabled");
            setIsConnected(false);
            eventSource.close();
            eventSourceRef.current = null;
            break;
        }
      } catch {}
    };

    eventSource.onerror = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      eventSource.close();
      eventSourceRef.current = null;
      if (disabledRef.current) return;
      if (reconnectAttemptsRef.current < 10) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      } else {
        setStatus("error");
      }
    };
  }, []);

  useEffect(() => {
    if (enabled) connect();
    return () => {
      if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
      if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
    };
  }, [enabled, connect]);

  return { prices, isConnected, status };
}
