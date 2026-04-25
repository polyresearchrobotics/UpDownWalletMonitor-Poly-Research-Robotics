"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiKeys } from "@/lib/settings";

interface TrackedWallet {
  address: string;
  label: string;
  enabled: boolean;
}

interface ApiKeyField {
  key: keyof ApiKeys;
  label: string;
  description?: string;
  placeholder?: string;
  multiline?: boolean;
  secret?: boolean;
}

const SECTIONS: Array<{ title: string; description: string; fields: ApiKeyField[] }> = [
  {
    title: "Chainlink Data Streams",
    description:
      "Used to fetch real-time BTC price reports from Chainlink's Data Engine.",
    fields: [
      {
        key: "chainlinkApiKey",
        label: "Chainlink API Key",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        secret: true,
      },
      {
        key: "chainlinkUserSecret",
        label: "Chainlink User Secret",
        placeholder: "Long signing secret",
        secret: true,
        multiline: true,
      },
    ],
  },
  {
    title: "Endpoints",
    description: "Optional proxies / overrides. Leave blank to use defaults.",
    fields: [
      {
        key: "polymarketProxyGamma",
        label: "Polymarket Gamma Base URL",
        placeholder: "https://gamma-api.polymarket.com",
      },
      {
        key: "polymarketProxyClob",
        label: "Polymarket CLOB Base URL",
        placeholder: "https://clob.polymarket.com",
      },
    ],
  },
];

function buildEmpty(): ApiKeys {
  return {
    domeApiKey: "",
    chainlinkApiKey: "",
    chainlinkUserSecret: "",
    polymarketProxyClob: "",
    polymarketProxyGamma: "",
  };
}

