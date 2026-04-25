"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface LoggerStatus {
  running: boolean;
  currentCycleSlug: string | null;
  nextCycleSlug: string | null;
  walletsTracked: number;
  secondsLogged: number;
  polyWsConnected: boolean;
}

export function CycleLoggerControls() {
  const [status, setStatus] = useState<LoggerStatus | null>(null);
  const [logPath, setLogPath] = useState("");
  const [walletCount, setWalletCount] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [toggleHint, setToggleHint] = useState<string | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToggleHint = useCallback((msg: string) => {
    setToggleHint(msg);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setToggleHint(null), 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [walletsRes, configRes, statusRes] = await Promise.all([
        fetch("/api/cycle-logger/wallets"),
        fetch("/api/cycle-logger/config"),
        fetch("/api/cycle-logger/control"),
      ]);
      if (walletsRes.ok) {
        const data = await walletsRes.json();
        setWalletCount((data.wallets || []).length);
      }
      if (configRes.ok) {
        const data = await configRes.json();
        setLogPath(data.logPath || "");
      }
      if (statusRes.ok) setStatus(await statusRes.json());
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggleService = useCallback(async () => {
    const isStart = !status?.running;
    // Client-side guards so the user gets instant feedback. The server
    // validates again below in case a stale client slips through.
    if (isStart) {
      if (walletCount === 0) {
        showToggleHint("Add at least one wallet in Settings first.");
        return;
      }
      if (!logPath.trim()) {
        showToggleHint("You must select a log folder.");
        return;
      }
    }
    const action = isStart ? "start" : "stop";
    try {
      const res = await fetch("/api/cycle-logger/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus(data);
      } else if (data?.error) {
        showToggleHint(data.error);
      }
    } catch {}
  }, [status?.running, walletCount, logPath, showToggleHint]);

  const openFolderPicker = useCallback(async () => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const browseRes = await fetch("/api/cycle-logger/browse", { method: "POST" });
      const browseData = await browseRes.json().catch(() => ({}));
      if (!browseRes.ok) {
        setBrowseError(browseData?.error || `Folder picker failed (${browseRes.status}).`);
        return;
      }
      if (browseData.cancelled || !browseData.path) return;
      const saveRes = await fetch("/api/cycle-logger/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logPath: browseData.path }),
      });
      if (saveRes.ok) {
        const data = await saveRes.json();
        setLogPath(data.logPath || "");
      }
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : "Folder picker failed.");
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const running = !!status?.running;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
        }}
      >
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{
            background: running ? "var(--success)" : "rgba(255,93,115,0.7)",
            boxShadow: running ? "0 0 8px var(--success)" : "none",
          }}
        />
        <span className="text-[12px] text-[var(--foreground)] flex-1">
          {running
            ? `Logging · ${status?.secondsLogged ?? 0}s`
            : `${walletCount} wallets`}
        </span>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={toggleService}
          className={running ? "btn btn-danger w-full" : "btn btn-success w-full"}
          // Intentionally NOT using HTML `disabled` — the click handler
          // needs to fire so the tooltip can tell the user WHY it can't
          // start. Visual "disabled" look is applied via style below.
          style={
            !running && (walletCount === 0 || !logPath.trim())
              ? { opacity: 0.55, cursor: "pointer" }
              : undefined
          }
        >
          {running ? "Stop logger" : "Start logger"}
        </button>
        {toggleHint && (
          <div
            role="status"
            className="absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-2 rounded-lg text-[11px] z-10 whitespace-nowrap pointer-events-none"
            style={{
              background: "var(--surface)",
              color: "var(--foreground)",
              border: "1px solid var(--danger)",
              boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
            }}
          >
            <span
              className="absolute left-1/2 -top-1 h-2 w-2 -translate-x-1/2 rotate-45"
              style={{
                background: "var(--surface)",
                borderLeft: "1px solid var(--danger)",
                borderTop: "1px solid var(--danger)",
              }}
            />
            {toggleHint}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={openFolderPicker}
        disabled={browseLoading}
        title={logPath ? `Click to change · current: ${logPath}` : "Select log folder"}
        className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg text-left transition-colors"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          cursor: browseLoading ? "wait" : "pointer",
        }}
        onMouseEnter={(e) => {
          if (!browseLoading) e.currentTarget.style.background = "var(--surface-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--surface-2)";
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-wide text-[var(--subtle-foreground)]">
            Log folder
          </div>
          <div className="text-[10px] text-[var(--accent)]">
            {browseLoading ? "Opening…" : logPath ? "Change" : "Choose"}
          </div>
        </div>
        <div
          className="font-mono text-[11px] truncate"
          style={{
            color: logPath ? "var(--muted-foreground)" : "var(--subtle-foreground)",
          }}
        >
          {logPath || "Click to select a folder…"}
        </div>
      </button>

      {browseError && (
        <div
          className="px-3 py-2 rounded-lg text-[11px]"
          style={{
            background: "var(--danger-soft)",
            color: "var(--danger)",
            border: "1px solid rgba(255, 93, 115, 0.25)",
          }}
        >
          {browseError}
        </div>
      )}

      {(status?.currentCycleSlug || status?.nextCycleSlug) && (
        <div
          className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
          }}
        >
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--subtle-foreground)]">
              Current
            </div>
            <div className="font-mono text-[11px] text-[var(--foreground)] truncate">
              {status?.currentCycleSlug ?? "—"}
            </div>
          </div>
          <div className="mt-1">
            <div className="text-[10px] uppercase tracking-wide text-[var(--subtle-foreground)]">
              Next
            </div>
            <div className="font-mono text-[11px] text-[var(--foreground)] truncate">
              {status?.nextCycleSlug ?? "—"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
