#!/usr/bin/env node
// Wallet Tracker one-click launcher.
//
// Responsibilities:
//   1. Install dependencies if they're missing (first-run).
//   2. Build the app if there's no production build yet.
//   3. Free up our dedicated port by killing any stale instance of *this* app.
//   4. Start the Next.js production server on a fixed port.
//   5. Wait for it to be ready, then open the browser.
//   6. Forward SIGINT/SIGTERM so closing the terminal window stops the server.
//
// Cross-platform: macOS, Linux, and Windows.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const PORT = Number(process.env.WALLET_TRACKER_PORT || 3030);
const URL = `http://localhost:${PORT}`;

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

function log(msg) {
  console.log(`[WalletTracker] ${msg}`);
}

function runSync(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    shell: isWindows,
    ...opts,
  });
  if (result.status !== 0) {
    log(`Command failed: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

// Returns PIDs listening on the given port. Works on macOS, Linux, Windows.
function pidsOnPort(port) {
  try {
    if (isWindows) {
      const out = spawnSync("netstat", ["-ano"], { encoding: "utf-8" }).stdout || "";
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/LISTENING\s+(\d+)/);
        if (m && line.includes(`:${port} `)) pids.add(m[1]);
      }
      return [...pids];
    }
    const out = spawnSync("lsof", ["-ti", `tcp:${port}`], {
      encoding: "utf-8",
    }).stdout || "";
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    if (isWindows) {
      spawnSync("taskkill", ["/PID", pid, "/F"], { stdio: "ignore" });
    } else {
      process.kill(Number(pid), "SIGTERM");
    }
  } catch {}
}

async function freePort(port) {
  const pids = pidsOnPort(port);
  if (pids.length === 0) return;
  log(`Port ${port} is in use — stopping stale process(es): ${pids.join(", ")}`);
  for (const pid of pids) killPid(pid);
  // Give the OS a moment to release the port
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    if (pidsOnPort(port).length === 0) return;
  }
  log(`Warning: could not free port ${port}. Starting anyway.`);
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || (res.status >= 300 && res.status < 400)) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

function openBrowser(url) {
  const cmd = isMac ? "open" : isWindows ? "cmd" : "xdg-open";
  const args = isWindows ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch (err) {
    log(`Could not auto-open browser. Visit ${url} manually.`);
  }
}

// ── 1. Ensure dependencies are installed ──────────────────────────────────────
function hasDepsInstalled() {
  if (!existsSync(resolve(PROJECT_ROOT, "node_modules"))) return false;
  try {
    const entries = readdirSync(resolve(PROJECT_ROOT, "node_modules"));
    return entries.length > 10; // heuristic: a real install has many entries
  } catch {
    return false;
  }
}

if (!hasDepsInstalled()) {
  log("First-time setup — installing dependencies (this can take a few minutes)…");
  runSync("npm", ["install"]);
}

// ── 2. Ensure production build exists ────────────────────────────────────────
const buildDir = resolve(PROJECT_ROOT, ".next");
const buildManifest = resolve(buildDir, "BUILD_ID");
if (!existsSync(buildManifest)) {
  log("Building app (one-time, a minute or so)…");
  runSync("npm", ["run", "build"]);
}

// ── 3. Free the port ─────────────────────────────────────────────────────────
await freePort(PORT);

// ── 4. Start the server ──────────────────────────────────────────────────────
log(`Starting on ${URL}`);
const server = spawn(
  isWindows ? "npx.cmd" : "npx",
  ["next", "start", "-p", String(PORT)],
  {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    shell: isWindows,
  }
);

server.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));

// ── 5. Open the browser once it responds ─────────────────────────────────────
(async () => {
  const ready = await waitForServer(URL);
  if (!ready) {
    log(`Server did not respond within 60s. Check the logs above; visit ${URL} when ready.`);
    return;
  }
  log(`Ready → opening ${URL}`);
  openBrowser(URL);
})();
