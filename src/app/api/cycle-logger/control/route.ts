import { NextRequest, NextResponse } from "next/server";
import { getCycleLoggerService } from "@/lib/cycleLogger/CycleLoggerService";
import { loadConfig } from "@/lib/cycleLogger/config";
import { getApiKey } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET - get status
export async function GET() {
  const service = getCycleLoggerService();
  return NextResponse.json(service.status);
}

// POST - start or stop the service
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const service = getCycleLoggerService();

    if (body.action === "start") {
      // Refuse to start without a log folder — otherwise the service
      // would silently try to write CSVs to ./orderbooks/... relative
      // to the project dir, triggering Next's hot-reload and losing data.
      const config = loadConfig();
      if (!config.logPath || !config.logPath.trim()) {
        return NextResponse.json(
          { error: "You must select a log folder." },
          { status: 400 }
        );
      }
      // Wallet trade logging requires the Dome API. Without a key the
      // service would start and write orderbook/price CSVs but silently
      // emit empty trader CSVs. Surface this up front rather than let
      // the user discover it after the fact.
      const enabledWallets = config.wallets.filter((w) => w.enabled);
      if (enabledWallets.length > 0 && !getApiKey("domeApiKey")) {
        return NextResponse.json(
          {
            error:
              "A Dome API key is required to log tracked wallet trades. Add one in Settings, or disable all wallets.",
          },
          { status: 400 }
        );
      }
      await service.start();
      return NextResponse.json({ message: "Started", ...service.status });
    } else if (body.action === "stop") {
      service.stop();
      return NextResponse.json({ message: "Stopped", ...service.status });
    } else {
      return NextResponse.json(
        { error: 'action must be "start" or "stop"' },
        { status: 400 }
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
