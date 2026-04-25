import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Shape of all user-configurable API keys / endpoints.
export interface ApiKeys {
  domeApiKey: string;
  chainlinkApiKey: string;
  chainlinkUserSecret: string;
  polymarketProxyClob: string;
  polymarketProxyGamma: string;
}

export type ApiKeyName = keyof ApiKeys;

const DATA_ROOT = path.join(os.homedir(), ".wallettracker");
const SETTINGS_DIR = path.join(DATA_ROOT, "config");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Fallback values pulled from the host's environment (.env.local).
// Used when the user hasn't entered an override in the Settings UI.
function envApiKeys(): ApiKeys {
  return {
    domeApiKey:
      process.env.DOME_API_KEY?.trim() ||
      process.env.DOME_BEARER_TOKEN?.trim() ||
      "",
    chainlinkApiKey: process.env.CHAINLINK_API_KEY?.trim() || "",
    chainlinkUserSecret: process.env.CHAINLINK_USER_SECRET?.trim() || "",
    polymarketProxyClob: process.env.POLYMARKET_PROXY_CLOB?.trim() || "",
    polymarketProxyGamma: process.env.POLYMARKET_PROXY_GAMMA?.trim() || "",
  };
}

// mtime-backed cache so hot paths (Chainlink header signing, per-request
// gamma/clob URL resolution, Dome client init) don't re-parse settings.json
// on every call. Invalidates whenever the file is rewritten.
let cachedFileKeys: Partial<ApiKeys> = {};
let cachedMtimeMs = -1; // -1 = never loaded; 0 = file absent

function readFileKeys(): Partial<ApiKeys> {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      if (cachedMtimeMs !== 0) {
        cachedFileKeys = {};
        cachedMtimeMs = 0;
      }
      return cachedFileKeys;
    }
    const mtimeMs = fs.statSync(SETTINGS_FILE).mtimeMs;
    if (mtimeMs === cachedMtimeMs) return cachedFileKeys;
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    cachedFileKeys = JSON.parse(raw) as Partial<ApiKeys>;
    cachedMtimeMs = mtimeMs;
  } catch {}
  return cachedFileKeys;
}

// Resolved keys — user overrides win, env fills in anything missing.
export function loadApiKeys(): ApiKeys {
  const env = envApiKeys();
  const file = readFileKeys();
  const merged: ApiKeys = { ...env };
  for (const key of Object.keys(env) as ApiKeyName[]) {
    const v = file[key];
    if (typeof v === "string" && v.trim().length > 0) merged[key] = v;
  }
  return merged;
}

// Save a partial update. Persists only the user-edited overrides; env values
// remain the fallback.
export function saveApiKeys(update: Partial<ApiKeys>): ApiKeys {
  ensureDir(SETTINGS_DIR);
  const current = readFileKeys();
  const next: Partial<ApiKeys> = { ...current };
  for (const [k, v] of Object.entries(update)) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed.length === 0) {
      delete next[k as ApiKeyName];
    } else {
      next[k as ApiKeyName] = trimmed;
    }
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf-8");
  // Prime the cache so subsequent loads skip the disk round-trip.
  try {
    cachedFileKeys = next;
    cachedMtimeMs = fs.statSync(SETTINGS_FILE).mtimeMs;
  } catch {
    cachedFileKeys = {};
    cachedMtimeMs = -1;
  }
  return loadApiKeys();
}

export function getApiKey<K extends ApiKeyName>(key: K): ApiKeys[K] {
  return loadApiKeys()[key];
}
