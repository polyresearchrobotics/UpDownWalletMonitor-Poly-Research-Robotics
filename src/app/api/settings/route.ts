import { NextRequest, NextResponse } from "next/server";
import { loadApiKeys, saveApiKeys, type ApiKeys } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET - returns the resolved API keys (user overrides + env fallbacks). These
// values are pre-filled in the settings panel so a new install sees the
// application owner's keys until the user replaces them.
export async function GET() {
  return NextResponse.json({ apiKeys: loadApiKeys() });
}

// POST - persist a partial update. Empty strings clear the override (falling
// back to the env value, if any).
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { apiKeys?: Partial<ApiKeys> };
    if (!body.apiKeys || typeof body.apiKeys !== "object") {
      return NextResponse.json(
        { error: "apiKeys object is required" },
        { status: 400 }
      );
    }
    const apiKeys = saveApiKeys(body.apiKeys);
    return NextResponse.json({ apiKeys });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save settings";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
