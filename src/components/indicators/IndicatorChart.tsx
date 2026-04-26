"use client";

import { useEffect, useRef, memo, useState } from "react";
import type { WalletTrade } from "@/hooks/useWalletTradeStream";

// Dark theme colors — tuned to match the app's dark surface.
const COLORS = {
  spot: "#5eaaff",       // blue
  futures: "#9179f2",    // violet
  chainlink: "#ffc85c",  // amber
  up: "#34d08c",         // success green
  down: "#ff5d73",       // danger red
  background: "#101118", // var(--surface)
  grid: "rgba(255,255,255,0.05)",
  gridStrong: "rgba(255,255,255,0.08)",
  text: "rgba(236,236,243,0.55)",
  textDim: "rgba(236,236,243,0.32)",
  crosshair: "rgba(236,236,243,0.22)",
  tradeBuy: "#ffb347",
  tradeSell: "#ff7ab0",
};

const DEFAULT_RANGE_OPTIONS = [25, 50, 100, 200, 500, 1000];
const DEFAULT_RANGE = 500;

interface Point {
  t: number;
  v: number;
}

interface IndicatorChartProps {
  polymarketTokenIds: string[];
  cycleStartTime: number;
  cycleEndTime: number;
  walletTrades?: WalletTrade[];
  chainlinkPrice?: number | null;
  upMidPrice?: number | null;
  downMidPrice?: number | null;
  /** Live Binance spot price (from the page-level useBinancePrice hook). */
  spotPrice?: number | null;
  /** Live Binance futures price (from the page-level useBinancePrice hook). */
  futuresPrice?: number | null;
  /** Ticker used in axis labels, e.g. "BTC". */
  assetSymbol?: string;
  /** USD ± options for the price-range stepper. */
  rangeOptions?: number[];
  /** Default range value from the stepper. */
  defaultRange?: number;
}

