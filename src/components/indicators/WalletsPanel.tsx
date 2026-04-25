"use client";

import { useCallback, useEffect, useState } from "react";

interface TrackedWallet {
  address: string;
  label: string;
  enabled: boolean;
}

export function WalletsPanel() {
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [addressInput, setAddressInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [walletError, setWalletError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/cycle-logger/wallets");
      if (res.ok) {
        const data = await res.json();
        setWallets(data.wallets || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const addWallet = useCallback(async () => {
    setWalletError(null);
    const addr = addressInput.trim();
    if (!addr) return;
    try {
      const res = await fetch("/api/cycle-logger/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr, label: labelInput.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setWallets(data.wallets || []);
        setAddressInput("");
        setLabelInput("");
      } else {
        const err = await res.json().catch(() => ({}));
        setWalletError(err.error || "Failed to add wallet");
      }
    } catch {
      setWalletError("Network error");
    }
  }, [addressInput, labelInput]);

  const setEnabled = useCallback(async (address: string | null) => {
    setWalletError(null);
    try {
      const res = await fetch("/api/cycle-logger/wallets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (res.ok) {
        const data = await res.json();
        setWallets(data.wallets || []);
      } else {
        const err = await res.json().catch(() => ({}));
        setWalletError(err.error || `Failed to update wallet (${res.status})`);
      }
    } catch (e: any) {
      setWalletError(e?.message || "Network error");
    }
  }, []);

  const deleteWallet = useCallback(async (address: string) => {
    setWalletError(null);
    try {
      const res = await fetch("/api/cycle-logger/wallets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (res.ok) {
        const data = await res.json();
        setWallets(data.wallets || []);
      } else {
        const err = await res.json().catch(() => ({}));
        setWalletError(err.error || `Failed to remove wallet (${res.status})`);
      }
    } catch (e: any) {
      setWalletError(e?.message || "Network error");
    }
  }, []);

  return (
    <div className="card p-7 md:p-8">
      <div className="mb-5">
        <div className="text-[14px] font-semibold text-[var(--foreground)]">
          Tracked Wallets
        </div>
        <div className="text-[12.5px] text-[var(--muted-foreground)] mt-1">
          Add traders to log their orders alongside each cycle. Up to 10 wallets.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-4 items-end">
        <div>
          <label className="label">Wallet Address</label>
          <input
            type="text"
            className="input"
            placeholder="0x..."
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addWallet();
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="label">Trader Label</label>
          <input
            type="text"
            className="input"
            style={{ fontFamily: "var(--font-sans)" }}
            placeholder="Nickname"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addWallet();
            }}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={addWallet}
          disabled={!addressInput.trim() || wallets.length >= 10}
        >
          Add wallet
        </button>
      </div>

      {walletError && (
        <p className="mt-3 text-[12.5px]" style={{ color: "var(--danger)" }}>
          {walletError}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {wallets.length === 0 ? (
          <div
            className="rounded-xl py-10 text-center text-[13px]"
            style={{
              border: "1px dashed var(--border)",
              color: "var(--muted-foreground)",
              background: "var(--surface-2)",
            }}
          >
            No wallets tracked yet. Add one above to start monitoring.
          </div>
        ) : (
          wallets.map((w) => (
            <div
              key={w.address}
              className="flex items-center gap-4 px-5 py-4 rounded-xl"
              style={{
                background: w.enabled ? "var(--accent-glow)" : "var(--surface-2)",
                border: `1px solid ${w.enabled ? "var(--accent)" : "var(--border)"}`,
              }}
            >
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0"
                style={{ background: "var(--accent-glow)", color: "var(--accent)" }}
              >
                {(w.label || w.address).slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium text-[var(--foreground)] truncate">
                  {w.label || "Unnamed"}
                </div>
                <div className="text-[12px] text-[var(--muted-foreground)] font-mono truncate mt-0.5">
                  {w.address}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEnabled(w.enabled ? null : w.address)}
                className="btn btn-ghost"
                style={{
                  color: w.enabled ? "var(--accent)" : "var(--muted-foreground)",
                  fontWeight: w.enabled ? 600 : 400,
                }}
                title={
                  w.enabled
                    ? "Currently viewing this wallet's trades — click to disable"
                    : "Enable to view this wallet's trades (disables the others)"
                }
              >
                {w.enabled ? "On" : "Off"}
              </button>
              <button
                type="button"
                onClick={() => deleteWallet(w.address)}
                className="btn btn-ghost"
                style={{ color: "var(--danger)" }}
              >
                Remove
              </button>
            </div>
          ))
        )}
        {wallets.length > 0 && (
          <div className="text-[11px] text-[var(--subtle-foreground)] text-right pt-1">
            {wallets.length} / 10 wallets
          </div>
        )}
      </div>
    </div>
  );
}
