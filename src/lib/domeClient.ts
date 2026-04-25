import { DomeClient } from "@dome-api/sdk";
import { getApiKey } from "@/lib/settings";

let cachedKey: string | null = null;
let client: DomeClient | null = null;

function resolveApiKey(): string {
  const raw = getApiKey("domeApiKey");
  if (!raw) {
    throw new Error(
      "Dome API key is not set. Open Settings and add your Dome API key."
    );
  }
  return raw.replace(/^Bearer\s+/i, "");
}

export function getDomeClient(): DomeClient {
  const apiKey = resolveApiKey();
  if (!client || cachedKey !== apiKey) {
    client = new DomeClient({ apiKey });
    cachedKey = apiKey;
  }
  return client;
}