export default function SettingsPage() {
  const [apiKeys, setApiKeys] = useState<ApiKeys>(buildEmpty());
  const [original, setOriginal] = useState<ApiKeys>(buildEmpty());
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Wallet config (reuses existing cycle-logger endpoints)
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [addressInput, setAddressInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [walletError, setWalletError] = useState<string | null>(null);

  // Log path
  const [logPath, setLogPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [keysRes, walletsRes, configRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/cycle-logger/wallets"),
        fetch("/api/cycle-logger/config"),
      ]);
      if (keysRes.ok) {
        const data = await keysRes.json();
        setApiKeys(data.apiKeys);
        setOriginal(data.apiKeys);
      }
      if (walletsRes.ok) {
        const data = await walletsRes.json();
        setWallets(data.wallets || []);
      }
      if (configRes.ok) {
        const data = await configRes.json();
        setLogPath(data.logPath || "");
        setPathInput(data.logPath || "");
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const dirty = useMemo(() => {
    return (Object.keys(apiKeys) as Array<keyof ApiKeys>).some(
      (k) => apiKeys[k] !== original[k]
    );
  }, [apiKeys, original]);

  const handleSave = useCallback(async () => {
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeys }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save");
      }
      const data = await res.json();
      setApiKeys(data.apiKeys);
      setOriginal(data.apiKeys);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2200);
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    }
  }, [apiKeys]);

  const handleReset = useCallback(() => {
    setApiKeys(original);
  }, [original]);

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
        const err = await res.json();
        setWalletError(err.error || "Failed to add wallet");
      }
    } catch {
      setWalletError("Network error");
    }
  }, [addressInput, labelInput]);

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

  const setEnabledWallet = useCallback(async (address: string | null) => {
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
        setWalletError(
          err.error || `Failed to update wallet (${res.status})`
        );
      }
    } catch (e: any) {
      setWalletError(e?.message || "Network error");
    }
  }, []);

  const updateLogPath = useCallback(
    async (p?: string) => {
      const target = (p ?? pathInput).trim();
      if (!target) return;
      try {
        const res = await fetch("/api/cycle-logger/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logPath: target }),
        });
        if (res.ok) {
          const data = await res.json();
          setLogPath(data.logPath);
          setPathInput(data.logPath);
        }
      } catch {}
    },
    [pathInput]
  );

  const openFolderPicker = useCallback(async () => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const res = await fetch("/api/cycle-logger/browse", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBrowseError(
          data?.error ||
            `Folder picker failed (${res.status}). Paste the path directly below.`
        );
      } else if (!data.cancelled && data.path) {
        setPathInput(data.path);
        updateLogPath(data.path);
      }
    } catch (e) {
      setBrowseError(
        e instanceof Error ? e.message : "Folder picker failed. Paste the path directly below."
      );
    } finally {
      setBrowseLoading(false);
    }
  }, [updateLogPath]);

  return (
    <div className="max-w-[980px] mx-auto px-6 md:px-10 pb-32">
      {/* Page header */}
      <div className="pt-14 pb-12 text-center">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-[var(--foreground)]">
          Settings
        </h1>
        <p className="mt-3 text-[14px] text-[var(--muted-foreground)] max-w-xl mx-auto">
          Configure the credentials, wallets, and file paths Wallet Tracker uses.
          Values are saved locally to your machine.
        </p>
      </div>

      {/* API Keys */}
      <div className="card p-8 md:p-10">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 mb-8">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
              API Credentials
            </h2>
            <p className="mt-2 text-[13px] text-[var(--muted-foreground)] max-w-lg">
              These keys are pre-filled with the application defaults. Replace
              any of them with your own to route requests through your own
              accounts.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn"
              onClick={handleReset}
              disabled={!dirty || saveState === "saving"}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!dirty || saveState === "saving"}
            >
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                ? "Saved"
                : "Save changes"}
            </button>
          </div>
        </div>

        {saveError && (
          <div
            className="mb-6 px-4 py-3 rounded-lg text-[13px]"
            style={{
              background: "var(--danger-soft)",
              color: "var(--danger)",
              border: "1px solid rgba(255, 93, 115, 0.25)",
            }}
          >
            {saveError}
          </div>
        )}

        <div className="space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <div className="flex items-baseline justify-between mb-5">
                <h3 className="text-[15px] font-semibold text-[var(--foreground)]">
                  {section.title}
                </h3>
              </div>
              <p className="text-[12.5px] text-[var(--muted-foreground)] mb-5 max-w-2xl">
                {section.description}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {section.fields.map((field) => {
                  const value = apiKeys[field.key] ?? "";
                  const revealed = reveal[field.key] ?? false;
                  const isSecret = !!field.secret;
                  const shown = !isSecret || revealed;
                  const inputType = shown ? "text" : "password";
                  return (
                    <div
                      key={field.key}
                      className={field.multiline ? "md:col-span-2" : ""}
                    >
                      <label className="label">{field.label}</label>
                      <div className="relative">
                        {field.multiline ? (
                          <textarea
                            className="input"
                            style={{
                              fontFamily: shown
                                ? "var(--font-mono)"
                                : "var(--font-sans)",
                              minHeight: 88,
                              resize: "vertical",
                              WebkitTextSecurity: shown ? "none" : "disc",
                            } as React.CSSProperties}
                            placeholder={field.placeholder}
                            value={value}
                            onChange={(e) =>
                              setApiKeys((k) => ({
                                ...k,
                                [field.key]: e.target.value,
                              }))
                            }
                          />
                        ) : (
                          <input
                            type={inputType}
                            className="input pr-20"
                            placeholder={field.placeholder}
                            value={value}
                            onChange={(e) =>
                              setApiKeys((k) => ({
                                ...k,
                                [field.key]: e.target.value,
                              }))
                            }
                            autoComplete="off"
                            spellCheck={false}
                          />
                        )}
                        {isSecret && (
                          <button
                            type="button"
                            onClick={() =>
                              setReveal((r) => ({
                                ...r,
                                [field.key]: !revealed,
                              }))
                            }
                            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] text-[var(--muted-foreground)] rounded hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors"
                          >
                            {revealed ? "Hide" : "Show"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* Tracked Wallets */}
      <div className="card p-8 md:p-10 mt-10">
        <div className="mb-8">
          <h2 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
            Tracked Wallets
          </h2>
          <p className="mt-2 text-[13px] text-[var(--muted-foreground)] max-w-lg">
            Traders you want to monitor. Up to 10 wallets can be tracked at
            once. Trades are logged alongside the cycle data.
          </p>
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
            style={{ height: 42 }}
          >
            Add wallet
          </button>
        </div>

        {walletError && (
          <p className="mt-3 text-[12px]" style={{ color: "var(--danger)" }}>
            {walletError}
          </p>
        )}

        <div className="mt-8 space-y-3">
          {wallets.length === 0 ? (
            <div
              className="rounded-xl py-10 text-center text-[13px]"
              style={{
                border: "1px dashed var(--border)",
                color: "var(--muted-foreground)",
                background: "var(--surface-2)",
              }}
            >
              No wallets tracked yet.
            </div>
          ) : (
            wallets.map((w) => (
              <div
                key={w.address}
                className="flex items-center gap-4 px-5 py-4 rounded-xl"
                style={{
                  background: w.enabled
                    ? "var(--accent-glow)"
                    : "var(--surface-2)",
                  border: `1px solid ${
                    w.enabled ? "var(--accent)" : "var(--border)"
                  }`,
                }}
              >
                <div
                  className="h-9 w-9 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0"
                  style={{
                    background: "var(--accent-glow)",
                    color: "var(--accent)",
                  }}
                >
                  {(w.label || w.address).slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-[var(--foreground)] truncate">
                    {w.label || "Unnamed"}
                  </div>
                  <div className="text-[12px] text-[var(--muted-foreground)] font-mono truncate">
                    {w.address}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEnabledWallet(w.enabled ? null : w.address)}
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
          <div className="text-[11px] text-[var(--subtle-foreground)] text-right">
            {wallets.length} / 10 wallets
          </div>
        </div>
      </div>

      {/* Log path */}
      <div className="card p-8 md:p-10 mt-10">
        <div className="mb-6">
          <h2 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
            Log Output
          </h2>
          <p className="mt-2 text-[13px] text-[var(--muted-foreground)] max-w-lg">
            Folder where CSV cycle logs are written. Keep this outside of the
            app source directory to avoid hot-reload churn.
          </p>
        </div>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            className="input flex-1"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="/path/to/logs"
          />
          <div className="flex gap-3">
            <button
              type="button"
              className="btn"
              onClick={openFolderPicker}
              disabled={browseLoading}
            >
              {browseLoading ? "Opening…" : "Browse"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => updateLogPath()}
              disabled={!pathInput.trim() || pathInput === logPath}
            >
              Save path
            </button>
          </div>
        </div>
        {browseError && (
          <p className="mt-3 text-[12px]" style={{ color: "var(--danger)" }}>
            {browseError}
          </p>
        )}
      </div>
    </div>
  );
}
