import { normalCdf } from "./math";

export interface ModelInput {
  barrier: number;
  direction: "up" | "down";
  q: number;
  r: number;
  sigma: number;
  spot: number;
  timeToExpiryYears: number;
}

export function oneTouchHitProb(input: ModelInput): number {
  const { barrier, direction, q, r, sigma, spot, timeToExpiryYears } = input;

  if (!Number.isFinite(barrier) || !Number.isFinite(spot) || barrier <= 0 || spot <= 0) {
    return 0;
  }

  if (timeToExpiryYears <= 0 || sigma <= 0) {
    return 0;
  }

  if (direction === "up") {
    if (spot >= barrier) {
      return 1;
    }

    return clamp(calculateUpTouchProbability(barrier, q, r, sigma, spot, timeToExpiryYears), 0, 1);
  }

  if (spot <= barrier) {
    return 1;
  }

  return clamp(calculateDownTouchProbability(barrier, q, r, sigma, spot, timeToExpiryYears), 0, 1);
}

function calculateUpTouchProbability(
  barrier: number,
  q: number,
  r: number,
  sigma: number,
  spot: number,
  timeToExpiryYears: number,
): number {
  const a = Math.log(barrier / spot);
  const sigmaSqrtT = sigma * Math.sqrt(timeToExpiryYears);
  const m = r - q - 0.5 * sigma * sigma;
  const left = (-a + m * timeToExpiryYears) / sigmaSqrtT;
  const right = (-a - m * timeToExpiryYears) / sigmaSqrtT;
  const mirror = Math.exp((2 * m * a) / (sigma * sigma));

  return normalCdf(left) + mirror * normalCdf(right);
}

function calculateDownTouchProbability(
  barrier: number,
  q: number,
  r: number,
  sigma: number,
  spot: number,
  timeToExpiryYears: number,
): number {
  const a = Math.log(spot / barrier);
  const sigmaSqrtT = sigma * Math.sqrt(timeToExpiryYears);
  const m = r - q - 0.5 * sigma * sigma;
  const left = (-a - m * timeToExpiryYears) / sigmaSqrtT;
  const right = (-a + m * timeToExpiryYears) / sigmaSqrtT;
  const mirror = Math.exp((-2 * m * a) / (sigma * sigma));

  return normalCdf(left) + mirror * normalCdf(right);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
