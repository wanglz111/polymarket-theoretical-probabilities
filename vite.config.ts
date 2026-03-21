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
        name: "Polymarket Theoretical Probabilities",
        version: "0.2.1",
        description:
          "Inject theoretical BTC, ETH, and SOL probabilities into Polymarket touch and binary target price markets",
        match: ["https://polymarket.com/event/*"],
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
