import { NextRequest, NextResponse } from "next/server";
import { waitForDomeRateLimit } from "@/lib/domeRateLimiter";
import { getDomeClient } from "@/lib/domeClient";
import { getApiKey } from "@/lib/settings";

const DOME_API_URL = "https://api.domeapi.io/v1";
const MAX_PAGES = 20;

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

export interface WalletTradesResponse {
  trades: WalletTrade[];
  wallet: string;
  marketSlug: string;
  totalTrades: number;
  totalVolume: number;
}

async function resolveWalletAddresses(wallet: string): Promise<Set<string>> {
  const addresses = new Set<string>();
  addresses.add(wallet.toLowerCase());
  try {
    const dome = getDomeClient();
    let resolved = await (dome as any).polymarket.wallet.getWallet({ eoa: wallet }).catch(() => null);
    if (!resolved) resolved = await (dome as any).polymarket.wallet.getWallet({ proxy: wallet }).catch(() => null);
    if (resolved) {
      if (resolved.eoa) addresses.add(resolved.eoa.toLowerCase());
      if (resolved.proxy) addresses.add(resolved.proxy.toLowerCase());
    }
  } catch {}
  return addresses;
}

async function fetchAllMarketOrders(marketSlug: string, apiKey: string): Promise<Record<string, any>[]> {
  const allOrders: Record<string, any>[] = [];
  let offset = 0;
  const limit = 500;
  let hasMore = true;
  let page = 0;

  while (hasMore && page < MAX_PAGES) {
    page++;
    await waitForDomeRateLimit();
    const url = `${DOME_API_URL}/polymarket/orders?market_slug=${encodeURIComponent(marketSlug)}&limit=${limit}&offset=${offset}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "x-api-key": apiKey, Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === "AbortError") break;
      throw err;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 502 || response.status === 503) {
        await new Promise(r => setTimeout(r, 1000));
        await waitForDomeRateLimit();
        const retryController = new AbortController();
        const retryTimeoutId = setTimeout(() => retryController.abort(), 15000);
        try {
          const retry = await fetch(url, {
            headers: { "x-api-key": apiKey, Accept: "application/json" },
            signal: retryController.signal,
          });
          clearTimeout(retryTimeoutId);
          if (retry.ok) {
            const data = await retry.json();
            const orders = data.orders || [];
            allOrders.push(...orders);
            hasMore = orders.length === limit;
            offset += limit;
            continue;
          }
        } catch {
          clearTimeout(retryTimeoutId);
        }
      }
      break;
    }

    const data = await response.json();
    const orders = data.orders || [];
    allOrders.push(...orders);
    hasMore = orders.length === limit;
    offset += limit;
    if (hasMore) await new Promise(r => setTimeout(r, 50));
  }
  return allOrders;
}

function resolveOutcome(tokenId: string, upTokenId?: string, downTokenId?: string): "UP" | "DOWN" | "UNKNOWN" {
  if (upTokenId && tokenId === upTokenId) return "UP";
  if (downTokenId && tokenId === downTokenId) return "DOWN";
  return "UNKNOWN";
}

function inferRole(order: Record<string, any>, walletAddresses: Set<string>): "TAKER" | "MAKER" | "UNKNOWN" {
  const rawType = (order.type || order.order_type || order.orderType || "").toString().toUpperCase();
  if (rawType === "GTC" || rawType === "GTD") return "MAKER";
  if (rawType === "FOK" || rawType === "FAK") return "TAKER";
  const userField = (order.user || "").toString().toLowerCase();
  const takerField = (order.taker || "").toString().toLowerCase();
  if (walletAddresses.has(takerField)) return "TAKER";
  if (walletAddresses.has(userField) && takerField && !walletAddresses.has(takerField)) return "MAKER";
  return "UNKNOWN";
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const wallet = url.searchParams.get("wallet");
    const marketSlug = url.searchParams.get("marketSlug");
    const upTokenId = url.searchParams.get("upTokenId") || undefined;
    const downTokenId = url.searchParams.get("downTokenId") || undefined;

    if (!wallet || !marketSlug) {
      return NextResponse.json({ error: "wallet and marketSlug parameters are required" }, { status: 400 });
    }

    const apiKey = getApiKey("domeApiKey");
    if (!apiKey) return NextResponse.json({ error: "Dome API key not configured. Open Settings to add it." }, { status: 500 });

    const allOrders = await fetchAllMarketOrders(marketSlug, apiKey);
    const walletAddresses = await resolveWalletAddresses(wallet);

    const walletOrders = allOrders.filter((o) => {
      const u = (o.user || "").toString().toLowerCase();
      const t = (o.taker || "").toString().toLowerCase();
      return walletAddresses.has(u) || walletAddresses.has(t);
    });

    const trades: WalletTrade[] = walletOrders.map((order) => {
      const shares = order.shares ?? 0;
      const sharesNormalized = order.shares_normalized ?? order.size_matched ?? order.original_size ?? order.size ?? shares;
      let ts: number;
      if (order.timestamp) ts = order.timestamp;
      else if (order.created_at) ts = Math.floor(new Date(order.created_at).getTime() / 1000);
      else ts = Math.floor(Date.now() / 1000);
      const price = typeof order.price === "number" ? order.price : parseFloat(order.price || "0") || 0;
      const cost = sharesNormalized * price;

      return {
        id: order.order_id || order.order_hash || order.id || `${order.token_id}-${ts}`,
        tokenId: order.token_id,
        tokenLabel: order.token_label || "",
        side: order.side,
        outcome: resolveOutcome(order.token_id, upTokenId, downTokenId),
        price,
        priceCents: Math.round(price * 100),
        shares, sharesNormalized, cost,
        timestamp: ts,
        txHash: order.tx_hash || "",
        orderHash: order.order_hash || "",
        executionRole: inferRole(order, walletAddresses),
        status: order.status,
      };
    });

    trades.sort((a, b) => a.timestamp - b.timestamp);
    const totalVolume = trades.reduce((sum, t) => sum + t.cost, 0);

    return NextResponse.json({ trades, wallet, marketSlug, totalTrades: trades.length, totalVolume } as WalletTradesResponse);
  } catch (error) {
    console.error("[Wallet Tracker] Failed:", error);
    return NextResponse.json({ error: "Failed to fetch wallet trades" }, { status: 500 });
  }
}
