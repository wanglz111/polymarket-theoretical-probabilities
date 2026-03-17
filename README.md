# polymarket-touch-probabilities

Tampermonkey userscript project for injecting theoretical touch probabilities into Polymarket target-price pages.

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

## Current behavior

- Detects Polymarket target-price event pages for `BTC`, `ETH`, and `SOL`
- Supports slug patterns such as:
  - `what-price-will-bitcoin-hit-in-march-2026`
  - `what-price-will-bitcoin-hit-on-march-17`
  - `what-price-will-solana-hit-march-16-22`
- Ignores unsupported event types such as `above-on` pages
- Scans visible price rows
- Parses the barrier from each row
- Parses row direction from the displayed arrow:
  - `↑` for upward touch
  - `↓` for downward touch
- Fetches spot from Deribit for the detected underlying
- Uses nearest-expiry ATM IV from Deribit when available
- Falls back to a fixed `50%` IV if Deribit IV resolution fails
- Computes a simplified GBM one-touch probability
- Parses expiry using `America/New_York 23:59:59` market close and converts to UTC
- Injects `理论 xx.x%` next to the existing market probability in the row UI
- Re-renders automatically on SPA navigation and DOM refreshes

## Limits

- DOM detection is heuristic and tuned for current Polymarket row layouts
- The model uses a simplified GBM one-touch fair value, not a calibrated real-world probability
- Spot and IV come from Deribit, while Polymarket resolution may depend on another venue and rule set
- Monthly markets are treated as remaining-time touch problems; already-realized intramonth highs or lows are not incorporated
- A single nearest-expiry ATM IV is reused across all barriers for the page
- No edge display, config panel, or manual IV override UI yet
