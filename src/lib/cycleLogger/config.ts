import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { CycleLoggerConfig, TrackedWallet } from "./types";

// Store data outside the project directory so Next.js file watcher
// doesn't trigger page reloads when CSVs or config are written.
const DATA_ROOT = path.join(os.homedir(), ".wallettracker");
const CONFIG_DIR = path.join(DATA_ROOT, "config");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: CycleLoggerConfig = {
  logPath: "",
  wallets: [],
};

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// mtime-based in-process cache. Every wallet/config GET ran a full
// readFileSync+JSON.parse before this; with three 3-second pollers open
// that was ~1 sync read/sec on the main thread. Cache invalidates the
// moment the file is rewritten (saveConfig bumps the mtime) so reads
// after a write still return fresh data.
let cachedConfig: CycleLoggerConfig | null = null;
let cachedMtimeMs = 0;

function readConfigFromDisk(): CycleLoggerConfig {
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  const parsed = JSON.parse(raw) as Partial<CycleLoggerConfig>;

  // Guard: reject logPath inside the project directory (causes page reloads)
  let logPath = parsed.logPath ?? "";
  const cwd = process.cwd();
  if (logPath && (logPath.startsWith(cwd + path.sep) || logPath === cwd)) {
    logPath = "";
  }
  const rawWallets = (parsed.wallets || []) as Array<
    Partial<TrackedWallet> & { address: string; label?: string }
  >;
  const wallets: TrackedWallet[] = rawWallets.map((w) => ({
    address: w.address,
    label: w.label || "",
    enabled: w.enabled ?? false,
  }));
  return { logPath, wallets };
}

export function loadConfig(): CycleLoggerConfig {
  try {
    ensureDir(CONFIG_DIR);
    if (!fs.existsSync(CONFIG_FILE)) {
      cachedConfig = null;
      cachedMtimeMs = 0;
      return { ...DEFAULT_CONFIG, wallets: [] };
    }
    const mtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
    if (cachedConfig && mtimeMs === cachedMtimeMs) {
      // Return a shallow copy so callers can't mutate the cache.
      return {
        logPath: cachedConfig.logPath,
        wallets: cachedConfig.wallets.map((w) => ({ ...w })),
      };
    }
    const fresh = readConfigFromDisk();
    cachedConfig = {
      logPath: fresh.logPath,
      wallets: fresh.wallets.map((w) => ({ ...w })),
    };
    cachedMtimeMs = mtimeMs;
    return fresh;
  } catch (err) {
    console.error("[WalletTracker] Failed to load config:", err);
  }
  return { ...DEFAULT_CONFIG, wallets: [] };
}

export function saveConfig(config: CycleLoggerConfig): void {
  ensureDir(CONFIG_DIR);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  // Prime the cache with the just-written state so the next read is free
  // AND doesn't race against a filesystem that hasn't flushed yet.
  try {
    cachedMtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
    cachedConfig = {
      logPath: config.logPath,
      wallets: config.wallets.map((w) => ({ ...w })),
    };
  } catch {
    cachedConfig = null;
    cachedMtimeMs = 0;
  }
}

export function addWallet(address: string, label: string): CycleLoggerConfig {
  const config = loadConfig();
  const addr = address.trim().toLowerCase();
  if (config.wallets.length >= 10) {
    throw new Error("Maximum 10 tracked wallets");
  }
  if (config.wallets.some((w) => w.address === addr)) {
    throw new Error("Wallet already tracked");
  }
  // First wallet added is enabled by default; subsequent wallets are
  // disabled so the user explicitly chooses which one to view.
  const enabled = config.wallets.length === 0;
  config.wallets.push({
    address: addr,
    label: label.trim() || addr.slice(0, 8),
    enabled,
  });
  saveConfig(config);
  return config;
}

export function removeWallet(address: string): CycleLoggerConfig {
  const config = loadConfig();
  const addr = address.trim().toLowerCase();
  const removedEnabled = config.wallets.find((w) => w.address === addr)?.enabled;
  config.wallets = config.wallets.filter((w) => w.address !== addr);
  // If the user removed their only enabled wallet, auto-enable the first
  // remaining wallet so the chart keeps streaming without a manual re-toggle.
  // (This runs ONCE on mutation, unlike the old loadConfig rule that
  // silently re-enabled on every read.)
  if (removedEnabled && config.wallets.length > 0 && !config.wallets.some((w) => w.enabled)) {
    config.wallets[0].enabled = true;
  }
  saveConfig(config);
  return config;
}

// Exclusive enable: turn on exactly one wallet and disable the rest.
// Pass null to disable all wallets.
export function setEnabledWallet(address: string | null): CycleLoggerConfig {
  const config = loadConfig();
  const addr = address?.trim().toLowerCase() ?? null;
  if (addr && !config.wallets.some((w) => w.address === addr)) {
    throw new Error("Wallet not tracked");
  }
  config.wallets = config.wallets.map((w) => ({
    ...w,
    enabled: w.address === addr,
  }));
  saveConfig(config);
  return config;
}

export function setLogPath(logPath: string): CycleLoggerConfig {
  const config = loadConfig();
  config.logPath = logPath;
  saveConfig(config);
  return config;
}

export function getTrackedWallets(): TrackedWallet[] {
  return loadConfig().wallets;
}
