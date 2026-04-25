import { NextRequest, NextResponse } from "next/server";
import { loadConfig, setLogPath } from "@/lib/cycleLogger/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET - get current config
export async function GET() {
  const config = loadConfig();
  return NextResponse.json(config);
}

// POST - update config (logPath)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.logPath && typeof body.logPath === "string") {
      const config = setLogPath(body.logPath);
      return NextResponse.json(config);
    }
    return NextResponse.json({ error: "logPath is required" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
