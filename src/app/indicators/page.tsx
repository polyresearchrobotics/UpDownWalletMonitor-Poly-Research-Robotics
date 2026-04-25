'use client';

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useBinancePrice } from "@/hooks/useBinancePrice";
import { useBTCMarketWebSocket } from "@/hooks/useBTCMarketWebSocket";
import type { BookDepthSnapshot } from "@/hooks/useBTCMarketWebSocket";
import { useChainlinkStream } from "@/hooks/useChainlinkStream";
import type { WalletTrade } from "@/hooks/useWalletTracker";
import { useWalletTradeStream } from "@/hooks/useWalletTradeStream";
import { IndicatorChart } from "@/components/indicators/IndicatorChart";
import { WalletsPanel } from "@/components/indicators/WalletsPanel";
import { Modal } from "@/components/indicators/Modal";
import {
  IndicatorsSidebar,
  ConnectionsIcon,
  SIDEBAR_WIDTH,
  type SidebarButton,
} from "@/components/indicators/IndicatorsSidebar";
import {
  getAsset,
  getTimeframe,
  type AssetId,
  type TimeframeId,
} from "@/lib/markets";
import type { Crypto5mMarket, Crypto5mResponse } from "@/app/api/crypto/5m-markets/route";

interface TrackedWallet {
  address: string;
  label: string;
  enabled: boolean;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function StatusRow({
  connected,
  label,
  disabled = false,
  settingsHref,
  onNavigate,
}: {
  connected: boolean;
  label: string;
  /** Feed has no credentials configured — show "Disabled" + Connect button. */
  disabled?: boolean;
  /** Where the Connect button routes to (e.g. "/settings"). */
  settingsHref?: string;
  /** Called before navigation so the parent can close the modal. */
  onNavigate?: () => void;
}) {
  const dotColor = disabled
    ? "rgba(236,236,243,0.35)"
    : connected
    ? "var(--success)"
    : "rgba(255,93,115,0.7)";
  const dotGlow = !disabled && connected ? "0 0 8px var(--success)" : "none";
  const statusText = disabled ? "Disabled" : connected ? "Live" : "Offline";
  const statusColor = disabled
    ? "var(--muted-foreground)"
    : connected
    ? "var(--success)"
    : "var(--danger)";

  return (
    <div
      className="flex items-center justify-between px-4 py-3 rounded-lg"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: dotColor, boxShadow: dotGlow }}
        />
        <span className="text-[13px] text-[var(--foreground)]">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span
          className="text-[11px] uppercase tracking-wide font-mono"
          style={{ color: statusColor }}
        >
          {statusText}
        </span>
        {disabled && settingsHref && (
          <Link
            href={settingsHref}
            onClick={onNavigate}
            className="text-[11px] uppercase tracking-wide font-mono px-2.5 py-1 rounded-md transition-colors"
            style={{
              background: "var(--surface-hover)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
            }}
          >
            Connect
          </Link>
        )}
      </div>
    </div>
  );
}

