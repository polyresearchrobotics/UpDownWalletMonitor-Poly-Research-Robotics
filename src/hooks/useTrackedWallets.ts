"use client";

import { useCallback, useEffect, useState } from "react";

export interface TrackedWallet {
  address: string;
  label: string;
  enabled: boolean;
}

const STORAGE_KEY = "wallettracker.trackedWallets.v1";
const MAX_WALLETS = 10;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function read(): TrackedWallet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (w): w is TrackedWallet =>
        w &&
        typeof w.address === "string" &&
        typeof w.label === "string" &&
        typeof w.enabled === "boolean"
    );
  } catch {
    return [];
  }
}

function write(wallets: TrackedWallet[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
    // Cross-component sync within the same tab. The native "storage" event
    // only fires across tabs, so dispatch a custom one for same-tab listeners.
    window.dispatchEvent(new CustomEvent("wallettracker:wallets-changed"));
  } catch {}
}

export function useTrackedWallets() {
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWallets(read());
    const sync = () => setWallets(read());
    window.addEventListener("storage", sync);
    window.addEventListener("wallettracker:wallets-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("wallettracker:wallets-changed", sync);
    };
  }, []);

  const addWallet = useCallback((address: string, label: string) => {
    setError(null);
    const addr = address.trim();
    if (!ADDRESS_RE.test(addr)) {
      setError("Address must be a 0x-prefixed 40-char hex string.");
      return false;
    }
    const lower = addr.toLowerCase();
    const current = read();
    if (current.length >= MAX_WALLETS) {
      setError(`Limit is ${MAX_WALLETS} wallets.`);
      return false;
    }
    if (current.some((w) => w.address.toLowerCase() === lower)) {
      setError("Wallet already tracked.");
      return false;
    }
    const next = [...current, { address: addr, label: label.trim(), enabled: true }];
    write(next);
    setWallets(next);
    return true;
  }, []);

  const removeWallet = useCallback((address: string) => {
    const lower = address.toLowerCase();
    const next = read().filter((w) => w.address.toLowerCase() !== lower);
    write(next);
    setWallets(next);
  }, []);

  // null = disable all; otherwise enable just this address (radio-style).
  const setEnabled = useCallback((address: string | null) => {
    const lower = address?.toLowerCase() ?? null;
    const next = read().map((w) => ({
      ...w,
      enabled: lower !== null && w.address.toLowerCase() === lower,
    }));
    write(next);
    setWallets(next);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { wallets, error, addWallet, removeWallet, setEnabled, clearError, MAX_WALLETS };
}
