// Shape of a single tracked-wallet trade rendered on the indicators chart.
// The live source is now useWalletTradeStream (SSE from Polymarket RTDS);
// this file only keeps the type so existing imports continue to resolve.
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
