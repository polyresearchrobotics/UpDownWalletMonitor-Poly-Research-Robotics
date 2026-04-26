"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "wallettracker.betaToastDismissed.v1";
const DISCORD_URL = "https://discord.gg/YsDHPNGSH4";

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
      className="fixed bottom-5 left-5 z-50 max-w-[340px] rounded-xl p-4 animate-[slideUpIn_300ms_ease-out]"
      style={{
        background: "rgba(8, 9, 13, 0.92)",
        border: "1px solid var(--border)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 8px 30px rgba(0, 0, 0, 0.5)",
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 inline-block h-2 w-2 rounded-full shrink-0"
          style={{
            background: "var(--accent)",
            boxShadow: "0 0 8px var(--accent)",
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-[var(--foreground)]">
            Heads up — early beta
          </div>
          <div className="text-[11.5px] text-[var(--muted-foreground)] mt-0.5 leading-snug">
            Some features may break. Help us out by reporting bugs in Discord.
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
      <a
        href={DISCORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 ml-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-semibold text-white transition-transform hover:scale-[1.03]"
        style={{
          background: "#1F2BFF",
          boxShadow: "0 2px 10px rgba(31, 43, 255, 0.4)",
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.946 2.419-2.157 2.419z" />
        </svg>
        Join Discord
      </a>
    </div>
  );
}
