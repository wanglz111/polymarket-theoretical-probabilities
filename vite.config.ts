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
        name: "Polymarket Touch Probabilities",
        version: "0.2.0",
        description:
          "Inject theoretical BTC, ETH, and SOL touch probabilities into Polymarket target price rows",
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
