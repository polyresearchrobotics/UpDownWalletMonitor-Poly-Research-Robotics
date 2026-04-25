import { NextResponse } from "next/server";
import { execFile } from "child_process";
import * as os from "os";
import { loadConfig } from "@/lib/cycleLogger/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function osascriptAsync(script: string, timeoutMs: number): Promise<string> {
  // execFile (not execSync) so the Node event loop keeps serving other
  // requests while the user is interacting with the Finder dialog.
  // Passing the script as a -e arg avoids shell-escaping entirely.
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-e", script],
      { timeout: timeoutMs, encoding: "utf-8" },
      (err, stdout, stderr) => {
        if (err) {
          // Distinguish dialog-cancelled from actual errors so the client
          // doesn't show a scary message on cancel.
          const msg = (stderr || err.message || "").trim();
          if (/User cancell?ed/i.test(msg) || /-128/.test(msg)) {
            resolve("__CANCELLED__");
            return;
          }
          reject(new Error(msg || "osascript failed"));
          return;
        }
        resolve((stdout || "").trim());
      }
    );
  });
}

// POST - open native macOS folder picker, return selected path
export async function POST() {
  if (os.platform() !== "darwin") {
    return NextResponse.json(
      {
        error:
          "The folder picker uses macOS's native dialog. Paste the log folder path directly into the input field instead.",
      },
      { status: 400 }
    );
  }

  try {
    const config = loadConfig();
    const defaultPath = config.logPath || process.env.HOME || "/";

    // AppleScript to open a native Finder folder picker dialog.
    const script = [
      `set defaultFolder to POSIX file ${JSON.stringify(defaultPath)}`,
      `try`,
      `  set selectedFolder to POSIX path of (choose folder with prompt "Select log folder" default location defaultFolder)`,
      `  return selectedFolder`,
      `on error errMsg number errNum`,
      `  if errNum is -128 then return "__CANCELLED__"`,
      `  error errMsg number errNum`,
      `end try`,
    ].join("\n");

    const result = await osascriptAsync(script, 120_000);

    if (result === "__CANCELLED__" || !result) {
      return NextResponse.json({ cancelled: true });
    }

    const selectedPath = result.endsWith("/") ? result.slice(0, -1) : result;
    return NextResponse.json({ path: selectedPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to open folder picker";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
