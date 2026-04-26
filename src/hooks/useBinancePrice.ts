"use client";

import { useEffect, useState, useRef, useCallback } from "react";

export interface BinancePriceData {
  price: number;
  symbol: string;
  timestamp: number;
}

// Public Binance spot endpoints. We cycle through them because each has a
// different failure mode depending on network / region:
//   - stream.binance.com: sometimes opens but delivers no trades on certain ISPs
//   - data-stream.binance.vision: market-data-only mirror, often reachable when
//     the main streams aren't
//   - stream.binance.us: works for US IPs but some forwarded pairs go silent
//     after the first tick
// The stale-data watchdog below rotates hosts whenever the current one fails
// to deliver trades within the expected window.
const SPOT_HOSTS = [
  "stream.binance.com:9443",
  "data-stream.binance.vision:9443",
  "stream.binance.us:9443",
] as const;

// If no trade is received within this many ms of the socket opening, assume
// the endpoint is broken/silent and rotate. Also applied between trades: btcusdt
// normally sees multiple trades per second, so 10s of silence means something
// is wrong.
const FIRST_TRADE_TIMEOUT_MS = 5000;
const IDLE_TRADE_TIMEOUT_MS = 10000;

interface UseBinancePriceOptions {
  symbol?: string;
  enabled?: boolean;
}

interface UseBinancePriceReturn {
  spot: BinancePriceData | null;
  futures: BinancePriceData | null;
  spotConnected: boolean;
  futuresConnected: boolean;
}

