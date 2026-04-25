import { NextRequest, NextResponse } from "next/server";
import {
  loadConfig,
  addWallet,
  removeWallet,
  setEnabledWallet,
} from "@/lib/cycleLogger/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET - list tracked wallets
export async function GET() {
  const config = loadConfig();
  return NextResponse.json({ wallets: config.wallets });
}

// POST - add a wallet
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, label } = body;
    if (!address || typeof address !== "string") {
      return NextResponse.json({ error: "address is required" }, { status: 400 });
    }
    const config = addWallet(address, label || "");
    return NextResponse.json({ wallets: config.wallets });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// PATCH - exclusively enable one wallet (or none if address is null)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body;
    if (address !== null && (typeof address !== "string" || !address.trim())) {
      return NextResponse.json(
        { error: "address must be a string or null" },
        { status: 400 }
      );
    }
    const config = setEnabledWallet(address);
    return NextResponse.json({ wallets: config.wallets });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// DELETE - remove a wallet
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body;
    if (!address || typeof address !== "string") {
      return NextResponse.json({ error: "address is required" }, { status: 400 });
    }
    const config = removeWallet(address);
    return NextResponse.json({ wallets: config.wallets });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
