import { describe, expect, it } from "vitest";
import { isSupportedPage, parseBarrier, parsePageContext } from "./polymarket";

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
  it("rejects unsupported non-crypto event slugs early", () => {
    expect(
      isSupportedPage({
        hostname: "polymarket.com",
        pathname: "/event/will-it-rain-in-nyc-tomorrow",
      } as Location),
    ).toBe(false);

    const page = parsePageContext(
      {
        querySelector: () => null,
        title: "Will it rain in NYC tomorrow?",
      } as unknown as Document,
      {
        pathname: "/event/will-it-rain-in-nyc-tomorrow",
      } as unknown as Location,
    );

    expect(page).toBeNull();
  });

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

    const expiry = new Date(page!.expiryUtcMs);

    expect(page?.underlying).toBe("BTC");
    expect(page?.pricingStyle).toBe("touch");
    expect(page?.expiryUtcMs).toBeDefined();
    expect(expiry.getUTCMonth()).toBe(3);
    expect(expiry.getUTCDate()).toBe(1);
    expect(expiry.getUTCHours()).toBe(3);
    expect(expiry.getUTCMinutes()).toBe(59);
    expect(expiry.getUTCSeconds()).toBe(59);
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
    expect(page?.pricingStyle).toBe("touch");
    expect(page?.expiryUtcMs).toBeDefined();
  });

  it("parses SOL event slugs", () => {
    const page = parsePageContext(
      {
        querySelector: () => null,
        title: "ignored",
      } as unknown as Document,
      {
        pathname: "/event/what-price-will-solana-hit-in-july-2027",
      } as unknown as Location,
    );

    const expiry = new Date(page!.expiryUtcMs);

    expect(page?.underlying).toBe("SOL");
    expect(page?.pricingStyle).toBe("touch");
    expect(expiry.getUTCFullYear()).toBe(2027);
    expect(expiry.getUTCMonth()).toBe(7);
    expect(expiry.getUTCDate()).toBe(1);
    expect(expiry.getUTCHours()).toBe(3);
    expect(expiry.getUTCMinutes()).toBe(59);
    expect(expiry.getUTCSeconds()).toBe(59);
  });

  it("parses arbitrary month and year slugs", () => {
    const page = parsePageContext(
      {
        querySelector: () => null,
        title: "ignored",
      } as unknown as Document,
      {
        pathname: "/event/what-price-will-bitcoin-hit-in-october-2031",
      } as unknown as Location,
    );

    const expiry = new Date(page!.expiryUtcMs);

    expect(page?.underlying).toBe("BTC");
    expect(page?.pricingStyle).toBe("touch");
    expect(expiry.getUTCFullYear()).toBe(2031);
    expect(expiry.getUTCMonth()).toBe(10);
    expect(expiry.getUTCDate()).toBe(1);
    expect(expiry.getUTCHours()).toBe(3);
    expect(expiry.getUTCMinutes()).toBe(59);
    expect(expiry.getUTCSeconds()).toBe(59);
  });

  it("parses before-year touch pages using the previous New York year-end", () => {
    const page = parsePageContext(
      {
        querySelector: () => null,
        title: "ignored",
      } as unknown as Document,
      {
        pathname: "/event/what-price-will-ethereum-hit-before-2027",
      } as unknown as Location,
    );

    const expiry = new Date(page!.expiryUtcMs);

    expect(page?.underlying).toBe("ETH");
    expect(page?.pricingStyle).toBe("touch");
    expect(expiry.getUTCFullYear()).toBe(2027);
    expect(expiry.getUTCMonth()).toBe(0);
    expect(expiry.getUTCDate()).toBe(1);
    expect(expiry.getUTCHours()).toBe(4);
    expect(expiry.getUTCMinutes()).toBe(59);
    expect(expiry.getUTCSeconds()).toBe(59);
  });

  it("parses weekly BTC slug ranges using the end day", () => {
    const page = parsePageContext(
      {
        querySelector: () => null,
        title: "ignored",
      } as unknown as Document,
      {
        pathname: "/event/what-price-will-bitcoin-hit-march-16-22",
      } as unknown as Location,
    );

    const expiry = new Date(page!.expiryUtcMs);

    expect(page?.underlying).toBe("BTC");
    expect(page?.pricingStyle).toBe("touch");
    expect(expiry.getUTCMonth()).toBe(2);
    expect(expiry.getUTCDate()).toBe(23);
    expect(expiry.getUTCHours()).toBe(3);
    expect(expiry.getUTCMinutes()).toBe(59);
    expect(expiry.getUTCSeconds()).toBe(59);
    expect(expiry.getUTCFullYear()).toBe(new Date().getUTCFullYear());
  });

  it("parses on-march-17 pages using New York end of day", () => {
    const page = parsePageContext(
      {
        querySelector: () => null,
        title: "ignored",
      } as unknown as Document,
      {
        pathname: "/event/what-price-will-bitcoin-hit-on-march-17",
      } as unknown as Location,
    );

    const expiry = new Date(page!.expiryUtcMs);

    expect(page?.underlying).toBe("BTC");
    expect(page?.pricingStyle).toBe("touch");
    expect(expiry.getUTCMonth()).toBe(2);
    expect(expiry.getUTCDate()).toBe(18);
    expect(expiry.getUTCHours()).toBe(3);
    expect(expiry.getUTCMinutes()).toBe(59);
    expect(expiry.getUTCSeconds()).toBe(59);
  });

  it("parses above-on pages as binary up markets", () => {
    const page = parsePageContext(
      {
        querySelector: () => null,
        title: "ignored",
      } as unknown as Document,
      {
        pathname: "/event/ethereum-above-on-march-18",
      } as unknown as Location,
    );

    const expiry = new Date(page!.expiryUtcMs);

    expect(page?.underlying).toBe("ETH");
    expect(page?.pricingStyle).toBe("binary");
    expect(page?.defaultDirection).toBe("up");
    expect(expiry.getUTCMonth()).toBe(2);
    expect(expiry.getUTCDate()).toBe(18);
    expect(expiry.getUTCHours()).toBe(16);
    expect(expiry.getUTCMinutes()).toBe(0);
    expect(expiry.getUTCSeconds()).toBe(0);
  });

  it("parses below-on pages as binary down markets", () => {
    const page = parsePageContext(
      {
        querySelector: () => null,
        title: "ignored",
      } as unknown as Document,
      {
        pathname: "/event/solana-below-on-march-21",
      } as unknown as Location,
    );

    const expiry = new Date(page!.expiryUtcMs);

    expect(page?.underlying).toBe("SOL");
    expect(page?.pricingStyle).toBe("binary");
    expect(page?.defaultDirection).toBe("down");
    expect(expiry.getUTCMonth()).toBe(2);
    expect(expiry.getUTCDate()).toBe(21);
    expect(expiry.getUTCHours()).toBe(16);
    expect(expiry.getUTCMinutes()).toBe(0);
    expect(expiry.getUTCSeconds()).toBe(0);
  });
});
