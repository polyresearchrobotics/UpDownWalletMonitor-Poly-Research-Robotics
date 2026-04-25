'use client';

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useBTCMarketWebSocket } from "@/hooks/useBTCMarketWebSocket";
import type { Crypto5mMarket, Crypto5mResponse } from "@/app/api/crypto/5m-markets/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

interface LoggerStatus {
  running: boolean;
  currentCycleSlug: string | null;
  secondsLogged: number;
  polyWsConnected: boolean;
}

function StatusPill({
  connected,
  label,
}: {
  connected: boolean;
  label: string;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px]"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
      }}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{
          background: connected ? "var(--success)" : "rgba(255,93,115,0.7)",
          boxShadow: connected ? "0 0 8px var(--success)" : "none",
        }}
      />
      <span className="text-[var(--muted-foreground)]">{label}</span>
    </div>
  );
}

export default function MarketLogPage() {
  const { data: marketsData } = useSWR<Crypto5mResponse>(
    "/api/crypto/5m-markets",
    fetcher,
    { refreshInterval: 2000 }
  );

  const liveMarketRef = useRef<Crypto5mMarket | null>(null);
  const [liveMarket, setLiveMarket] = useState<Crypto5mMarket | null>(null);

  useEffect(() => {
    function update() {
      const markets = marketsData?.markets;
      const now = Math.floor(Date.now() / 1000);
      const prev = liveMarketRef.current;
      if (!markets || markets.length === 0) {
        if (prev && now < prev.endTime) return;
        return;
      }
      const live =
        markets.find((m) => now >= m.startTime && now < m.endTime) ?? null;
      if (!live && prev && now < prev.endTime) return;
      if (live?.slug !== prev?.slug) {
        liveMarketRef.current = live;
        setLiveMarket(live);
      }
    }
    update();
    const t = setInterval(update, 500);
    return () => clearInterval(t);
  }, [marketsData]);

  const tokenIdsKey =
    liveMarket?.clobTokenIds?.length === 2
      ? liveMarket.clobTokenIds.join(",")
      : "";
  const tokenIds = tokenIdsKey ? tokenIdsKey.split(",") : [];
  const lastTokensRef = useRef<string[]>([]);
  if (tokenIds.length === 2) lastTokensRef.current = tokenIds;
  const stableTokens = lastTokensRef.current;

  const { prices: polyPrices, books, isConnected } = useBTCMarketWebSocket({
    tokenIds: stableTokens,
    enabled: stableTokens.length === 2,
  });

  const upData = stableTokens[0] ? polyPrices.get(stableTokens[0]) : undefined;
  const downData = stableTokens[1] ? polyPrices.get(stableTokens[1]) : undefined;
  const upBook = stableTokens[0] ? books.get(stableTokens[0]) : undefined;
  const downBook = stableTokens[1] ? books.get(stableTokens[1]) : undefined;

  const lastCycleRef = useRef<{
    start: number;
    end: number;
    slug: string;
  } | null>(null);
  if (liveMarket && liveMarket.startTime > 0) {
    if (lastCycleRef.current?.slug !== liveMarket.slug) {
      lastCycleRef.current = {
        start: liveMarket.startTime,
        end: liveMarket.endTime,
        slug: liveMarket.slug,
      };
    }
  }
  const cycle = lastCycleRef.current;

  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!cycle) {
      setProgress(0);
      setElapsed(0);
      return;
    }
    function tick() {
      const now = Date.now() / 1000;
      const total = cycle!.end - cycle!.start;
      const e = now - cycle!.start;
      setElapsed(Math.min(300, Math.max(0, Math.floor(e))));
      setProgress(Math.min(100, Math.max(0, (e / total) * 100)));
    }
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [cycle]);

  const [loggerStatus, setLoggerStatus] = useState<LoggerStatus | null>(null);
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch("/api/cycle-logger/control");
        if (res.ok) setLoggerStatus(await res.json());
      } catch {}
    }
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, []);

  const toggleLogger = useCallback(async () => {
    const action = loggerStatus?.running ? "stop" : "start";
    try {
      const res = await fetch("/api/cycle-logger/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) setLoggerStatus(await res.json());
    } catch {}
  }, [loggerStatus?.running]);

  interface PriceSnapshot {
    second: number;
    upMid: number;
    upBid: number;
    upAsk: number;
    downMid: number;
    downBid: number;
    downAsk: number;
    upLevels: number;
    downLevels: number;
  }

  const [priceHistory, setPriceHistory] = useState<PriceSnapshot[]>([]);
  const lastSecondRef = useRef(-1);

  useEffect(() => {
    if (!cycle || !upData || !downData) return;
    const t = setInterval(() => {
      const now = Date.now() / 1000;
      const second = Math.floor(now - cycle.start);
      if (second < 0 || second >= 300 || second === lastSecondRef.current)
        return;
      lastSecondRef.current = second;
      setPriceHistory((prev) => {
        const row: PriceSnapshot = {
          second,
          upMid: upData.midPrice,
          upBid: upData.bestBid,
          upAsk: upData.bestAsk,
          downMid: downData.midPrice,
          downBid: downData.bestBid,
          downAsk: downData.bestAsk,
          upLevels: (upBook?.bids.length ?? 0) + (upBook?.asks.length ?? 0),
          downLevels:
            (downBook?.bids.length ?? 0) + (downBook?.asks.length ?? 0),
        };
        const next = [...prev, row];
        if (next.length > 15) next.splice(0, next.length - 15);
        return next;
      });
    }, 250);
    return () => clearInterval(t);
  }, [cycle, upData, downData, upBook, downBook]);

  useEffect(() => {
    setPriceHistory([]);
    lastSecondRef.current = -1;
  }, [cycle?.slug]);

  return (
    <div className="max-w-[1120px] mx-auto px-6 md:px-10 pb-32">
      {/* Hero */}
      <div className="pt-14 pb-12 text-center">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-[var(--foreground)]">
          Market Log
        </h1>
        <p className="mt-3 text-[14px] text-[var(--muted-foreground)] max-w-xl mx-auto">
          Second-by-second mid, bid, ask and depth for the active 5-minute
          cycle.
        </p>
        <div className="mt-7 flex justify-center">
          <StatusPill connected={isConnected} label="Polymarket" />
        </div>
      </div>

      {/* Cycle bar */}
      {cycle && (
        <div className="card p-7 md:p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--subtle-foreground)]">
                  Cycle
                </div>
                <div className="font-mono text-[13px] text-[var(--foreground)]">
                  {cycle.slug}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--subtle-foreground)]">
                  Window
                </div>
                <div className="font-mono text-[13px] text-[var(--muted-foreground)]">
                  {formatTime(cycle.start)} → {formatTime(cycle.end)}
                </div>
              </div>
            </div>
            <div className="font-mono text-[13px] text-[var(--muted-foreground)]">
              {elapsed}s / 300s
            </div>
          </div>
          <div
            className="mt-4 h-1.5 rounded-full overflow-hidden"
            style={{ background: "var(--surface-2)" }}
          >
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                background:
                  "linear-gradient(90deg, var(--accent) 0%, #5eaaff 100%)",
              }}
            />
          </div>
        </div>
      )}

      {/* Live prices */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
        <div className="card p-7 md:p-8">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--subtle-foreground)]">
            UP Share
          </div>
          <div
            className="mt-3 text-3xl font-semibold font-mono"
            style={{ color: "var(--success)" }}
          >
            {upData ? `${(upData.midPrice * 100).toFixed(1)}¢` : "—"}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-5 text-[12px] text-[var(--muted-foreground)]">
            <span>
              Bid{" "}
              <span className="font-mono text-[var(--foreground)]">
                {upData ? `${(upData.bestBid * 100).toFixed(1)}¢` : "—"}
              </span>
            </span>
            <span>
              Ask{" "}
              <span className="font-mono text-[var(--foreground)]">
                {upData ? `${(upData.bestAsk * 100).toFixed(1)}¢` : "—"}
              </span>
            </span>
            <span>
              Depth{" "}
              <span className="font-mono text-[var(--foreground)]">
                {upBook
                  ? `${upBook.bids.length}b / ${upBook.asks.length}a`
                  : "—"}
              </span>
            </span>
          </div>
        </div>
        <div className="card p-7 md:p-8">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--subtle-foreground)]">
            DOWN Share
          </div>
          <div
            className="mt-3 text-3xl font-semibold font-mono"
            style={{ color: "var(--danger)" }}
          >
            {downData ? `${(downData.midPrice * 100).toFixed(1)}¢` : "—"}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-5 text-[12px] text-[var(--muted-foreground)]">
            <span>
              Bid{" "}
              <span className="font-mono text-[var(--foreground)]">
                {downData ? `${(downData.bestBid * 100).toFixed(1)}¢` : "—"}
              </span>
            </span>
            <span>
              Ask{" "}
              <span className="font-mono text-[var(--foreground)]">
                {downData ? `${(downData.bestAsk * 100).toFixed(1)}¢` : "—"}
              </span>
            </span>
            <span>
              Depth{" "}
              <span className="font-mono text-[var(--foreground)]">
                {downBook
                  ? `${downBook.bids.length}b / ${downBook.asks.length}a`
                  : "—"}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Logger control */}
      <div className="card p-7 md:p-9 mt-10">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center"
              style={{
                background: loggerStatus?.running
                  ? "rgba(52, 208, 140, 0.12)"
                  : "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  background:
                    loggerStatus?.running && loggerStatus.polyWsConnected
                      ? "var(--success)"
                      : "rgba(255,93,115,0.7)",
                }}
              />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-[var(--foreground)]">
                Cycle Logger
              </div>
              <div className="text-[12.5px] text-[var(--muted-foreground)] mt-0.5">
                {loggerStatus?.running
                  ? `Logging · ${loggerStatus.secondsLogged}s · ${
                      loggerStatus.currentCycleSlug ?? ""
                    }`
                  : "Stopped"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/settings" className="btn">
              Configure
            </Link>
            <button
              type="button"
              onClick={toggleLogger}
              className={
                loggerStatus?.running ? "btn btn-danger" : "btn btn-success"
              }
            >
              {loggerStatus?.running ? "Stop logger" : "Start logger"}
            </button>
          </div>
        </div>
      </div>

      {/* Live feed */}
      <div className="card mt-10 overflow-hidden">
        <div
          className="px-7 py-5 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <div className="text-[14px] font-semibold text-[var(--foreground)]">
              Live Feed
            </div>
            <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
              Last 15 seconds
            </div>
          </div>
          <span className="chip">Streaming</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead style={{ background: "var(--surface-2)" }}>
              <tr className="text-[10px] uppercase tracking-wide text-[var(--subtle-foreground)]">
                <th className="text-left py-3.5 px-6 font-medium">Sec</th>
                <th
                  className="text-right py-3.5 px-6 font-medium"
                  style={{ color: "var(--success)" }}
                >
                  UP Mid
                </th>
                <th
                  className="text-right py-3.5 px-6 font-medium"
                  style={{ color: "var(--success)" }}
                >
                  UP Bid
                </th>
                <th
                  className="text-right py-3.5 px-6 font-medium"
                  style={{ color: "var(--success)" }}
                >
                  UP Ask
                </th>
                <th
                  className="text-right py-3.5 px-6 font-medium"
                  style={{ color: "var(--danger)" }}
                >
                  DOWN Mid
                </th>
                <th
                  className="text-right py-3.5 px-6 font-medium"
                  style={{ color: "var(--danger)" }}
                >
                  DOWN Bid
                </th>
                <th
                  className="text-right py-3.5 px-6 font-medium"
                  style={{ color: "var(--danger)" }}
                >
                  DOWN Ask
                </th>
                <th className="text-right py-3.5 px-6 font-medium">UP Lvls</th>
                <th className="text-right py-3.5 px-6 font-medium">DOWN Lvls</th>
              </tr>
            </thead>
            <tbody>
              {priceHistory.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="text-center py-10 text-[var(--muted-foreground)]"
                  >
                    Waiting for cycle data…
                  </td>
                </tr>
              ) : (
                [...priceHistory].reverse().map((row) => (
                  <tr
                    key={row.second}
                    style={{ borderTop: "1px solid var(--border)" }}
                  >
                    <td className="py-3 px-6 font-mono text-[var(--muted-foreground)]">
                      {row.second}
                    </td>
                    <td
                      className="py-3 px-6 text-right font-mono"
                      style={{ color: "var(--success)" }}
                    >
                      {(row.upMid * 100).toFixed(1)}¢
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-[var(--muted-foreground)]">
                      {(row.upBid * 100).toFixed(1)}¢
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-[var(--muted-foreground)]">
                      {(row.upAsk * 100).toFixed(1)}¢
                    </td>
                    <td
                      className="py-3 px-6 text-right font-mono"
                      style={{ color: "var(--danger)" }}
                    >
                      {(row.downMid * 100).toFixed(1)}¢
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-[var(--muted-foreground)]">
                      {(row.downBid * 100).toFixed(1)}¢
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-[var(--muted-foreground)]">
                      {(row.downAsk * 100).toFixed(1)}¢
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-[var(--muted-foreground)]">
                      {row.upLevels}
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-[var(--muted-foreground)]">
                      {row.downLevels}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!cycle && (
        <div className="card p-16 text-center mt-10">
          <div className="text-[14px] text-[var(--foreground)]">
            Waiting for active 5-minute BTC market…
          </div>
        </div>
      )}
    </div>
  );
}
