import { describe, expect, it } from "vitest";
import { parseBarrier, parsePageContext } from "./polymarket";

describe("parseBarrier", () => {
  it("parses formatted dollar values", () => {
    expect(parseBarrier("↑ $80,000")).toBe(80_000);
  });

  it("parses shorthand k notation", () => {
    expect(parseBarrier("BTC 80k")).toBe(80_000);
  });

  it("returns null for invalid strings", () => {
    expect(parseBarrier("44%")).toBeNull();
  });

  it("does not parse volume text as a target barrier", () => {
    expect(parseBarrier("$1,710,431 Vol.")).toBeNull();
  });

  it("does not parse combined wrapper text as a target barrier", () => {
    expect(parseBarrier("↑ 85,000 $1,710,431 Vol.")).toBeNull();
  });
});

describe("parsePageContext", () => {
  it("parses BTC event slugs", () => {
    const page = parsePageContext(
      {
        querySelector: () => null,
        title: "ignored",
      } as unknown as Document,
      {
        pathname: "/event/what-price-will-bitcoin-hit-in-march-2026",
      } as unknown as Location,
    );

    expect(page?.underlying).toBe("BTC");
    expect(page?.expiryUtcMs).toBeDefined();
  });

  it("parses ETH event slugs", () => {
    const page = parsePageContext(
      {
        querySelector: () => null,
        title: "ignored",
      } as unknown as Document,
      {
        pathname: "/event/what-price-will-ethereum-hit-in-march-2026",
      } as unknown as Location,
    );

    expect(page?.underlying).toBe("ETH");
    expect(page?.expiryUtcMs).toBeDefined();
  });
});
