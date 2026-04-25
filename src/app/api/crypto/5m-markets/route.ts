import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/settings";
import {
  ASSETS,
  TIMEFRAMES,
  slugPrefix,
  type AssetId,
  type TimeframeId,
} from "@/lib/markets";

function resolveGammaBase(): string {
  return getApiKey("polymarketProxyGamma") || "https://gamma-api.polymarket.com";
}

interface CacheEntry { data: unknown; timestamp: number; }
const marketCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5000;
const MAX_CACHE_SIZE = 100;

// HMR-safe one-shot timer registration. Next.js dev re-imports this module
// on every edit; without the globalThis guard every hot-reload stacked
// another setInterval that was never cleared, leaking timers indefinitely.
declare global {
  // eslint-disable-next-line no-var
  var __walletTrackerMarketCachePrune: NodeJS.Timeout | undefined;
}
const g = globalThis as typeof globalThis & {
  __walletTrackerMarketCachePrune?: NodeJS.Timeout;
};
if (g.__walletTrackerMarketCachePrune) {
  clearInterval(g.__walletTrackerMarketCachePrune);
}
g.__walletTrackerMarketCachePrune = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of marketCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS * 6) marketCache.delete(key);
  }
  if (marketCache.size > MAX_CACHE_SIZE) {
    const sorted = [...marketCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < sorted.length - MAX_CACHE_SIZE; i++) marketCache.delete(sorted[i][0]);
  }
}, 60_000);

export interface Crypto5mMarket {
  id: string;
  slug: string;
  asset: string;
  timeframe: string;
  title: string;
  question: string;
  outcomes: string[];
  outcomePrices: number[];
  clobTokenIds: string[];
  startTime: number;
  endTime: number;
  volume: number;
  liquidity: number;
  active: boolean;
  closed: boolean;
  conditionId: string;
}

export interface Crypto5mResponse {
  markets: Crypto5mMarket[];
  currentTimestamp: number;
  asset: string;
  timeframe: string;
}

function getIntervals(
  baseTimestamp: number,
  count: number,
  seconds: number
): number[] {
  const intervalMs = seconds * 1000;
  const roundedTime = Math.floor(baseTimestamp / intervalMs) * intervalMs;
  const timestamps: number[] = [];
  for (let i = -1; i < count; i++) {
    timestamps.push(Math.floor((roundedTime + i * intervalMs) / 1000));
  }
  return timestamps;
}

async function fetchEventBySlug(slug: string): Promise<any | null> {
  const cached = marketCache.get(slug);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const gammaBase = resolveGammaBase();
    const response = await fetch(`${gammaBase}/events/slug/${slug}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    if (!response.ok) return null;
    const data = await response.json();
    marketCache.set(slug, { data, timestamp: Date.now() });
    return data;
  } catch {
    const staleCache = marketCache.get(slug);
    return staleCache?.data ?? null;
  }
}

function parseMarket(
  market: any,
  eventData: any,
  prefix: string,
  cycleSeconds: number,
  assetId: string,
  timeframeId: string,
  fallbackTitle: string
): Crypto5mMarket | null {
  try {
    const slug = market.slug || market.market_slug || "";
    const regex = new RegExp(`${prefix}-(\\d+)`);
    const timestampMatch = slug.match(regex);
    if (!timestampMatch) return null;

    const startTimestamp = parseInt(timestampMatch[1], 10);
    const endTimestamp = startTimestamp + cycleSeconds;

    let outcomes: string[] = ["Up", "Down"];
    if (market.outcomes) {
      try {
        outcomes = typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : market.outcomes;
      } catch { outcomes = market.outcomes.split(",").map((s: string) => s.trim()); }
    }

    let outcomePrices: number[] = [0.5, 0.5];
    if (market.outcomePrices) {
      try {
        const prices = typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : market.outcomePrices;
        outcomePrices = prices.map((p: string | number) => parseFloat(String(p)));
      } catch {}
    }

    let clobTokenIds: string[] = [];
    if (market.clobTokenIds) {
      try {
        clobTokenIds = typeof market.clobTokenIds === "string" ? JSON.parse(market.clobTokenIds) : market.clobTokenIds;
      } catch {}
    }

    return {
      id: market.id || market.conditionId || slug,
      slug,
      asset: assetId,
      timeframe: timeframeId,
      title: eventData?.title || market.question || market.title || fallbackTitle,
      question: market.question || market.title || "",
      outcomes, outcomePrices, clobTokenIds,
      startTime: startTimestamp, endTime: endTimestamp,
      volume: parseFloat(market.volume || market.volumeNum || "0"),
      liquidity: parseFloat(market.liquidity || "0"),
      active: market.active !== false && !market.closed,
      closed: market.closed === true,
      conditionId: market.conditionId || market.condition_id || "",
    };
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const liveOnly = url.searchParams.get("liveOnly") === "true";
    const assetParam = (url.searchParams.get("asset") || "btc").toLowerCase();
    const timeframeParam = (url.searchParams.get("timeframe") || "5m").toLowerCase();

    const asset = ASSETS.find((a) => a.id === assetParam);
    const timeframe = TIMEFRAMES.find((t) => t.id === timeframeParam);
    if (!asset || !timeframe) {
      return NextResponse.json(
        { error: `Unsupported asset or timeframe: ${assetParam}/${timeframeParam}` },
        { status: 400 }
      );
    }

    const prefix = slugPrefix(asset.id, timeframe.id);
    const fallbackTitle = `${asset.label} Up/Down ${timeframe.label}`;

    const now = Date.now();
    const currentTimestampSec = Math.floor(now / 1000);
    const intervals = getIntervals(now, 4, timeframe.seconds);
    const markets: Crypto5mMarket[] = [];

    for (const timestamp of intervals) {
      const slug = `${prefix}-${timestamp}`;
      try {
        const eventData = await fetchEventBySlug(slug);
        if (eventData?.markets?.length > 0) {
          const parsed = parseMarket(
            eventData.markets[0],
            eventData,
            prefix,
            timeframe.seconds,
            asset.id,
            timeframe.id,
            fallbackTitle
          );
          if (parsed) markets.push(parsed);
        }
      } catch {}
    }

    let filtered = markets;
    if (liveOnly) {
      filtered = markets.filter(
        (m) => currentTimestampSec >= m.startTime && currentTimestampSec < m.endTime
      );
    }
    filtered.sort((a, b) => a.startTime - b.startTime);

    return NextResponse.json({
      markets: filtered,
      currentTimestamp: currentTimestampSec,
      asset: asset.id,
      timeframe: timeframe.id,
    } as Crypto5mResponse);
  } catch (error) {
    console.error("[markets] Error:", error);
    return NextResponse.json({ error: "Failed to fetch markets" }, { status: 500 });
  }
}
