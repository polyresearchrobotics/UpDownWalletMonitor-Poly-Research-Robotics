// Vercel build: keys come from env vars only. No filesystem persistence,
// no Settings UI — set values in the Vercel project's Environment Variables.

export interface ApiKeys {
  domeApiKey: string;
  chainlinkApiKey: string;
  chainlinkUserSecret: string;
  polymarketProxyClob: string;
  polymarketProxyGamma: string;
}

export type ApiKeyName = keyof ApiKeys;

export function loadApiKeys(): ApiKeys {
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

export function getApiKey<K extends ApiKeyName>(key: K): ApiKeys[K] {
  return loadApiKeys()[key];
}
