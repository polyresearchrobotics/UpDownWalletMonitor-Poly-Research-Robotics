"use client";

import type { ReactNode } from "react";
import { ASSETS, TIMEFRAMES, type AssetId, type TimeframeId } from "@/lib/markets";

export interface SidebarButton {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: ReactNode;
}

interface IndicatorsSidebarProps {
  asset: AssetId;
  timeframe: TimeframeId;
  onAssetChange: (id: AssetId) => void;
  onTimeframeChange: (id: TimeframeId) => void;
  buttons: SidebarButton[];
  onButtonClick: (id: string) => void;
  activeButtonId?: string | null;
}

export const SIDEBAR_WIDTH = 248;

export function IndicatorsSidebar({
  asset,
  timeframe,
  onAssetChange,
  onTimeframeChange,
  buttons,
  onButtonClick,
  activeButtonId,
}: IndicatorsSidebarProps) {
  return (
    <aside
      className="fixed left-0 top-16 bottom-0 z-30 flex flex-col gap-7 px-4 py-6 overflow-y-auto"
      style={{
        width: SIDEBAR_WIDTH,
        background: "rgba(8, 9, 13, 0.72)",
        backdropFilter: "blur(12px)",
        borderRight: "1px solid var(--border)",
      }}
    >
      <Section title="Asset">
        <div className="grid grid-cols-2 gap-2">
          {ASSETS.map((a) => {
            const active = a.id === asset;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onAssetChange(a.id)}
                className="rounded-lg px-2.5 py-2.5 text-left transition-colors"
                style={{
                  background: active ? "var(--accent-glow)" : "var(--surface-2)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  color: active ? "var(--foreground)" : "var(--muted-foreground)",
                  boxShadow: active ? "0 0 0 2px var(--accent-glow)" : "none",
                }}
              >
                <div className="text-[12.5px] font-semibold tracking-tight">
                  {a.symbol}
                </div>
                <div className="text-[10.5px] text-[var(--muted-foreground)] mt-0.5 truncate">
                  {a.label}
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Timeframe">
        <div className="flex flex-col gap-1.5">
          {TIMEFRAMES.map((t) => {
            const active = t.id === timeframe;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTimeframeChange(t.id)}
                className="rounded-lg px-3 py-2 text-left transition-colors flex items-center justify-between"
                style={{
                  background: active ? "var(--accent-glow)" : "var(--surface-2)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  color: active ? "var(--foreground)" : "var(--muted-foreground)",
                  boxShadow: active ? "0 0 0 2px var(--accent-glow)" : "none",
                }}
              >
                <span className="text-[12.5px] font-semibold tracking-tight">
                  {t.label}
                </span>
                <span className="text-[10.5px] text-[var(--muted-foreground)]">
                  cycles
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {buttons.length > 0 && (
        <Section title="More">
          <div className="flex flex-col gap-1.5">
            {buttons.map((b) => {
              const active = activeButtonId === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onButtonClick(b.id)}
                  className="rounded-lg px-3 py-2.5 text-left transition-colors flex items-center gap-2.5"
                  style={{
                    background: active ? "var(--surface-2)" : "transparent",
                    border: `1px solid ${active ? "var(--border)" : "transparent"}`,
                    color: active ? "var(--foreground)" : "var(--muted-foreground)",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "var(--surface-2)";
                      e.currentTarget.style.color = "var(--foreground)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--muted-foreground)";
                    }
                  }}
                >
                  <span className="flex items-center justify-center w-4 h-4">
                    {b.icon}
                  </span>
                  <span className="text-[12.5px] flex-1">{b.label}</span>
                  {b.badge}
                </button>
              );
            })}
          </div>
        </Section>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-[0.1em] font-semibold mb-2.5 px-1"
        style={{ color: "var(--subtle-foreground)" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const LoggerIcon = (
  <svg {...iconProps}>
    <rect x="6" y="4" width="12" height="16" rx="2" />
    <path d="M9 4v2h6V4" />
    <path d="M9 11h6M9 15h4" />
  </svg>
);

export const ConnectionsIcon = (
  <svg {...iconProps}>
    <path d="M5 12a7 7 0 0 1 14 0" />
    <path d="M8.5 12a3.5 3.5 0 0 1 7 0" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </svg>
);
