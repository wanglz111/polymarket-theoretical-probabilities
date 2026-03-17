# one-touch-market

Tampermonkey userscript project for injecting BTC target-row theoretical probabilities into Polymarket pages.

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

## Output

Build output:

```text
dist/polymarket-theoretical-prob.user.js
```

## Current V1 behavior

- Detects Polymarket BTC monthly target-price pages
- Scans visible price rows
- Parses the barrier from each row
- Fetches BTC spot from Deribit
- Uses nearest-expiry ATM IV from Deribit when available
- Falls back to a fixed `50%` IV if Deribit IV resolution fails
- Injects `理论 xx.x%` between the target price and the existing page probability
- Copies the right-side probability typography from computed styles

## Limits

- DOM detection is heuristic and tuned for current Polymarket row layouts
- Only BTC monthly target-price pages are supported
- The model is GBM one-touch fair value, not a real-world probability
- No edge display, config panel, or manual IV UI yet
