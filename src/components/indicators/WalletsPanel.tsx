"use client";

import { useMemo, useState } from "react";
import { useTrackedWallets } from "@/hooks/useTrackedWallets";
import type { WalletTradeStreamEvent } from "@/hooks/useWalletTradeStream";

interface WalletsPanelProps {
  // Lifted from the indicators page so we don't open a duplicate
  // browser-side Polymarket RTDS WebSocket per page mount.
  streamTrades: WalletTradeStreamEvent[];
  isStreaming: boolean;
}

export function WalletsPanel({ streamTrades, isStreaming }: WalletsPanelProps) {
  const { wallets, error, addWallet, removeWallet, setEnabled, MAX_WALLETS } =
    useTrackedWallets();
  const [addressInput, setAddressInput] = useState("");
  const [labelInput, setLabelInput] = useState("");

  const enabledAddresses = useMemo(
    () => wallets.filter((w) => w.enabled).map((w) => w.address.toLowerCase()),
    [wallets]
  );
  const recentTrade = streamTrades[streamTrades.length - 1];

  const submit = () => {
    if (addWallet(addressInput, labelInput)) {
      setAddressInput("");
      setLabelInput("");
    }
  };

  return (
    <div className="card p-7 md:p-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-[14px] font-semibold text-[var(--foreground)]">
            Tracked Wallets
          </div>
          <div className="text-[12.5px] text-[var(--muted-foreground)] mt-1">
            Add traders to plot their orders on the chart in real time. Stored in
            your browser. Up to {MAX_WALLETS} wallets.
          </div>
        </div>
        {enabledAddresses.length > 0 && (
          <div
            className="shrink-0 px-3 py-2 rounded-lg text-right"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
            }}
          >
            <div className="text-[10px] uppercase tracking-wide text-[var(--subtle-foreground)]">
              Stream
            </div>
            <div
              className="text-[12px] font-mono mt-0.5"
              style={{ color: isStreaming ? "var(--success)" : "var(--danger)" }}
            >
              {isStreaming ? "LIVE" : "OFFLINE"}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--subtle-foreground)] mt-2">
              Trades received
            </div>
            <div className="text-[12px] font-mono text-[var(--foreground)]">
              {streamTrades.length}
            </div>
            {recentTrade && (
              <div
                className="text-[10px] font-mono mt-1 truncate max-w-[180px]"
                style={{ color: "var(--muted-foreground)" }}
                title={`${recentTrade.side} ${recentTrade.outcome} @ ${recentTrade.priceCents}¢ on ${recentTrade.marketSlug}`}
              >
                last: {recentTrade.side} {recentTrade.outcome} @{" "}
                {recentTrade.priceCents}¢
              </div>
            )}
          </div>
        )}
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

      {enabledAddresses.length > 0 && (
        <div
          className="mt-6 pt-6"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-semibold text-[var(--foreground)]">
              Live Trade Feed
            </div>
            <div className="text-[11px] font-mono text-[var(--subtle-foreground)]">
              {streamTrades.length} received
            </div>
          </div>
          {streamTrades.length === 0 ? (
            <div
              className="rounded-lg py-6 text-center text-[12px]"
              style={{
                border: "1px dashed var(--border)",
                color: "var(--muted-foreground)",
                background: "var(--surface-2)",
              }}
            >
              {isStreaming
                ? "Connected — waiting for the wallet's next trade…"
                : "Connecting to trade stream…"}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
              {streamTrades
                .slice(-20)
                .reverse()
                .map((t) => {
                  const isBuy = t.side === "BUY";
                  const outcomeColor =
                    t.outcome === "UP"
                      ? "var(--success)"
                      : t.outcome === "DOWN"
                      ? "var(--danger)"
                      : "var(--muted-foreground)";
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-[12px] font-mono"
                      style={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <span
                        className="text-[11px] font-semibold w-10"
                        style={{ color: isBuy ? "var(--success)" : "var(--danger)" }}
                      >
                        {t.side}
                      </span>
                      <span
                        className="text-[11px] font-semibold w-12"
                        style={{ color: outcomeColor }}
                      >
                        {t.outcome}
                      </span>
                      <span className="w-14 text-[var(--foreground)]">
                        {t.priceCents}¢
                      </span>
                      <span className="w-20 text-[var(--muted-foreground)] truncate">
                        {t.shares.toFixed(2)} sh
                      </span>
                      <span className="flex-1 text-[10.5px] text-[var(--muted-foreground)] truncate">
                        {t.marketSlug}
                      </span>
                      <span className="text-[10.5px] text-[var(--subtle-foreground)] shrink-0">
                        {new Date(t.timestamp * 1000).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: false,
                        })}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
