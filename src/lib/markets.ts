// Shared asset + timeframe definitions for the live Indicators view.
// These drive the market selector, the Polymarket slug (e.g. `btc-updown-5m`),
// the Binance WebSocket symbol, the Chainlink feed lookup, and the BTC-range
// stepper options on the chart.

export type AssetId = "btc" | "eth" | "sol" | "xrp";
export type TimeframeId = "5m" | "15m";

export interface AssetDef {
  id: AssetId;
  label: string;
  symbol: string; // display ticker, e.g. "BTC"
  binance: string; // Binance WS symbol, lowercase, e.g. "btcusdt"
  chainlinkSymbol: "BTC" | "ETH" | "SOL" | "XRP";
  /** Price range options for the chart's ± selector, expressed in USD. */
  rangeOptions: number[];
  /** Default range from the stepper. */
  defaultRange: number;
}

export interface TimeframeDef {
  id: TimeframeId;
  label: string;
  /** Cycle duration in seconds. 5m → 300, 15m → 900. */
  seconds: number;
}

export const ASSETS: AssetDef[] = [
  {
    id: "btc",
    label: "Bitcoin",
    symbol: "BTC",
    binance: "btcusdt",
    chainlinkSymbol: "BTC",
    rangeOptions: [25, 50, 100, 200, 500, 1000],
    defaultRange: 500,
  },
  {
    id: "eth",
    label: "Ethereum",
    symbol: "ETH",
    binance: "ethusdt",
    chainlinkSymbol: "ETH",
    rangeOptions: [2, 5, 10, 20, 50, 100],
    defaultRange: 20,
  },
  {
    id: "sol",
    label: "Solana",
    symbol: "SOL",
    binance: "solusdt",
    chainlinkSymbol: "SOL",
    rangeOptions: [0.5, 1, 2, 5, 10, 20],
    defaultRange: 2,
  },
  {
    id: "xrp",
    label: "XRP",
    symbol: "XRP",
    binance: "xrpusdt",
    chainlinkSymbol: "XRP",
    rangeOptions: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5],
    defaultRange: 0.05,
  },
];

// Polymarket up/down markets follow the `{asset}-updown-{tf}` slug pattern.
// Add new timeframes here once the upstream slug scheme is confirmed.
export const TIMEFRAMES: TimeframeDef[] = [
  { id: "5m", label: "5 minute", seconds: 300 },
  { id: "15m", label: "15 minute", seconds: 900 },
];

export function getAsset(id: AssetId): AssetDef {
  return ASSETS.find((a) => a.id === id) ?? ASSETS[0];
}

export function getTimeframe(id: TimeframeId): TimeframeDef {
  return TIMEFRAMES.find((t) => t.id === id) ?? TIMEFRAMES[0];
}

export function slugPrefix(asset: AssetId, timeframe: TimeframeId): string {
  return `${asset}-updown-${timeframe}`;
}
