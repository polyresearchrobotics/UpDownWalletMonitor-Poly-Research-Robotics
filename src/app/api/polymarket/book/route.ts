import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/settings";

function resolveClobBase(): string {
  return getApiKey("polymarketProxyClob") || "https://clob.polymarket.com";
}

// Only the browser running Wallet Tracker itself needs this proxy — it's a
// same-origin fetch. The previous `Access-Control-Allow-Origin: *` made
// anyone on the LAN able to piggyback on this as an open proxy if the dev
// port was ever exposed. Same-origin requests ignore CORS entirely, so
// no header is required.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenId = url.searchParams.get("token_id");

  if (!tokenId) {
    return NextResponse.json({ error: "token_id is required" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const clobBase = resolveClobBase();
    const resp = await fetch(`${clobBase}/book?token_id=${encodeURIComponent(tokenId)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      return NextResponse.json({ error: `CLOB returned ${resp.status}` }, { status: resp.status });
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const e = error as { name?: string; message?: string } | undefined;
    const message = e?.name === "AbortError" ? "Request to CLOB timed out" : (e?.message || "Failed to fetch book");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
