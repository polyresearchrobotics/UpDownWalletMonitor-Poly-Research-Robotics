# Polymarket: Get All Wallets for a Market Slug

## Overview

There is no single endpoint that takes a slug and returns all wallets. You need two steps:

```
slug → conditionId → all positions → extract wallets
```

---

## Step 1: Get `conditionId` from Slug

**Endpoint:** `GET https://gamma-api.polymarket.com/markets?slug={slug}`

```bash
curl "https://gamma-api.polymarket.com/markets?slug=will-trump-win-the-2024-election"
```

Extract `conditionId` from the response (e.g. `0xdd22472e552920b8...`).

---

## Step 2: Get All Positions for That Market

**Endpoint:** `GET https://data-api.polymarket.com/positions?market={conditionId}`

Paginate using `limit` and `offset` until you get an empty page.

---

## Full JavaScript Example

```javascript
async function getWalletsForMarket(slug) {
  // Step 1: Get conditionId from slug
  const marketRes = await fetch(
    `https://gamma-api.polymarket.com/markets?slug=${slug}`
  );
  const markets = await marketRes.json();
  const conditionId = markets[0].conditionId;

  // Step 2: Paginate through all positions for that market
  const wallets = new Set();
  let offset = 0;
  const limit = 500;

  while (true) {
    const posRes = await fetch(
      `https://data-api.polymarket.com/positions?market=${conditionId}&limit=${limit}&offset=${offset}`
    );
    const positions = await posRes.json();

    if (!positions.length) break;

    positions.forEach(p => wallets.add(p.proxyWallet));

    if (positions.length < limit) break; // last page
    offset += limit;
  }

  return [...wallets];
}

// Usage
const wallets = await getWalletsForMarket("will-trump-win-the-2024-election");
console.log(`${wallets.length} unique wallets`, wallets);
```

---

## Position Response Fields

Each position object includes:

| Field | Description |
|---|---|
| `proxyWallet` | Wallet address (Polymarket proxy) |
| `outcome` | e.g. `"Yes"` or `"No"` |
| `size` | Number of shares held |
| `avgPrice` | Average purchase price |
| `currentValue` | Current value in USDC |
| `cashPnl` | Unrealized P&L |
| `slug` | Market slug |
| `conditionId` | On-chain market ID |

---

## Which Endpoint to Use

| Goal | Endpoint |
|---|---|
| Wallets with **active positions** right now | `/positions?market={conditionId}` |
| All wallets that **ever traded** (incl. sold) | `/activity?market={conditionId}` |

### Activity Endpoint Example

```javascript
// Replace the fetch in Step 2 with:
`https://data-api.polymarket.com/activity?market=${conditionId}&limit=${limit}&offset=${offset}`
// Then extract: p.proxyWallet
```

---

## Important Notes

- **No auth required** — both the Gamma API and Data API are fully public.
- **Pagination is important** — large markets can have thousands of positions. Always loop with `limit` + `offset` until you get an empty page.
- **`proxyWallet` vs real wallet** — the `proxyWallet` is Polymarket's internal proxy address, not the user's original MetaMask/Coinbase wallet address.
