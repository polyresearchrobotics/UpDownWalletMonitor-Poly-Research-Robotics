"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Cost-control session gate.
//
// Every live feed on the Indicators page (Polymarket SSE order-book proxy,
// Chainlink SSE, Binance WS, Polymarket RTDS WS) only runs while a session is
// `active`. Sessions never start on their own — the user must click Start —
// and they auto-stop in three situations so an unattended tab never streams:
//
//   1. Hard cap   — 15 minutes per session (an "Extend" prompt appears 60s
//                   before the cap so an actively-watching user can renew it).
//   2. Idle       — no mouse/key/touch/scroll for 90s while the tab is focused
//                   (user walked away from the machine).
//   3. Hidden     — the tab is backgrounded / the phone is locked for 30s
//                   (user switched to another tab and isn't watching).
//
// When stopped, the page tears down every socket/EventSource, so an idle or
// forgotten tab costs nothing.

export type SessionStatus =
  | "idle" // never started, or stopped — show the Start overlay
  | "active" // feeds live
  | "ended-cap" // hit the 15-minute ceiling
  | "ended-idle" // no interaction while focused
  | "ended-hidden"; // tab backgrounded

export const SESSION_CAP_MS = 15 * 60_000; // hard ceiling per session
export const EXTEND_LEAD_MS = 60_000; // show "Extend?" this long before the cap
const IDLE_TIMEOUT_MS = 90_000; // focused-but-no-interaction cutoff
const HIDDEN_GRACE_MS = 30_000; // backgrounded-tab cutoff
const TICK_MS = 1000;

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "pointerdown",
  "touchstart",
  "scroll",
  "wheel",
] as const;

export interface MonitorSession {
  /** True only while feeds should be connected. Gate every hook on this. */
  active: boolean;
  status: SessionStatus;
  /** Show the "session ending soon — extend?" prompt. */
  showExtendPrompt: boolean;
  /** Whole seconds until the hard cap fires (for the countdown). */
  secondsUntilCap: number;
  start: () => void;
  extend: () => void;
  /** Stop now. Defaults to a manual idle-style stop. */
  stop: (status?: Exclude<SessionStatus, "active">) => void;
}

export function useMonitorSession(): MonitorSession {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [showExtendPrompt, setShowExtendPrompt] = useState(false);
  const [secondsUntilCap, setSecondsUntilCap] = useState(
    Math.round(SESSION_CAP_MS / 1000)
  );

  // Timestamps live in refs so the tick loop reads fresh values without
  // re-subscribing. capAtRef is the moment the session will hard-stop;
  // lastActivityRef is the moment of the most recent user interaction.
  const capAtRef = useRef(0);
  const lastActivityRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (hiddenTimerRef.current) {
      clearTimeout(hiddenTimerRef.current);
      hiddenTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(
    (next: Exclude<SessionStatus, "active"> = "idle") => {
      clearTimers();
      setActive(false);
      setShowExtendPrompt(false);
      setStatus(next);
    },
    [clearTimers]
  );

  const start = useCallback(() => {
    const now = Date.now();
    capAtRef.current = now + SESSION_CAP_MS;
    lastActivityRef.current = now;
    setShowExtendPrompt(false);
    setSecondsUntilCap(Math.round(SESSION_CAP_MS / 1000));
    setStatus("active");
    setActive(true);
  }, []);

  const extend = useCallback(() => {
    const now = Date.now();
    capAtRef.current = now + SESSION_CAP_MS;
    lastActivityRef.current = now; // a click is also activity
    setShowExtendPrompt(false);
  }, []);

  // The single drive loop + listeners only exist while a session is active.
  useEffect(() => {
    if (!active) return;

    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, markActivity, { passive: true });
    }

    const onVisibility = () => {
      if (document.hidden) {
        // Backgrounded — give a short grace for a quick tab flip, then stop.
        if (hiddenTimerRef.current) clearTimeout(hiddenTimerRef.current);
        hiddenTimerRef.current = setTimeout(
          () => stop("ended-hidden"),
          HIDDEN_GRACE_MS
        );
      } else {
        // Back in focus — cancel the pending shutoff and count it as activity.
        if (hiddenTimerRef.current) {
          clearTimeout(hiddenTimerRef.current);
          hiddenTimerRef.current = null;
        }
        lastActivityRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    tickRef.current = setInterval(() => {
      const now = Date.now();

      // Idle (focused, no interaction) — independent of the hard cap.
      if (now - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        stop("ended-idle");
        return;
      }

      const remaining = capAtRef.current - now;
      setSecondsUntilCap(Math.max(0, Math.ceil(remaining / 1000)));

      if (remaining <= 0) {
        stop("ended-cap");
        return;
      }
      // Surface the extend prompt in the final lead-in window.
      setShowExtendPrompt(remaining <= EXTEND_LEAD_MS);
    }, TICK_MS);

    // If the tab is already hidden at start, arm the grace immediately.
    if (typeof document !== "undefined" && document.hidden) onVisibility();

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, markActivity);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      if (hiddenTimerRef.current) {
        clearTimeout(hiddenTimerRef.current);
        hiddenTimerRef.current = null;
      }
    };
  }, [active, stop]);

  return {
    active,
    status,
    showExtendPrompt,
    secondsUntilCap,
    start,
    extend,
    stop,
  };
}
