import { describe, expect, it } from "vitest";
import { oneTouchHitProb } from "./model";

describe("oneTouchHitProb", () => {
  it("returns 1 when spot already crossed barrier", () => {
    expect(
      oneTouchHitProb({
        barrier: 80_000,
        direction: "up",
        q: 0,
        r: 0,
        sigma: 0.5,
        spot: 81_000,
        timeToExpiryYears: 14 / 365,
      }),
    ).toBe(1);
  });

  it("returns a sane probability for a standard case", () => {
    const value = oneTouchHitProb({
      barrier: 80_000,
      direction: "up",
      q: 0,
      r: 0,
      sigma: 0.5,
      spot: 74_300,
      timeToExpiryYears: 14 / 365,
    });

    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });

  it("returns a sane probability for a down-touch case", () => {
    const value = oneTouchHitProb({
      barrier: 65_000,
      direction: "down",
      q: 0,
      r: 0,
      sigma: 0.5,
      spot: 74_300,
      timeToExpiryYears: 14 / 365,
    });

    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });

  it("returns 1 when spot is already below a down barrier", () => {
    expect(
      oneTouchHitProb({
        barrier: 65_000,
        direction: "down",
        q: 0,
        r: 0,
        sigma: 0.5,
        spot: 60_000,
        timeToExpiryYears: 14 / 365,
      }),
    ).toBe(1);
  });
});
