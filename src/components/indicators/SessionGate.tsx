"use client";

import type { SessionStatus } from "@/hooks/useMonitorSession";

interface SessionGateProps {
  active: boolean;
  status: SessionStatus;
  showExtendPrompt: boolean;
  secondsUntilCap: number;
  onStart: () => void;
  onExtend: () => void;
  onEndNow: () => void;
}

const COPY: Record<
  Exclude<SessionStatus, "active">,
  { title: string; body: string; cta: string }
> = {
  idle: {
    title: "Live market monitor",
    body: "Data feeds connect only while you're actively watching. Start a session to go live.",
    cta: "Start monitoring",
  },
  "ended-cap": {
    title: "Session ended",
    body: "Your 15-minute session wrapped up. Start a fresh one whenever you're ready to keep watching.",
    cta: "Start new session",
  },
  "ended-idle": {
    title: "Paused — you stepped away",
    body: "We stopped the live feeds after a stretch with no activity, to keep things efficient. Resume when you're back.",
    cta: "Resume monitoring",
  },
  "ended-hidden": {
    title: "Paused in the background",
    body: "This tab was inactive, so we disconnected the live feeds. Resume to reconnect them.",
    cta: "Resume monitoring",
  },
};

function PrimaryButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-semibold text-[14px] text-white transition-transform hover:scale-[1.03]"
      style={{
        background: "var(--accent)",
        boxShadow: "0 6px 22px var(--accent-glow)",
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 5v14l11-7z" />
      </svg>
      {label}
    </button>
  );
}

export function SessionGate({
  active,
  status,
  showExtendPrompt,
  secondsUntilCap,
  onStart,
  onExtend,
  onEndNow,
}: SessionGateProps) {
  // While a session is live, only the (optional) extend prompt renders.
  if (active) {
    if (!showExtendPrompt) return null;
    return (
      <div
        role="status"
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[min(420px,calc(100vw-2rem))] rounded-xl p-5 animate-[slideUpIn_300ms_ease-out]"
        style={{
          background: "rgba(8, 9, 13, 0.94)",
          border: "1px solid var(--border-strong)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.55)",
        }}
      >
        <div className="flex items-start gap-3">
          <span
            className="mt-1 inline-block h-2 w-2 rounded-full shrink-0"
            style={{ background: "var(--warning)", boxShadow: "0 0 8px var(--warning)" }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-[var(--foreground)]">
              Still watching?
            </div>
            <div className="mt-1 text-[12px] text-[var(--muted-foreground)] leading-snug">
              This session ends in{" "}
              <span className="font-mono text-[var(--foreground)]">
                {secondsUntilCap}s
              </span>{" "}
              to keep things efficient. Extend it if you're still here.
            </div>
            <div className="mt-3.5 flex items-center gap-2.5">
              <button
                type="button"
                onClick={onExtend}
                className="px-4 py-2 rounded-lg font-semibold text-[12.5px] text-white transition-transform hover:scale-[1.03]"
                style={{ background: "var(--accent)" }}
              >
                Extend 15 min
              </button>
              <button
                type="button"
                onClick={onEndNow}
                className="px-4 py-2 rounded-lg font-medium text-[12.5px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              >
                Let it end
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Stopped / never-started — full-screen gate over the (faded) monitor.
  // `status` is never "active" here (handled above), but TS can't infer that.
  const copy = COPY[status === "active" ? "idle" : status];
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-5"
      style={{ background: "rgba(4, 5, 8, 0.78)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="card w-full max-w-[460px] p-9 text-center"
        style={{ boxShadow: "0 20px 70px rgba(0,0,0,0.6)" }}
      >
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "var(--accent-glow)" }}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: "var(--accent)", boxShadow: "0 0 10px var(--accent)" }}
          />
        </div>
        <h2 className="mt-5 text-[20px] font-semibold tracking-tight text-[var(--foreground)]">
          {copy.title}
        </h2>
        <p className="mt-2.5 text-[13.5px] text-[var(--muted-foreground)] leading-relaxed">
          {copy.body}
        </p>
        <div className="mt-7">
          <PrimaryButton label={copy.cta} onClick={onStart} />
        </div>
        <ul className="mt-7 flex flex-col gap-2 text-left">
          {[
            "Sessions run up to 15 minutes — extend anytime.",
            "Auto-pauses when you switch tabs or step away.",
            "Nothing streams while idle, so it stays efficient.",
          ].map((line) => (
            <li
              key={line}
              className="flex items-start gap-2.5 text-[12px] text-[var(--subtle-foreground)]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--success)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 shrink-0"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
