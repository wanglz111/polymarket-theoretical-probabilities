# polymarket-theoretical-probabilities

Tampermonkey userscript project for injecting theoretical probabilities into supported Polymarket crypto price markets.

## Stack

- Vite
- vite-plugin-monkey
- TypeScript
- Vitest

## Commands

```bash
npm install
npm run build
npm test
```

## Install

1. Run `npm run build`
2. Open Tampermonkey and create or update a script
3. Paste the contents of `dist/polymarket-theoretical-prob.user.js`
4. Save and refresh the matching Polymarket page

## Output

Build output:

```text
dist/polymarket-theoretical-prob.user.js
```

## Supported tokens

- `BTC`
- `ETH`
- `SOL`

## Supported markets

- One-touch target markets:
  - `what-price-will-bitcoin-hit-in-march-2026`
  - `what-price-will-bitcoin-hit-on-march-17`
  - `what-price-will-solana-hit-march-16-22`
  - `what-price-will-ethereum-hit-before-2027`
- Binary expiry markets:
  - `ethereum-above-on-march-18`
  - `solana-below-on-march-21`

## Current behavior

- Detects supported Polymarket crypto price event pages for `BTC`, `ETH`, and `SOL`
- Scans visible price rows
- Parses the barrier from each row
- Parses row direction from the displayed arrow when present:
  - `↑` for upward touch
  - `↓` for downward touch
- Uses event-type defaults when the row itself has no direction marker:
  - `above-on` defaults to `up`
  - `below-on` defaults to `down`
- Fetches spot from Deribit for the detected underlying
- Uses nearest-expiry ATM IV from Deribit when available
- Falls back to a fixed `50%` IV if Deribit IV resolution fails
- Computes market-specific probabilities:
  - one-touch pages use a simplified GBM one-touch model
  - `above-on / below-on` pages use a binary European digital model
- Parses expiry using Polymarket-style New York time conventions:
  - touch pages use `America/New_York 23:59:59`
  - `before-YYYY` touch pages resolve to the prior New York year-end
  - binary `above-on / below-on` pages use `America/New_York 12:00:00`
- Injects `理论 xx.x%` next to the existing market probability in the row UI
- Re-renders automatically on SPA navigation and DOM refreshes

## Limits

- DOM detection is heuristic and tuned for current Polymarket row layouts
- The model uses simplified theoretical pricing, not calibrated real-world probabilities
- Spot and IV come from Deribit, while Polymarket resolution may depend on another venue and rule set
- Touch markets are treated as remaining-time problems; already-realized intraperiod highs or lows are not incorporated
- A single nearest-expiry ATM IV is reused across all barriers for the page
- No edge display, config panel, or manual IV override UI yet
