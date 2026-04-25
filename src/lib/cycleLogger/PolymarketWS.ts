import WebSocket from "ws";
import type { BookLevel } from "./types";

const POLYMARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export interface PriceState {
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  lastTradePrice: number | null;
}

export interface BookState {
  bids: BookLevel[]; // sorted best (highest) first
  asks: BookLevel[]; // sorted best (lowest) first
}

/**
 * Server-side Polymarket WebSocket client.
 * Subscribes to token IDs and maintains latest price + orderbook state.
 */
export class PolymarketWS {
  private ws: WebSocket | null = null;
  private subscribedTokens = new Set<string>();
  private pendingTokens: string[] = [];
  private prices = new Map<string, PriceState>();
  private books = new Map<string, BookState>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private alive = true;

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Get current price state for a token */
  getPrice(tokenId: string): PriceState | undefined {
    return this.prices.get(tokenId);
  }

  /** Get current orderbook for a token */
  getBook(tokenId: string): BookState | undefined {
    return this.books.get(tokenId);
  }

  /** Subscribe to additional token IDs (can be called before or after connect) */
  subscribe(tokenIds: string[]): void {
    const newTokens = tokenIds.filter((t) => !this.subscribedTokens.has(t));
    if (newTokens.length === 0) return;

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ type: "subscribe", channel: "market", assets_ids: newTokens })
      );
      newTokens.forEach((t) => this.subscribedTokens.add(t));
    } else {
      // Queue for when connection opens
      this.pendingTokens.push(...newTokens);
    }
  }

  /** Unsubscribe from tokens (clears local state too) */
  unsubscribe(tokenIds: string[]): void {
    for (const t of tokenIds) {
      this.subscribedTokens.delete(t);
      this.prices.delete(t);
      this.books.delete(t);
    }
    // Polymarket WS doesn't have an explicit unsubscribe, so we just stop tracking
  }

  /** Connect to the WebSocket */
  connect(): void {
    if (!this.alive) return;
    this.cleanup();

    const ws = new WebSocket(POLYMARKET_WS_URL);
    this.ws = ws;

    ws.on("open", () => {
      // Subscribe to all queued + previously subscribed tokens
      const allTokens = [...this.subscribedTokens, ...this.pendingTokens];
      this.pendingTokens = [];
      if (allTokens.length > 0) {
        ws.send(
          JSON.stringify({ type: "subscribe", channel: "market", assets_ids: allTokens })
        );
        allTokens.forEach((t) => this.subscribedTokens.add(t));
      }
      console.log("[PolymarketWS] Connected, subscribed to", allTokens.length, "tokens");
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const timestamp = msg.timestamp ? parseInt(msg.timestamp, 10) : Date.now();

        // Ignore messages for tokens we've already unsubscribed from —
        // Polymarket's WS has no unsubscribe verb, so stale messages
        // keep arriving after a cycle transition and would otherwise
        // re-create the in-memory book state we just torn down.
        if (msg.asset_id && !this.subscribedTokens.has(msg.asset_id)) return;

        if (msg.event_type === "book" && msg.asset_id) {
          this.handleBook(msg.asset_id, msg.buys || msg.bids || [], msg.sells || msg.asks || [], timestamp);
        } else if (msg.event_type === "price_change" && msg.price_changes) {
          for (const change of msg.price_changes) {
            // Skip fabrication — only trust real bid/ask data. Prior
            // behavior defaulted missing ask to 1.0, which pinned mid
            // at 0.5 and poisoned the cycle log.
            if (change.best_bid === undefined || change.best_ask === undefined) continue;
            const bestBid = parseFloat(change.best_bid);
            const bestAsk = parseFloat(change.best_ask);
            if (!isFinite(bestBid) || !isFinite(bestAsk)) continue;
            if (!this.subscribedTokens.has(change.asset_id)) continue;
            this.updatePrice(change.asset_id, bestBid, bestAsk, null, timestamp);
          }
        } else if (msg.event_type === "last_trade_price" && msg.asset_id && msg.price) {
          const ltp = parseFloat(msg.price);
          if (!isFinite(ltp)) return;
          const existing = this.prices.get(msg.asset_id);
          // Only fold last-trade-price into existing book state. If we
          // have no bid/ask yet, wait for a `book` event rather than
          // synthesizing one from the trade price alone.
          if (existing) {
            this.updatePrice(msg.asset_id, existing.bestBid, existing.bestAsk, ltp, timestamp);
          }
        }
      } catch {}
    });

    ws.on("error", (err) => {
      console.error("[PolymarketWS] Error:", err.message);
    });

    ws.on("close", () => {
      console.log("[PolymarketWS] Disconnected");
      this.ws = null;
      if (this.alive) {
        this.reconnectTimer = setTimeout(() => this.connect(), 1500);
      }
    });
  }

  /** Tear down everything */
  destroy(): void {
    this.alive = false;
    this.cleanup();
    this.prices.clear();
    this.books.clear();
    this.subscribedTokens.clear();
    this.pendingTokens = [];
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  private updatePrice(
    tokenId: string, bestBid: number, bestAsk: number,
    lastTradePrice: number | null, _timestamp: number
  ): void {
    let midPrice = 0;
    if (bestBid > 0 && bestAsk > 0 && bestAsk < 1) midPrice = (bestBid + bestAsk) / 2;
    else if (bestBid > 0 && bestBid < 1) midPrice = bestBid;
    else if (bestAsk > 0 && bestAsk < 1) midPrice = bestAsk;
    if (midPrice === 0) return;

    const existing = this.prices.get(tokenId);
    this.prices.set(tokenId, {
      bestBid, bestAsk, midPrice,
      lastTradePrice: lastTradePrice ?? existing?.lastTradePrice ?? null,
    });
  }

  private handleBook(tokenId: string, buysRaw: any[], sellsRaw: any[], timestamp: number): void {
    const bids: BookLevel[] = buysRaw
      .map((l: any) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
      .filter((l) => l.size > 0 && l.price > 0 && l.price < 1)
      .sort((a, b) => b.price - a.price);
    const asks: BookLevel[] = sellsRaw
      .map((l: any) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
      .filter((l) => l.size > 0 && l.price > 0 && l.price < 1)
      .sort((a, b) => a.price - b.price);

    this.books.set(tokenId, { bids, asks });

    // Also update price from book. Default missing sides to 0 (not 1.0)
    // so the recorded bestAsk in CSV logs reflects "no ask available"
    // rather than being falsely pinned at 1.0¢. updatePrice() treats 0
    // as absent and only computes midPrice from the sides it has.
    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 0;
    if (bestBid === 0 && bestAsk === 0) return;
    const existing = this.prices.get(tokenId);
    this.updatePrice(tokenId, bestBid, bestAsk, existing?.lastTradePrice ?? null, timestamp);
  }
}