export function useBinancePrice({
  symbol = "btcusdt",
  enabled = true,
}: UseBinancePriceOptions = {}): UseBinancePriceReturn {
  const [spot, setSpot] = useState<BinancePriceData | null>(null);
  const [futures, setFutures] = useState<BinancePriceData | null>(null);
  const [spotConnected, setSpotConnected] = useState(false);
  const [futuresConnected, setFuturesConnected] = useState(false);

  const spotWsRef = useRef<WebSocket | null>(null);
  const futuresWsRef = useRef<WebSocket | null>(null);
  const spotReconnectRef = useRef<NodeJS.Timeout | null>(null);
  const futuresReconnectRef = useRef<NodeJS.Timeout | null>(null);
  const spotStaleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const enabledRef = useRef(enabled);
  const symbolRef = useRef(symbol);

  const spotHostIdxRef = useRef(0);
  const spotOpenedRef = useRef(false);

  enabledRef.current = enabled;
  // Detect symbol changes synchronously so the stale price from the previous
  // asset doesn't leak through to subscribers (e.g. the chart's barcode
  // filter would reject every fresh ETH price as a "huge jump" away from
  // BTC's last $77k value).
  if (symbolRef.current !== symbol) {
    symbolRef.current = symbol;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Clear stale prices the moment the user switches asset. Without this the
  // chart's anti-barcode filter rejects every fresh price for the new asset
  // because it compares against BTC-sized values still sitting in `spot`/
  // `futures` state from before the symbol changed.
  useEffect(() => {
    setSpot(null);
    setFutures(null);
  }, [symbol]);

  // Stable connect functions that read from refs -- never recreated
  const connectSpot = useCallback(() => {
    if (!enabledRef.current) return;
    if (spotWsRef.current) { spotWsRef.current.close(); spotWsRef.current = null; }
    if (spotReconnectRef.current) { clearTimeout(spotReconnectRef.current); spotReconnectRef.current = null; }
    if (spotStaleTimerRef.current) { clearTimeout(spotStaleTimerRef.current); spotStaleTimerRef.current = null; }

    spotOpenedRef.current = false;
    const host = SPOT_HOSTS[spotHostIdxRef.current];
    const ws = new WebSocket(`wss://${host}/ws/${symbolRef.current}@trade`);
    spotWsRef.current = ws;
    // Guard against orphaned sockets: every async handler below checks
    // that this `ws` is still the active one before mutating shared
    // state. Without this, a previous symbol's socket finishing its
    // close/message lifecycle after the user picks a new asset would
    // overwrite the new socket's ref or smear stale prices into the UI.
    const isActive = () => spotWsRef.current === ws;

    // Rotate host and force-close if we go too long without trades. The
    // socket's own onclose handler will kick off the reconnect to the new
    // host.
    const armStaleTimer = (timeoutMs: number) => {
      if (spotStaleTimerRef.current) clearTimeout(spotStaleTimerRef.current);
      spotStaleTimerRef.current = setTimeout(() => {
        // A newer connectSpot() may have replaced the active socket before
        // this timer fired — closing the live one would yank the user
        // offline mid-stream.
        if (!isActive()) return;
        spotHostIdxRef.current = (spotHostIdxRef.current + 1) % SPOT_HOSTS.length;
        try { ws.close(); } catch {}
      }, timeoutMs);
    };

    ws.onopen = () => {
      if (!mountedRef.current || !isActive()) { ws.close(); return; }
      spotOpenedRef.current = true;
      setSpotConnected(true);
      armStaleTimer(FIRST_TRADE_TIMEOUT_MS);
    };
    ws.onmessage = (event) => {
      if (!mountedRef.current || !isActive()) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.e === "trade") {
          setSpot({ price: parseFloat(msg.p), symbol: msg.s, timestamp: msg.T || Date.now() });
          armStaleTimer(IDLE_TRADE_TIMEOUT_MS);
        }
      } catch {}
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      // Orphan: a newer connectSpot() already replaced the ref. Don't
      // touch shared state and don't schedule a reconnect — that would
      // either null out the new socket's ref or kick off a duplicate
      // socket pumping stale prices into the UI.
      if (!isActive()) return;
      if (!mountedRef.current) return;
      setSpotConnected(false);
      spotWsRef.current = null;
      if (spotStaleTimerRef.current) { clearTimeout(spotStaleTimerRef.current); spotStaleTimerRef.current = null; }
      // If the socket closed without ever opening, the host is likely
      // geo-blocked on this network. Rotate to the next candidate host.
      if (!spotOpenedRef.current) {
        spotHostIdxRef.current = (spotHostIdxRef.current + 1) % SPOT_HOSTS.length;
      }
      if (enabledRef.current) {
        spotReconnectRef.current = setTimeout(connectSpot, 2000);
      }
    };
  }, []);

  const connectFutures = useCallback(() => {
    if (!enabledRef.current) return;
    if (futuresWsRef.current) { futuresWsRef.current.close(); futuresWsRef.current = null; }
    if (futuresReconnectRef.current) { clearTimeout(futuresReconnectRef.current); futuresReconnectRef.current = null; }

    const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbolRef.current}@trade`);
    futuresWsRef.current = ws;
    const isActive = () => futuresWsRef.current === ws;

    ws.onopen = () => {
      if (!mountedRef.current || !isActive()) { ws.close(); return; }
      setFuturesConnected(true);
    };
    ws.onmessage = (event) => {
      if (!mountedRef.current || !isActive()) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.e === "trade") {
          setFutures({ price: parseFloat(msg.p), symbol: msg.s, timestamp: msg.T || Date.now() });
        }
      } catch {}
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (!isActive()) return;
      if (!mountedRef.current) return;
      setFuturesConnected(false);
      futuresWsRef.current = null;
      if (enabledRef.current) {
        futuresReconnectRef.current = setTimeout(connectFutures, 2000);
      }
    };
  }, []);

  // Single effect that depends only on actual value changes
  useEffect(() => {
    if (enabled) {
      connectSpot();
      connectFutures();
    }
    return () => {
      if (spotReconnectRef.current) { clearTimeout(spotReconnectRef.current); spotReconnectRef.current = null; }
      if (futuresReconnectRef.current) { clearTimeout(futuresReconnectRef.current); futuresReconnectRef.current = null; }
      if (spotStaleTimerRef.current) { clearTimeout(spotStaleTimerRef.current); spotStaleTimerRef.current = null; }
      if (spotWsRef.current) { spotWsRef.current.close(); spotWsRef.current = null; }
      if (futuresWsRef.current) { futuresWsRef.current.close(); futuresWsRef.current = null; }
    };
  }, [enabled, symbol, connectSpot, connectFutures]);

  return { spot, futures, spotConnected, futuresConnected };
}