function formatPrice(price: number): string {
  return `$${price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function PriceCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "up" | "down" | "neutral";
}) {
  const color =
    accent === "up"
      ? "var(--success)"
      : accent === "down"
      ? "var(--danger)"
      : "var(--foreground)";
  return (
    <div className="card p-7 md:p-8">
      <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--subtle-foreground)]">
        {label}
      </div>
      <div
        className="mt-4 text-[22px] md:text-[26px] font-semibold font-mono tracking-tight leading-none"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

function OrderbookPanel({
  label,
  book,
  accentColor,
}: {
  label: string;
  book: BookDepthSnapshot | undefined;
  accentColor: "up" | "down";
}) {
  const maxLevels = 10;
  const bids = book?.bids.slice(0, maxLevels) ?? [];
  const asks = book?.asks.slice(0, maxLevels) ?? [];
  const maxSize = Math.max(
    ...bids.map((l) => l.size),
    ...asks.map((l) => l.size),
    1
  );
  const color = accentColor === "up" ? "var(--success)" : "var(--danger)";
  const barBg =
    accentColor === "up"
      ? "rgba(52, 208, 140, 0.12)"
      : "rgba(255, 93, 115, 0.12)";

  return (
    <div className="card overflow-hidden">
      <div
        className="px-6 py-5 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
          />
          <span className="text-[13px] font-semibold text-[var(--foreground)]">
            {label}
          </span>
        </div>
        <span className="text-[11px] text-[var(--muted-foreground)] font-mono">
          Spread{" "}
          {asks[0] && bids[0]
            ? `${((asks[0].price - bids[0].price) * 100).toFixed(1)}¢`
            : "—"}
        </span>
      </div>
      <div
        className="grid grid-cols-2"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div style={{ borderRight: "1px solid var(--border)" }}>
          <div
            className="grid grid-cols-2 px-5 py-2.5 text-[10px] uppercase tracking-wide text-[var(--subtle-foreground)]"
            style={{ background: "var(--surface-2)" }}
          >
            <span>Bid</span>
            <span className="text-right">Size</span>
          </div>
          {bids.length === 0 ? (
            <div className="px-5 py-8 text-[11px] text-[var(--subtle-foreground)] text-center">
              No bids
            </div>
          ) : (
            bids.map((level, i) => (
              <div
                key={i}
                className="relative grid grid-cols-2 px-5 py-2 text-[12px] font-mono"
              >
                <div
                  className="absolute inset-y-0 right-0"
                  style={{
                    width: `${(level.size / maxSize) * 100}%`,
                    background: barBg,
                  }}
                />
                <span className="relative z-10" style={{ color }}>
                  {(level.price * 100).toFixed(1)}¢
                </span>
                <span className="relative z-10 text-right text-[var(--muted-foreground)]">
                  {level.size >= 1000
                    ? `${(level.size / 1000).toFixed(1)}k`
                    : level.size.toFixed(0)}
                </span>
              </div>
            ))
          )}
        </div>
        <div>
          <div
            className="grid grid-cols-2 px-5 py-2.5 text-[10px] uppercase tracking-wide text-[var(--subtle-foreground)]"
            style={{ background: "var(--surface-2)" }}
          >
            <span>Ask</span>
            <span className="text-right">Size</span>
          </div>
          {asks.length === 0 ? (
            <div className="px-5 py-8 text-[11px] text-[var(--subtle-foreground)] text-center">
              No asks
            </div>
          ) : (
            asks.map((level, i) => (
              <div
                key={i}
                className="relative grid grid-cols-2 px-5 py-2 text-[12px] font-mono"
              >
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${(level.size / maxSize) * 100}%`,
                    background: barBg,
                  }}
                />
                <span className="relative z-10" style={{ color }}>
                  {(level.price * 100).toFixed(1)}¢
                </span>
                <span className="relative z-10 text-right text-[var(--muted-foreground)]">
                  {level.size >= 1000
                    ? `${(level.size / 1000).toFixed(1)}k`
                    : level.size.toFixed(0)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function IndicatorsPage() {
  const [assetId, setAssetId] = useState<AssetId>("btc");
  const [timeframeId, setTimeframeId] = useState<TimeframeId>("5m");
  const asset = getAsset(assetId);
  const timeframe = getTimeframe(timeframeId);

  const { spot, futures, spotConnected, futuresConnected } = useBinancePrice({
    symbol: asset.binance,
  });

  const marketsUrl = `/api/crypto/5m-markets?asset=${assetId}&timeframe=${timeframeId}`;
  const { data: marketsData, mutate: refreshMarkets } =
    useSWR<Crypto5mResponse>(marketsUrl, fetcher, {
      refreshInterval: 2000,
    });

  const [liveMarket, setLiveMarket] = useState<Crypto5mMarket | null>(null);
  const [nextMarket, setNextMarket] = useState<Crypto5mMarket | null>(null);

  const liveMarketRef = useRef<Crypto5mMarket | null>(null);
  const nextMarketRef = useRef<Crypto5mMarket | null>(null);

  // When asset or timeframe changes, reset the current market tracking so the
  // chart doesn't keep drawing against a stale cycle. We also clear
  // lastValidCycleRef below so the chart waits for the new cycle bounds
  // instead of mounting with stale ones.
  useEffect(() => {
    liveMarketRef.current = null;
    nextMarketRef.current = null;
    setLiveMarket(null);
    setNextMarket(null);
  }, [assetId, timeframeId]);

  useEffect(() => {
    function update() {
      const markets = marketsData?.markets;
      const now = Math.floor(Date.now() / 1000);
      const prev = liveMarketRef.current;

      if (!markets || markets.length === 0) {
        if (prev && now < prev.endTime) return;
        if (prev && now >= prev.endTime) {
          liveMarketRef.current = null;
          setLiveMarket(null);
        }
        if (nextMarketRef.current !== null) {
          nextMarketRef.current = null;
          setNextMarket(null);
        }
        refreshMarkets();
        return;
      }

      const live =
        markets.find((m) => now >= m.startTime && now < m.endTime) ?? null;
      const next = markets.find((m) => m.startTime > now) ?? null;

      if (!live && prev && now < prev.endTime) {
        // keep current
      } else if (live?.slug !== prev?.slug) {
        liveMarketRef.current = live;
        setLiveMarket(live);
      }

      if (next?.slug !== nextMarketRef.current?.slug) {
        nextMarketRef.current = next;
        setNextMarket(next);
      }

      if (!live && (!prev || now >= prev.endTime)) refreshMarkets();
    }
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [marketsData, refreshMarkets]);

  const rapidPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!liveMarket) return;
    const now = Date.now() / 1000;
    const prefetchAt = liveMarket.endTime - 10;
    const delayMs = Math.max(0, (prefetchAt - now) * 1000);

    const timer = setTimeout(() => {
      refreshMarkets();
      rapidPollRef.current = setInterval(() => refreshMarkets(), 500);
      setTimeout(() => {
        if (rapidPollRef.current) {
          clearInterval(rapidPollRef.current);
          rapidPollRef.current = null;
        }
      }, 12000);
    }, delayMs);
    return () => {
      clearTimeout(timer);
      if (rapidPollRef.current) {
        clearInterval(rapidPollRef.current);
        rapidPollRef.current = null;
      }
    };
  }, [liveMarket?.slug, liveMarket?.endTime, refreshMarkets]);

  const tokenIdsKey =
    liveMarket?.clobTokenIds && liveMarket.clobTokenIds.length >= 2
      ? liveMarket.clobTokenIds.join(",")
      : "";
  const tokenIds = useMemo(() => {
    if (!tokenIdsKey) return [];
    return tokenIdsKey.split(",");
  }, [tokenIdsKey]);

  const lastValidTokenIdsRef = useRef<string[]>([]);
  if (tokenIds.length >= 2) lastValidTokenIdsRef.current = tokenIds;

  const nextTokenIdsKey =
    nextMarket?.clobTokenIds && nextMarket.clobTokenIds.length >= 2
      ? nextMarket.clobTokenIds.join(",")
      : "";
  const allTokenIds = useMemo(() => {
    const ids = [...tokenIds];
    if (nextTokenIdsKey) {
      for (const id of nextTokenIdsKey.split(",")) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenIdsKey, nextTokenIdsKey]);

  const {
    prices: polyPrices,
    books,
    isConnected: polyConnected,
  } = useBTCMarketWebSocket({
    tokenIds: allTokenIds,
    enabled: allTokenIds.length >= 2,
  });

  const upTokenId = tokenIds[0];
  const downTokenId = tokenIds[1];
  const upData = upTokenId ? polyPrices.get(upTokenId) : undefined;
  const downData = downTokenId ? polyPrices.get(downTokenId) : undefined;
  const upBook = upTokenId ? books.get(upTokenId) : undefined;
  const downBook = downTokenId ? books.get(downTokenId) : undefined;

  const { prices: chainlinkPrices, status: chainlinkStatus } = useChainlinkStream();
  const chainlinkPrice =
    chainlinkPrices?.[asset.chainlinkSymbol] ?? null;

  const spread = spot && futures ? futures.price - spot.price : null;

  const [cycleProgress, setCycleProgress] = useState(0);
  useEffect(() => {
    if (!liveMarket) {
      setCycleProgress(0);
      return;
    }
    function updateProgress() {
      const now = Date.now() / 1000;
      const total = liveMarket!.endTime - liveMarket!.startTime;
      const elapsed = now - liveMarket!.startTime;
      setCycleProgress(Math.min(100, Math.max(0, (elapsed / total) * 100)));
    }
    updateProgress();
    const timer = setInterval(updateProgress, 500);
    return () => clearInterval(timer);
  }, [liveMarket]);

  const lastValidCycleRef = useRef<{
    start: number;
    end: number;
    slug: string;
    asset: AssetId;
    timeframe: TimeframeId;
  } | null>(null);
  // Drop stale cycle bounds the moment the user changes asset/timeframe so the
  // chart doesn't briefly mount with the previous timeframe's window.
  if (
    lastValidCycleRef.current &&
    (lastValidCycleRef.current.asset !== assetId ||
      lastValidCycleRef.current.timeframe !== timeframeId)
  ) {
    lastValidCycleRef.current = null;
  }
  if (liveMarket && liveMarket.startTime > 0) {
    if (lastValidCycleRef.current?.slug !== liveMarket.slug) {
      lastValidCycleRef.current = {
        start: liveMarket.startTime,
        end: liveMarket.endTime,
        slug: liveMarket.slug,
        asset: assetId,
        timeframe: timeframeId,
      };
    }
  }
  const chartCycleStartTime = lastValidCycleRef.current?.start ?? 0;
  const chartCycleEndTime = lastValidCycleRef.current?.end ?? 0;

  const chainlinkOk =
    chainlinkStatus === "healthy" || chainlinkStatus === "partial";
  const chainlinkDisabled = chainlinkStatus === "disabled";

  // ── Tracked wallets + live trades (via Polymarket RTDS WebSocket) ────────
  const [trackedWallets, setTrackedWallets] = useState<TrackedWallet[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/cycle-logger/wallets");
        if (res.ok) {
          const data = await res.json();
          setTrackedWallets(data.wallets || []);
        }
      } catch {}
    }
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const walletAddresses = useMemo(
    () =>
      trackedWallets
        .filter((w) => w.enabled)
        .map((w) => w.address.toLowerCase()),
    [trackedWallets]
  );

  const { trades: walletStreamTrades, isStreaming: walletStreamConnected } =
    useWalletTradeStream({
      wallets: walletAddresses,
      enabled: walletAddresses.length > 0,
    });

  // Filter to just trades on the current cycle's UP/DOWN tokens so the
  // chart only plots markers that belong on it.
  const chartCycleSlug = lastValidCycleRef.current?.slug ?? null;
  const walletTrades: WalletTrade[] = useMemo(() => {
    if (!chartCycleSlug || tokenIds.length < 2) return [];
    const upToken = tokenIds[0];
    const downToken = tokenIds[1];
    const filtered = walletStreamTrades.filter(
      (t) =>
        t.marketSlug === chartCycleSlug ||
        t.tokenId === upToken ||
        t.tokenId === downToken
    );
    // Widen outcome from token id when the stream's token_label is missing.
    return filtered.map((t) => ({
      id: t.id,
      tokenId: t.tokenId,
      tokenLabel: t.tokenLabel,
      side: t.side,
      outcome:
        t.outcome !== "UNKNOWN"
          ? t.outcome
          : t.tokenId === upToken
          ? "UP"
          : t.tokenId === downToken
          ? "DOWN"
          : "UNKNOWN",
      price: t.price,
      priceCents: t.priceCents,
      shares: t.shares,
      sharesNormalized: t.sharesNormalized,
      cost: t.cost,
      timestamp: t.timestamp,
      txHash: t.txHash,
      orderHash: t.orderHash,
      executionRole: t.executionRole,
    }));
  }, [walletStreamTrades, chartCycleSlug, tokenIds]);

  type PanelId = "connections";
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);

  const allConnected =
    spotConnected &&
    futuresConnected &&
    chainlinkOk &&
    polyConnected &&
    (walletAddresses.length === 0 || walletStreamConnected);

  const sidebarButtons: SidebarButton[] = [
    {
      id: "connections",
      label: "Connections",
      icon: ConnectionsIcon,
      badge: (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background: allConnected
              ? "var(--success)"
              : "rgba(255,93,115,0.85)",
            boxShadow: allConnected ? "0 0 6px var(--success)" : "none",
          }}
        />
      ),
    },
  ];

  return (
    <div className="pb-32" style={{ paddingLeft: SIDEBAR_WIDTH }}>
      <IndicatorsSidebar
        asset={assetId}
        timeframe={timeframeId}
        onAssetChange={setAssetId}
        onTimeframeChange={setTimeframeId}
        buttons={sidebarButtons}
        activeButtonId={openPanel}
        onButtonClick={(id) =>
          setOpenPanel((cur) => (cur === id ? null : (id as PanelId)))
        }
      />

      <div className="max-w-[1120px] mx-auto px-6 md:px-10">
        {/* Hero header */}
        <div className="pt-14 pb-12 text-center">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-[var(--foreground)]">
            Crypto Market Monitor
          </h1>
          <p className="mt-3 text-[14px] text-[var(--muted-foreground)] max-w-xl mx-auto">
            Real-time Binance, Chainlink and Polymarket data across all tracked
            up/down markets.
          </p>
        </div>

      {/* Price cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-5 md:gap-6">
        <PriceCard
          label={`Binance ${asset.symbol} Spot`}
          value={spot ? formatPrice(spot.price) : "—"}
        />
        <PriceCard
          label={`Binance ${asset.symbol} Futures`}
          value={futures ? formatPrice(futures.price) : "—"}
        />
        <PriceCard
          label={`Chainlink ${asset.symbol}`}
          value={
            chainlinkPrice
              ? formatPrice(chainlinkPrice.price)
              : "—"
          }
        />
        <PriceCard
          label="UP Share"
          value={upData ? `${(upData.midPrice * 100).toFixed(1)}¢` : "—"}
          accent="up"
        />
        <PriceCard
          label="DOWN Share"
          value={downData ? `${(downData.midPrice * 100).toFixed(1)}¢` : "—"}
          accent="down"
        />
      </div>

      {/* Cycle info */}
      {liveMarket && (
        <div className="card p-7 md:p-8 mt-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--subtle-foreground)]">
                  Cycle
                </div>
                <div className="mt-1.5 font-mono text-[13px] text-[var(--foreground)]">
                  {liveMarket.slug}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--subtle-foreground)]">
                  Spot / Futures Spread
                </div>
                <div
                  className="mt-1.5 font-mono text-[13px]"
                  style={{
                    color:
                      spread === null
                        ? "var(--muted-foreground)"
                        : spread > 0
                        ? "var(--success)"
                        : "var(--danger)",
                  }}
                >
                  {spread !== null
                    ? `${spread >= 0 ? "+" : ""}${spread.toFixed(2)}`
                    : "—"}
                </div>
              </div>
            </div>
            <div className="font-mono text-[13px] text-[var(--muted-foreground)]">
              {cycleProgress.toFixed(0)}%
            </div>
          </div>
          <div
            className="mt-6 h-1.5 rounded-full overflow-hidden"
            style={{ background: "var(--surface-2)" }}
          >
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${cycleProgress}%`,
                background:
                  "linear-gradient(90deg, var(--accent) 0%, #5eaaff 100%)",
              }}
            />
          </div>
        </div>
      )}

      {/* Wallets */}
      <div className="mt-10">
        <WalletsPanel />
      </div>

      {/* Chart */}
      <div className="mt-10">
        {chartCycleStartTime > 0 && chartCycleEndTime > 0 ? (
          <IndicatorChart
            key={`${assetId}-${timeframeId}`}
            polymarketTokenIds={
              tokenIds.length >= 2 ? tokenIds : lastValidTokenIdsRef.current
            }
            cycleStartTime={chartCycleStartTime}
            cycleEndTime={chartCycleEndTime}
            chainlinkPrice={chainlinkPrice?.price ?? null}
            upMidPrice={upData?.midPrice ?? null}
            downMidPrice={downData?.midPrice ?? null}
            spotPrice={spot?.price ?? null}
            futuresPrice={futures?.price ?? null}
            walletTrades={walletTrades}
            assetSymbol={asset.symbol}
            rangeOptions={asset.rangeOptions}
            defaultRange={asset.defaultRange}
          />
        ) : (
          <div className="card p-16 text-center">
            <div className="text-[14px] text-[var(--foreground)]">
              Waiting for the next {timeframe.label.toLowerCase()} {asset.symbol} market…
            </div>
            <div className="mt-2 text-[12px] text-[var(--muted-foreground)]">
              Polling Polymarket every few seconds.
            </div>
          </div>
        )}
        <p className="mt-3 text-[11px] text-[var(--subtle-foreground)] italic">
          * Some trades may plot slightly off of the line. This is due to
          traders filling at prices above or below mid price.
        </p>
      </div>

      {/* Orderbooks */}
      {tokenIds.length >= 2 && (
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          <OrderbookPanel label="UP Orderbook" book={upBook} accentColor="up" />
          <OrderbookPanel
            label="DOWN Orderbook"
            book={downBook}
            accentColor="down"
          />
        </div>
      )}
      </div>

      <Modal
        open={openPanel === "connections"}
        onClose={() => setOpenPanel(null)}
        title="Connections"
        description="Live status of every market data feed."
        widthClass="max-w-[480px]"
      >
        <div className="flex flex-col gap-2.5">
          <StatusRow connected={spotConnected} label="Binance Spot" />
          <StatusRow connected={futuresConnected} label="Binance Futures" />
          <StatusRow
            connected={chainlinkOk}
            label="Chainlink"
            disabled={chainlinkDisabled}
            settingsHref="/settings"
            onNavigate={() => setOpenPanel(null)}
          />
          <StatusRow connected={polyConnected} label="Polymarket" />
          {walletAddresses.length > 0 && (
            <StatusRow connected={walletStreamConnected} label="Wallet Stream" />
          )}
        </div>
      </Modal>
    </div>
  );
}
