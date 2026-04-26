"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "wallettracker.betaToastDismissed.v1";

export function BetaToast() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch {}
    // Slight delay so the toast slides in *after* the page paints,
    // rather than appearing as part of the initial render.
    const t = setTimeout(() => setVisible(true), 400);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  };

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed bottom-5 left-5 z-50 max-w-[340px] rounded-xl px-4 py-3 flex items-start gap-3 animate-[slideUpIn_300ms_ease-out]"
      style={{
        background: "rgba(8, 9, 13, 0.92)",
        border: "1px solid var(--border)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 8px 30px rgba(0, 0, 0, 0.5)",
      }}
    >
      <span
        className="mt-0.5 inline-block h-2 w-2 rounded-full shrink-0"
        style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold text-[var(--foreground)]">
          Beta build
        </div>
        <div className="text-[11.5px] text-[var(--muted-foreground)] mt-0.5 leading-snug">
          This app is in active beta. You may run into bugs or rough edges —
          refresh the page or report issues in Discord.
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss beta notice"
        className="text-[var(--subtle-foreground)] hover:text-[var(--foreground)] shrink-0 leading-none -mr-1"
        style={{ fontSize: 18, padding: "0 4px" }}
      >
        ×
      </button>
    </div>
  );
}