export const IndicatorChart = memo(function IndicatorChart({
  polymarketTokenIds,
  cycleStartTime,
  cycleEndTime,
  walletTrades,
  chainlinkPrice,
  upMidPrice,
  downMidPrice,
  spotPrice,
  futuresPrice,
  assetSymbol = "BTC",
  rangeOptions = DEFAULT_RANGE_OPTIONS,
  defaultRange = DEFAULT_RANGE,
}: IndicatorChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const spotPoints = useRef<Point[]>([]);
  const futuresPoints = useRef<Point[]>([]);
  const chainlinkPoints = useRef<Point[]>([]);
  const upPoints = useRef<Point[]>([]);
  const downPoints = useRef<Point[]>([]);

  const latestSpot = useRef<number | null>(null);
  const latestFutures = useRef<number | null>(null);
  const latestChainlink = useRef<number | null>(null);
  const latestUp = useRef<number | null>(null);
  const latestDown = useRef<number | null>(null);

  const btcMid = useRef<number | null>(null);
  const [btcRange, setBtcRange] = useState(defaultRange);
  const btcRangeRef = useRef(btcRange);
  btcRangeRef.current = btcRange;

  // Reject spurious price jumps. Scale with the default range so that for ETH
  // (~$20 range) we don't demand BTC-sized $100 swings before rejecting.
  const maxPriceJump = Math.max(defaultRange * 0.25, 1);

  // The parent forces a remount via `key={asset-timeframe}` when the selected
  // market changes, so asset symbol is fixed for the lifetime of this instance.
  const assetSymbolRef = useRef(assetSymbol);

  const tokenIdsRef = useRef(polymarketTokenIds);
  tokenIdsRef.current = polymarketTokenIds;

  // Refs to hold cycle times so drawChart and the main effect can read
  // the latest values without being recreated / re-triggered.
  const cycleStartRef = useRef(cycleStartTime);
  const cycleEndRef = useRef(cycleEndTime);

  // Track previous cycle to detect actual cycle changes
  const prevCycleStartRef = useRef(cycleStartTime);
  const prevCycleEndRef = useRef(cycleEndTime);

  const viewStart = useRef(cycleStartTime);
  const viewEnd = useRef(cycleEndTime);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragViewStart = useRef(0);
  const dragViewEnd = useRef(0);

  const mouseX = useRef<number | null>(null);
  const mouseY = useRef<number | null>(null);

  const walletTradesRef = useRef<WalletTrade[]>([]);
  walletTradesRef.current = walletTrades ?? [];

  // Update refs whenever cycle times change
  cycleStartRef.current = cycleStartTime;
  cycleEndRef.current = cycleEndTime;

  // Update chainlink from prop
  useEffect(() => {
    if (chainlinkPrice != null && chainlinkPrice > 0) {
      latestChainlink.current = chainlinkPrice;
      if (btcMid.current === null) btcMid.current = chainlinkPrice;
    }
  }, [chainlinkPrice]);

  // Spot & futures are fed by the page-level useBinancePrice hook. The
  // chart used to open its own duplicate pair of WebSockets — 4 Binance
  // connections per page — for no benefit. The same barcode-rejection
  // logic now lives here, reading from props.
  useEffect(() => {
    if (spotPrice == null || !isFinite(spotPrice) || spotPrice <= 0) return;
    const prev = latestSpot.current;
    if (prev !== null && Math.abs(spotPrice - prev) > maxPriceJump) return;
    latestSpot.current = spotPrice;
    if (btcMid.current === null) btcMid.current = spotPrice;
  }, [spotPrice, maxPriceJump]);

  useEffect(() => {
    if (futuresPrice == null || !isFinite(futuresPrice) || futuresPrice <= 0) return;
    const prev = latestFutures.current;
    if (prev !== null && Math.abs(futuresPrice - prev) > maxPriceJump) return;
    latestFutures.current = futuresPrice;
    if (btcMid.current === null) btcMid.current = futuresPrice;
  }, [futuresPrice, maxPriceJump]);

  // Update Polymarket UP/DOWN from props (from the page-level hook)
  // Anti-barcode: reject jumps > 30¢ from last known value (likely bad data)
  useEffect(() => {
    if (upMidPrice != null && upMidPrice > 0.005 && upMidPrice < 0.995) {
      const prev = latestUp.current;
      if (prev !== null && Math.abs(upMidPrice - prev) > 0.30) return; // barcode spike
      latestUp.current = upMidPrice;
    }
  }, [upMidPrice]);

  useEffect(() => {
    if (downMidPrice != null && downMidPrice > 0.005 && downMidPrice < 0.995) {
      const prev = latestDown.current;
      if (prev !== null && Math.abs(downMidPrice - prev) > 0.30) return; // barcode spike
      latestDown.current = downMidPrice;
    }
  }, [downMidPrice]);

  // Stable drawChart that reads everything from refs — never recreated
  const drawChartRef = useRef<() => void>(() => {});
  drawChartRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cStart = cycleStartRef.current;
    const cEnd = cycleEndRef.current;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const w = rect.width;
    const h = rect.height;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = { top: 10, right: 70, bottom: 30, left: 80 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    if (plotW <= 0 || plotH <= 0) return;

    const vStart = viewStart.current;
    const vEnd = viewEnd.current;
    const vDuration = vEnd - vStart;
    if (vDuration <= 0) return;

    const mid = btcMid.current;
    const range = btcRangeRef.current;
    const btcTop = mid !== null ? mid + range : 0;
    const btcBottom = mid !== null ? mid - range : 0;

    const timeToX = (t: number) => pad.left + ((t - vStart) / vDuration) * plotW;

    const btcToY = (price: number) => {
      if (mid === null) return pad.top + plotH / 2;
      return pad.top + plotH - ((price - btcBottom) / (btcTop - btcBottom)) * plotH;
    };

    const shareToY = (cents: number) => pad.top + plotH - (cents / 100) * plotH;

    // Clear
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);

    // Share grid (every 10c)
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let c = 0; c <= 100; c += 10) {
      const y = shareToY(c);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    // Vertical grid lines (time)
    const cycleDuration = cEnd - cStart;
    const timeLabelPx = cycleDuration > 600 ? 8 : 10;
    ctx.font = `${timeLabelPx}px 'SF Mono', 'Fira Code', monospace`;
    ctx.textAlign = "center";
    const pxPerSec = plotW / vDuration;

    // Micro ticks
    if (pxPerSec >= 20) {
      ctx.strokeStyle = "rgba(255,255,255,0.02)";
      ctx.lineWidth = 1;
      for (let t = Math.ceil(vStart / 0.1) * 0.1; t <= vEnd; t += 0.1) {
        const x = timeToX(t);
        if (x < pad.left || x > w - pad.right) continue;
        ctx.beginPath(); ctx.moveTo(x, pad.top + plotH - 4); ctx.lineTo(x, pad.top + plotH); ctx.stroke();
      }
    }

    // Minor ticks: 1s
    if (pxPerSec >= 3) {
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let t = Math.ceil(vStart); t <= vEnd; t += 1) {
        const x = timeToX(t);
        if (x < pad.left || x > w - pad.right) continue;
        ctx.beginPath(); ctx.moveTo(x, pad.top + plotH - 8); ctx.lineTo(x, pad.top + plotH); ctx.stroke();
      }
    }

    // Medium ticks
    const medStep = vDuration <= 30 ? 1 : vDuration <= 60 ? 5 : 10;
    if (pxPerSec * medStep >= 15) {
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (let t = Math.ceil(vStart / medStep) * medStep; t <= vEnd; t += medStep) {
        const x = timeToX(t);
        if (x < pad.left || x > w - pad.right) continue;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + plotH); ctx.stroke();
      }
    }

    // Major ticks (labeled)
    const majorStep = vDuration <= 10 ? 1 : vDuration <= 30 ? 5 : vDuration <= 60 ? 10 : vDuration <= 120 ? 15 : 30;
    for (let t = Math.ceil(vStart / majorStep) * majorStep; t <= vEnd; t += majorStep) {
      const x = timeToX(t);
      if (x < pad.left || x > w - pad.right) continue;
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + plotH); ctx.stroke();

      const elapsed = t - cStart;
      const min = Math.floor(elapsed / 60);
      const sec = elapsed % 60;
      ctx.fillStyle = COLORS.text;
      ctx.fillText(`${min}:${sec.toString().padStart(2, "0")}`, x, h - 8);
    }

    // Left Y-axis: price labels (step scaled to the active range)
    ctx.font = "10px 'SF Mono', 'Fira Code', monospace";
    ctx.textAlign = "right";
    if (mid !== null) {
      const rawStep = (btcTop - btcBottom) / 6;
      const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1e-6))));
      const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
      const priceStep = candidates.reduce(
        (best, c) => (Math.abs(c - rawStep) < Math.abs(best - rawStep) ? c : best),
        candidates[0]
      );
      const startPrice = Math.ceil(btcBottom / priceStep) * priceStep;
      const priceDecimals = priceStep >= 1 ? 0 : priceStep >= 0.1 ? 2 : priceStep >= 0.01 ? 3 : 4;
      for (let p = startPrice; p <= btcTop; p += priceStep) {
        const y = btcToY(p);
        if (y < pad.top || y > pad.top + plotH) continue;
        ctx.fillStyle = COLORS.text;
        ctx.fillText(
          `$${p.toLocaleString(undefined, {
            minimumFractionDigits: priceDecimals,
            maximumFractionDigits: priceDecimals,
          })}`,
          pad.left - 8,
          y + 3
        );
      }
      // Mid line (dashed)
      const midY = btcToY(mid);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.left, midY); ctx.lineTo(w - pad.right, midY); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Left axis label
    ctx.save();
    ctx.translate(12, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = COLORS.textDim;
    ctx.font = "9px 'SF Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${assetSymbolRef.current} Price ($)`, 0, 0);
    ctx.restore();

    // Right Y-axis: Share price labels (0-100c)
    ctx.textAlign = "left";
    for (let c = 0; c <= 100; c += 10) {
      const y = shareToY(c);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(`${c}\u00A2`, w - pad.right + 8, y + 3);
    }

    // Right axis label
    ctx.save();
    ctx.translate(w - 12, pad.top + plotH / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = COLORS.textDim;
    ctx.font = "9px 'SF Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("Share Price (\u00A2)", 0, 0);
    ctx.restore();

    // Draw lines
    const nowSec = Date.now() / 1000;
    function drawLine(points: Point[], color: string, toY: (v: number) => number, liveValue: number | null): void {
      if (!ctx) return;
      const hasLive = liveValue !== null && nowSec >= cStart && nowSec <= cEnd;
      if (points.length === 0 && !hasLive) return;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      let started = false;

      for (const p of points) {
        const x = timeToX(p.t);
        const y = toY(p.v);
        if (x < pad.left - 5 || x > w - pad.right + 5) continue;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); }
      }

      if (hasLive) {
        const tipX = timeToX(nowSec);
        const tipY = toY(liveValue);
        if (tipX >= pad.left && tipX <= w - pad.right + 5) {
          if (!started) { ctx.moveTo(tipX, tipY); started = true; }
          else { ctx.lineTo(tipX, tipY); }
        }
      }
      ctx.stroke();

      if (hasLive) {
        const tipX = timeToX(nowSec);
        const tipY = toY(liveValue);
        if (tipX >= pad.left && tipX <= w - pad.right) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(tipX, tipY, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    const liveSpot = latestSpot.current;
    const liveFutures = latestFutures.current;
    const liveUp = latestUp.current !== null ? latestUp.current * 100 : null;
    const liveDown = latestDown.current !== null ? latestDown.current * 100 : null;

    const liveChainlink = latestChainlink.current;

    drawLine(spotPoints.current, COLORS.spot, btcToY, liveSpot);
    drawLine(futuresPoints.current, COLORS.futures, btcToY, liveFutures);
    drawLine(chainlinkPoints.current, COLORS.chainlink, btcToY, liveChainlink);
    drawLine(upPoints.current, COLORS.up, shareToY, liveUp);
    drawLine(downPoints.current, COLORS.down, shareToY, liveDown);

    // Wallet Trade Markers
    const wTrades = walletTradesRef.current;
    if (wTrades.length > 0) {
      // Find the line's interpolated y-value at a given timestamp so each
      // trade arrow sits exactly on its corresponding UP/DOWN price line.
      // Without this the marker plotted at the trade's executed fill
      // price, which can be a few cents off the live mid (taker fills
      // cross the spread, makers sit at the bid/ask) and looks detached
      // from the line. Visually it's misleading.
      const interpolateLineAt = (
        pts: { t: number; v: number }[],
        t: number
      ): number | null => {
        if (pts.length === 0) return null;
        if (t <= pts[0].t) return pts[0].v;
        if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
        let lo = 0;
        let hi = pts.length - 1;
        while (lo < hi - 1) {
          const mid = (lo + hi) >> 1;
          if (pts[mid].t <= t) lo = mid;
          else hi = mid;
        }
        const left = pts[lo];
        const right = pts[hi];
        if (right.t === left.t) return left.v;
        const frac = (t - left.t) / (right.t - left.t);
        return left.v + frac * (right.v - left.v);
      };

      for (const trade of wTrades) {
        const tx = timeToX(trade.timestamp);
        if (tx < pad.left - 10 || tx > w - pad.right + 10) continue;

        // Snap each marker to the line that matches its outcome. UNKNOWN
        // outcomes (rare — happens when the RTDS payload's `outcome`
        // field is missing) fall back to the trade's executed price.
        const linePrice =
          trade.outcome === "UP"
            ? interpolateLineAt(upPoints.current, trade.timestamp)
            : trade.outcome === "DOWN"
            ? interpolateLineAt(downPoints.current, trade.timestamp)
            : null;
        const priceCents = linePrice ?? trade.price * 100;
        const ty = shareToY(priceCents);
        const isBuy = trade.side === "BUY";
        const markerColor = trade.outcome === "UP" ? COLORS.up : trade.outcome === "DOWN" ? COLORS.down : COLORS.tradeBuy;
        const mSize = 7;

        ctx.fillStyle = markerColor;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (isBuy) {
          ctx.moveTo(tx, ty - mSize);
          ctx.lineTo(tx - mSize, ty + mSize * 0.6);
          ctx.lineTo(tx + mSize, ty + mSize * 0.6);
        } else {
          ctx.moveTo(tx, ty + mSize);
          ctx.lineTo(tx - mSize, ty - mSize * 0.6);
          ctx.lineTo(tx + mSize, ty - mSize * 0.6);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "rgba(236,236,243,0.85)";
        ctx.font = "bold 9px 'JetBrains Mono', 'SF Mono', monospace";
        ctx.textAlign = "center";
        const orderType = trade.executionRole === "TAKER" ? " FOK" : trade.executionRole === "MAKER" ? " GTC" : "";
        const label = `${isBuy ? "B" : "S"} ${priceCents.toFixed(0)}\u00A2${orderType}`;
        const labelY = isBuy ? ty - mSize - 5 : ty + mSize + 11;
        ctx.fillText(label, tx, labelY);

        if (trade.cost > 0) {
          ctx.fillStyle = "rgba(236,236,243,0.55)";
          ctx.font = "8px 'JetBrains Mono', 'SF Mono', monospace";
          const costStr = trade.cost >= 1000 ? `$${(trade.cost / 1000).toFixed(1)}k` : `$${trade.cost.toFixed(0)}`;
          const costY = isBuy ? ty - mSize - 15 : ty + mSize + 21;
          ctx.fillText(costStr, tx, costY);
        }
      }
    }

    // Crosshair
    if (mouseX.current !== null && mouseY.current !== null) {
      const mx = mouseX.current;
      const my = mouseY.current;
      if (mx >= pad.left && mx <= w - pad.right && my >= pad.top && my <= pad.top + plotH) {
        ctx.strokeStyle = COLORS.crosshair;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(mx, pad.top); ctx.lineTo(mx, pad.top + plotH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pad.left, my); ctx.lineTo(w - pad.right, my); ctx.stroke();
        ctx.setLineDash([]);

        const hoverTime = vStart + ((mx - pad.left) / plotW) * vDuration;
        const elapsed = hoverTime - cStart;
        const min = Math.floor(elapsed / 60);
        const sec = Math.floor(elapsed % 60);

        const shareCents = ((pad.top + plotH - my) / plotH) * 100;
        const btcPrice = mid !== null ? btcBottom + ((pad.top + plotH - my) / plotH) * (btcTop - btcBottom) : null;

        const tooltipW = 120;
        const tooltipH = 44;
        const ttx = mx + 15 + tooltipW > w ? mx - tooltipW - 10 : mx + 15;
        ctx.fillStyle = "rgba(16,17,24,0.96)";
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.lineWidth = 1;
        ctx.fillRect(ttx, my - 22, tooltipW, tooltipH);
        ctx.strokeRect(ttx, my - 22, tooltipW, tooltipH);
        ctx.fillStyle = "rgba(236,236,243,0.92)";
        ctx.font = "10px 'JetBrains Mono', 'SF Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText(`${min}:${sec.toString().padStart(2, "0")}`, ttx + 6, my - 8);
        if (btcPrice !== null) ctx.fillText(`$${btcPrice.toFixed(0)}`, ttx + 6, my + 5);
        ctx.fillText(`${shareCents.toFixed(1)}\u00A2`, ttx + 6, my + 18);
      }
    }

    // "Now" marker
    const now = Date.now() / 1000;
    if (now >= vStart && now <= vEnd) {
      const nx = timeToX(now);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(nx, pad.top); ctx.lineTo(nx, pad.top + plotH); ctx.stroke();
      ctx.setLineDash([]);
    }

    // "Cycle ended" overlay
    if (now > cEnd) {
      ctx.fillStyle = "rgba(16,17,24,0.75)";
      ctx.fillRect(pad.left, pad.top, plotW, plotH);
      ctx.fillStyle = "rgba(236,236,243,0.55)";
      ctx.font = "14px 'JetBrains Mono', 'SF Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("Cycle ended \u2014 waiting for next cycle...", pad.left + plotW / 2, pad.top + plotH / 2);
    }
  };

  // Mouse handlers for zoom/pan — uses refs so it only needs to bind once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const padL = 80;
      const plotW = rect.width - padL - 70;
      const frac = (mx - padL) / plotW;

      const vDur = viewEnd.current - viewStart.current;
      const duration = cycleEndRef.current - cycleStartRef.current;
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
      const newDur = Math.max(10, Math.min(duration, vDur * zoomFactor));

      const pivot = viewStart.current + frac * vDur;
      let newStart = pivot - frac * newDur;
      let newEnd = pivot + (1 - frac) * newDur;

      const cStart = cycleStartRef.current;
      const cEnd = cycleEndRef.current;
      if (newStart < cStart) { newStart = cStart; newEnd = newStart + newDur; }
      if (newEnd > cEnd) { newEnd = cEnd; newStart = newEnd - newDur; }
      newStart = Math.max(cStart, newStart);

      viewStart.current = newStart;
      viewEnd.current = newEnd;
    };

    const onMouseDown = (e: MouseEvent) => {
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragViewStart.current = viewStart.current;
      dragViewEnd.current = viewEnd.current;
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX.current = e.clientX - rect.left;
      mouseY.current = e.clientY - rect.top;

      if (isDragging.current) {
        const dx = e.clientX - dragStartX.current;
        const plotW = rect.width - 80 - 70;
        const vDur = dragViewEnd.current - dragViewStart.current;
        const timeDelta = -(dx / plotW) * vDur;

        let newStart = dragViewStart.current + timeDelta;
        let newEnd = dragViewEnd.current + timeDelta;

        const cStart = cycleStartRef.current;
        const cEnd = cycleEndRef.current;
        if (newStart < cStart) { newStart = cStart; newEnd = newStart + vDur; }
        if (newEnd > cEnd) { newEnd = cEnd; newStart = newEnd - vDur; }

        viewStart.current = newStart;
        viewEnd.current = newEnd;
      }
    };

    const onMouseUp = () => { isDragging.current = false; };
    const onMouseLeave = () => { isDragging.current = false; mouseX.current = null; mouseY.current = null; };
    const onDblClick = () => { viewStart.current = cycleStartRef.current; viewEnd.current = cycleEndRef.current; };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("dblclick", onDblClick);

    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("dblclick", onDblClick);
    };
  }, []); // stable — reads everything from refs

  // Detect actual cycle change and clear point arrays only then
  useEffect(() => {
    const prevStart = prevCycleStartRef.current;
    const prevEnd = prevCycleEndRef.current;

    if (cycleStartTime !== prevStart || cycleEndTime !== prevEnd) {
      prevCycleStartRef.current = cycleStartTime;
      prevCycleEndRef.current = cycleEndTime;

      // Only clear when the cycle truly changed
      spotPoints.current = [];
      futuresPoints.current = [];
      chainlinkPoints.current = [];
      upPoints.current = [];
      downPoints.current = [];
      btcMid.current = null;
      latestUp.current = null;
      latestDown.current = null;
      viewStart.current = cycleStartTime;
      viewEnd.current = cycleEndTime;
    }
  }, [cycleStartTime, cycleEndTime]);

  // Data sampling + render loop — runs once, reads cycle times from refs.
  // Binance spot/futures now come from the page's useBinancePrice hook
  // (props), so this effect no longer owns any WebSockets.
  useEffect(() => {
    if (!containerRef.current) return;

    let alive = true;

    // Max samples kept per series. 5s cycle × 4Hz sampling = ~1200 per
    // series; cap generously above that so a longer-than-expected cycle
    // can't let the arrays grow unbounded.
    const MAX_POINTS = 2000;

    // Sampling: push raw values to point arrays
    let lastPushedMs = 0;
    const sampleTimer = setInterval(() => {
      if (!alive) return;
      const nowMs = Date.now();
      if (nowMs - lastPushedMs < 40) return;
      lastPushedMs = nowMs;
      const now = nowMs / 1000;
      const cStart = cycleStartRef.current;
      const cEnd = cycleEndRef.current;
      if (now < cStart || now > cEnd) return;

      const sp = latestSpot.current;
      const fu = latestFutures.current;
      const cl = latestChainlink.current;
      const up = latestUp.current;
      const dn = latestDown.current;

      if (sp !== null) {
        spotPoints.current.push({ t: now, v: sp });
        if (spotPoints.current.length > MAX_POINTS) spotPoints.current.shift();
      }
      if (fu !== null) {
        futuresPoints.current.push({ t: now, v: fu });
        if (futuresPoints.current.length > MAX_POINTS) futuresPoints.current.shift();
      }
      if (cl !== null) {
        chainlinkPoints.current.push({ t: now, v: cl });
        if (chainlinkPoints.current.length > MAX_POINTS) chainlinkPoints.current.shift();
      }
      if (up !== null) {
        upPoints.current.push({ t: now, v: up * 100 });
        if (upPoints.current.length > MAX_POINTS) upPoints.current.shift();
      }
      if (dn !== null) {
        downPoints.current.push({ t: now, v: dn * 100 });
        if (downPoints.current.length > MAX_POINTS) downPoints.current.shift();
      }
    }, 250);

    // Animation loop — throttled to ~30fps and paused when the tab is
    // hidden. At 60fps we were redrawing 6000+ points × 5 series for no
    // visible gain; 30fps is indistinguishable to the eye.
    let rafId: number;
    let lastDrawMs = 0;
    const FRAME_MS = 33; // ~30fps
    function frame() {
      if (!alive) return;
      if (document.visibilityState !== "hidden") {
        const now = performance.now();
        if (now - lastDrawMs >= FRAME_MS) {
          lastDrawMs = now;
          drawChartRef.current();
        }
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      clearInterval(sampleTimer);
    };
  }, []); // stable — runs once, never torn down

  const legendItems: Array<{ color: string; label: string }> = [
    { color: COLORS.spot, label: `${assetSymbol} Spot` },
    { color: COLORS.futures, label: `${assetSymbol} Futures` },
    { color: COLORS.chainlink, label: "Chainlink" },
    { color: COLORS.up, label: "UP Share" },
    { color: COLORS.down, label: "DOWN Share" },
  ];

  return (
    <div className="card overflow-hidden">
      <div
        className="flex flex-wrap items-center gap-x-7 gap-y-3 px-7 py-5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {legendItems.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span
              className="inline-block h-[3px] w-5 rounded"
              style={{ background: item.color }}
            />
            <span className="text-[11px] text-[var(--muted-foreground)]">
              {item.label}
            </span>
          </div>
        ))}
        {walletTradesRef.current.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: COLORS.tradeBuy }}>
              {"\u25B2\u25BC"}
            </span>
            <span className="text-[11px] text-[var(--muted-foreground)]">
              Tracked ({walletTradesRef.current.length})
            </span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-[var(--subtle-foreground)]">
            {assetSymbol} range ±
          </span>
          <div
            className="flex items-center rounded-full overflow-hidden"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
            }}
          >
            <button
              onClick={() => {
                const idx = rangeOptions.indexOf(btcRange);
                if (idx > 0) setBtcRange(rangeOptions[idx - 1]);
              }}
              className="px-3 py-1 text-[12px] font-mono text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              −
            </button>
            <span className="px-3 text-[12px] font-mono text-[var(--foreground)] min-w-[56px] text-center">
              ${btcRange < 1 ? btcRange.toFixed(2) : btcRange}
            </span>
            <button
              onClick={() => {
                const idx = rangeOptions.indexOf(btcRange);
                if (idx < rangeOptions.length - 1)
                  setBtcRange(rangeOptions[idx + 1]);
              }}
              className="px-3 py-1 text-[12px] font-mono text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              +
            </button>
          </div>
          <span className="hidden md:inline text-[11px] text-[var(--subtle-foreground)]">
            Scroll · zoom &nbsp;·&nbsp; Drag · pan &nbsp;·&nbsp; Dbl-click · reset
          </span>
        </div>
      </div>
      <div ref={containerRef} style={{ height: 520, position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            cursor: "crosshair",
            display: "block",
          }}
        />
      </div>
    </div>
  );
});
