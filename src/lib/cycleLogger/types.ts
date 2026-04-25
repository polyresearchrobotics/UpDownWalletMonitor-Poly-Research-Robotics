// ── Tracked wallet config ──
export interface TrackedWallet {
  address: string;
  label: string;
  enabled: boolean;
}

// ── Persisted config ──
export interface CycleLoggerConfig {
  logPath: string; // base directory for CSV output
  wallets: TrackedWallet[];
}

// ── Market info (minimal subset of Crypto5mMarket) ──
export interface CycleMarket {
  slug: string;
  clobTokenIds: [string, string]; // [UP, DOWN]
  startTime: number; // unix seconds
  endTime: number; // unix seconds
}

// ── Orderbook level ──
export interface BookLevel {
  price: number;
  size: number;
}

// ── A trade detected from a tracked wallet ──
export interface LoggedTrade {
  id: string;
  wallet: string;
  side: "BUY" | "SELL";
  outcome: "UP" | "DOWN" | "UNKNOWN";
  price: number;
  shares: number;
  cost: number;
  executionRole: "TAKER" | "MAKER" | "UNKNOWN";
  timestamp: number;
}

// ── Status of the logger ──
export interface LoggerStatus {
  running: boolean;
  currentCycleSlug: string | null;
  nextCycleSlug: string | null;
  walletsTracked: number;
  secondsLogged: number;
  polyWsConnected: boolean;
}
