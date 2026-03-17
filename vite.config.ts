import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  build: {
    target: "es2022",
  },
  plugins: [
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "Polymarket Theoretical Probability",
        namespace: "https://local.one-touch-market/",
        version: "0.1.0",
        description:
          "Inject theoretical BTC and ETH touch probabilities into Polymarket target price rows",
        match: ["https://polymarket.com/*", "https://*.polymarket.com/*"],
        grant: ["GM_xmlhttpRequest"],
        connect: ["www.deribit.com"],
        runAt: "document-idle",
      },
      build: {
        fileName: "polymarket-theoretical-prob.user.js",
      },
    }),
  ],
});
