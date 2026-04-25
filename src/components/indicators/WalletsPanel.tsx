"use client";

import { useState } from "react";
import { useTrackedWallets } from "@/hooks/useTrackedWallets";

export function WalletsPanel() {
  const { wallets, error, addWallet, removeWallet, setEnabled, MAX_WALLETS } =
    useTrackedWallets();
  const [addressInput, setAddressInput] = useState("");
  const [labelInput, setLabelInput] = useState("");

  const submit = () => {
    if (addWallet(addressInput, labelInput)) {
      setAddressInput("");
      setLabelInput("");
    }
  };

  return (
    <div className="card p-7 md:p-8">
      <div className="mb-5">
        <div className="text-[14px] font-semibold text-[var(--foreground)]">
          Tracked Wallets
        </div>
        <div className="text-[12.5px] text-[var(--muted-foreground)] mt-1">
          Add traders to plot their orders on the chart in real time. Stored in
          your browser. Up to {MAX_WALLETS} wallets.
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
              if (e.key === "Enter") submit();
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
              if (e.key === "Enter") submit();
            }}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={!addressInput.trim() || wallets.length >= MAX_WALLETS}
        >
          Add wallet
        </button>
      </div>

      {error && (
        <p className="mt-3 text-[12.5px]" style={{ color: "var(--danger)" }}>
          {error}
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
                onClick={() => removeWallet(w.address)}
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
            {wallets.length} / {MAX_WALLETS} wallets
          </div>
        )}
      </div>
    </div>
  );
}
