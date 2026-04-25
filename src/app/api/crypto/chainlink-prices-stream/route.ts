import { NextRequest } from "next/server";
import * as crypto from "crypto";
import { getApiKey } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHAINLINK_API_BASE = "https://api.dataengine.chain.link";

// Mainnet Data Streams feed IDs (verified live via /api/v1/reports/latest).
const FEEDS: Record<string, string> = {
  BTC: "0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8",
  ETH: "0x000362205e10b3a147d02792eccee483dca6c7b44ecce7012cb8c6e0b68b3ae9",
  SOL: "0x0003b778d3f6b2ac4991302b89cb313f99a42467d6c9c5f96f57c29c0d2bc24f",
  XRP: "0x0003c16c6aed42294f5cb4741f6e59ba2d728f0eae2eb9e6d3f555808c59fc45",
};

const POLL_INTERVAL_MS = 2000;

function generateAuthHeaders(
  method: string,
  url: string,
  body: string = ""
): Record<string, string> {
  const apiKey = getApiKey("chainlinkApiKey");
  const userSecret = getApiKey("chainlinkUserSecret");
  const ts = Date.now();
  const parsed = new URL(url);
  const pathWithQuery = parsed.pathname + parsed.search;
  const bodyHash = crypto
    .createHash("sha256")
    .update(body || "")
    .digest("hex");
  // Space-separated, NOT newline-separated (per SDK source)
  const hmacBaseString = `${method} ${pathWithQuery} ${bodyHash} ${apiKey} ${ts}`;
  const signature = crypto
    .createHmac("sha256", userSecret)
    .update(hmacBaseString)
    .digest("hex");

  return {
    Authorization: apiKey,
    "X-Authorization-Timestamp": ts.toString(),
    "X-Authorization-Signature-SHA256": signature,
  };
}

async function fetchLatestReport(feedId: string): Promise<{
  price: number;
  bid: number | null;
  ask: number | null;
  timestamp: number;
} | null> {
  try {
    const url = `${CHAINLINK_API_BASE}/api/v1/reports/latest?feedID=${feedId}`;
    const headers = generateAuthHeaders("GET", url);

    const resp = await fetch(url, {
      headers: {
        ...headers,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!resp.ok) {
      console.error(`[chainlink] API returned ${resp.status}: ${await resp.text().catch(() => "")}`);
      return null;
    }

    const data = await resp.json();
    const report = data.report;
    if (!report) return null;

    // Try to dynamically decode using SDK
    try {
      const { decodeReport } = await import("@chainlink/data-streams-sdk");
      const decoded: any = decodeReport(report.fullReport, report.feedID);
      // V3+ reports have benchmarkPrice, V2 has price
      const rawPrice = decoded.benchmarkPrice ?? decoded.price;
      if (rawPrice) {
        const price = Number(BigInt(rawPrice)) / 1e18;
        const bid = decoded.bid ? Number(BigInt(decoded.bid)) / 1e18 : null;
        const ask = decoded.ask ? Number(BigInt(decoded.ask)) / 1e18 : null;
        const obsTimestamp = report.observationsTimestamp
          ? report.observationsTimestamp * 1000
          : Date.now();
        return { price, bid, ask, timestamp: obsTimestamp };
      }
    } catch {
      // SDK decode failed, try manual extraction
    }

    // Fallback: try benchmarkPrice from report metadata
    if (report.benchmarkPrice) {
      const price = parseFloat(report.benchmarkPrice);
      if (price > 0) {
        return {
          price,
          bid: report.bid ? parseFloat(report.bid) : null,
          ask: report.ask ? parseFloat(report.ask) : null,
          timestamp: report.observationsTimestamp
            ? report.observationsTimestamp * 1000
            : Date.now(),
        };
      }
    }

    return null;
  } catch (err: any) {
    console.error(`[chainlink] Fetch error: ${err.message}`);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  let alive = true;

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: any) => {
        if (!alive) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          alive = false;
        }
      };

      // Chainlink Data Streams require a private API key + user secret.
      // If either is missing, emit a one-shot "disabled" event and close —
      // don't attempt to sign or fetch, which would just 401 on every poll.
      const apiKey = getApiKey("chainlinkApiKey");
      const userSecret = getApiKey("chainlinkUserSecret");
      if (!apiKey || !userSecret) {
        enqueue({ type: "disabled", reason: "missing_credentials" });
        alive = false;
        try { controller.close(); } catch {}
        return;
      }

      // Send initial state
      const initPrices: Record<string, any> = {};
      for (const symbol of Object.keys(FEEDS)) {
        const result = await fetchLatestReport(FEEDS[symbol]);
        if (result && result.price > 0) {
          initPrices[symbol] = {
            symbol,
            price: result.price,
            timestamp: result.timestamp,
            change24h: 0,
            cycleStartPrice: result.price,
            cycleStart: 0,
            bid: result.bid,
            ask: result.ask,
            available: true,
          };
        } else {
          initPrices[symbol] = {
            symbol,
            price: 0,
            timestamp: 0,
            change24h: 0,
            cycleStartPrice: 0,
            cycleStart: 0,
            bid: null,
            ask: null,
            available: false,
          };
        }
      }

      const availableCount = Object.values(initPrices).filter(
        (p: any) => p.available
      ).length;
      enqueue({
        type: "init",
        prices: initPrices,
        status:
          availableCount === Object.keys(FEEDS).length
            ? "healthy"
            : availableCount > 0
            ? "partial"
            : "unavailable",
        availableCount,
        totalCount: Object.keys(FEEDS).length,
        timestamp: Date.now(),
      });

      // Store baseline for change calculation
      const baselines = new Map<string, number>();
      for (const [symbol, data] of Object.entries(initPrices)) {
        if ((data as any).available) baselines.set(symbol, (data as any).price);
      }

      // Poll loop
      const pollTimer = setInterval(async () => {
        if (!alive) {
          clearInterval(pollTimer);
          return;
        }
        for (const [symbol, feedId] of Object.entries(FEEDS)) {
          if (!alive) break;
          const result = await fetchLatestReport(feedId);
          if (result && result.price > 0) {
            const baseline = baselines.get(symbol) || result.price;
            const change24h =
              baseline > 0
                ? ((result.price - baseline) / baseline) * 100
                : 0;

            enqueue({
              type: "update",
              symbol,
              price: result.price,
              timestamp: result.timestamp,
              change24h,
              cycleStartPrice: baseline,
              cycleStart: 0,
              bid: result.bid,
              ask: result.ask,
              receivedAt: Date.now(),
            });
          }
        }
      }, POLL_INTERVAL_MS);

      // Heartbeat
      const heartbeat = setInterval(() => {
        if (!alive) {
          clearInterval(heartbeat);
          return;
        }
        enqueue({ type: "heartbeat", timestamp: Date.now() });
      }, 15000);

      // Cleanup on abort
      request.signal.addEventListener("abort", () => {
        alive = false;
        clearInterval(pollTimer);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      alive = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
