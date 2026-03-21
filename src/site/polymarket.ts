import type { PageContext, PriceRow, Underlying } from "../domain/types";

const TEXT_BLOCK_SELECTOR = "p, span";
const THEORETICAL_ATTR = "data-theoretical-probability";
const HIT_EVENT_PATTERN = /what-price-will-(bitcoin|btc|ethereum|eth|solana|sol)-hit/i;
const BINARY_EVENT_PATTERN = /(bitcoin|btc|ethereum|eth|solana|sol)-(above|below)-on/i;
const SUPPORTED_EVENT_SLUG_PATTERN = /\b(bitcoin|btc|ethereum|eth|solana|sol)\b/i;
const MARKET_TIME_ZONE = "America/New_York";
const DEFAULT_BINARY_EXPIRY_TIME = {
  hour: 12,
  minute: 0,
  second: 0,
} as const;
const DEFAULT_TOUCH_EXPIRY_TIME = {
  hour: 23,
  minute: 59,
  second: 59,
} as const;

const MONTH_LOOKUP: Record<string, number> = {
  apr: 3,
  april: 3,
  aug: 7,
  august: 7,
  dec: 11,
  december: 11,
  feb: 1,
  february: 1,
  jan: 0,
  january: 0,
  jul: 6,
  july: 6,
  jun: 5,
  june: 5,
  mar: 2,
  march: 2,
  may: 4,
  nov: 10,
  november: 10,
  oct: 9,
  october: 9,
  sep: 8,
  sept: 8,
  september: 8,
};

export function isSupportedPage(location: Location): boolean {
  if (location.hostname !== "polymarket.com") {
    return false;
  }

  const eventSlug = parseEventSlug(location.pathname);
  return Boolean(eventSlug && isSupportedEventSlug(eventSlug));
}

export function parsePageContext(documentRef: Document, location: Location): PageContext | null {
  const eventSlug = parseEventSlug(location.pathname);
  if (!eventSlug || !isSupportedEventSlug(eventSlug)) {
    return null;
  }

  const title = getNormalizedTitle(documentRef);
  const sourceText = [eventSlug, title].filter(Boolean).join(" ").trim();

  if (!sourceText) {
    return null;
  }

  const marketDetails = parseMarketDetails(sourceText);

  if (!marketDetails) {
    return null;
  }

  const underlying = parseUnderlying(sourceText);
  const expiryUtcMs = parseExpiryFromText(sourceText, marketDetails.pricingStyle);

  if (!underlying || !expiryUtcMs) {
    return null;
  }

  return {
    defaultDirection: marketDetails.defaultDirection,
    expiryUtcMs,
    slug: eventSlug ?? location.pathname,
    pricingStyle: marketDetails.pricingStyle,
    title,
    underlying,
  };
}

export function collectPriceRows(root: HTMLElement, page: PageContext): PriceRow[] {
  const probabilityNodes = Array.from(root.querySelectorAll<HTMLElement>("p"))
    .filter(isVisible)
    .filter(isLeafLike)
    .filter((node) => parseProbability(node.textContent ?? "") !== null)
    .filter(isPrimaryProbabilityNode);

  const rows = new Map<HTMLElement, PriceRow>();

  for (const probabilityNode of probabilityNodes) {
    const row = locateRow(probabilityNode);

    if (!row || rows.has(row)) {
      continue;
    }

    const priceNode = findPrimaryPriceNode(row);

    if (!priceNode) {
      continue;
    }

    const barrier = parseBarrier(priceNode.textContent ?? "");

    if (!barrier) {
      continue;
    }

    rows.set(row, {
      barrier,
      direction: parseDirection(priceNode.textContent ?? "") ?? page.defaultDirection ?? "up",
      marketProbability: parseProbability(probabilityNode.textContent ?? "") ?? undefined,
      priceNode,
      probabilityNode,
      rowNode: row,
    });
  }

  return Array.from(rows.values()).sort((left, right) => left.barrier - right.barrier);
}

export function parseBarrier(text: string): number | null {
  const normalized = text
    .replace(/\s*理论\s+\d+(?:\.\d+)?%/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    normalized.length === 0 ||
    normalized.includes("%") ||
    /vol\.?$/i.test(normalized) ||
    !/^((btc|eth|sol|bitcoin|ethereum|solana)\s+)?([↑↓]\s*)?\$?\s*\d[\d,]*(?:\.\d+)?\s*k?$/i.test(
      normalized,
    )
  ) {
    return null;
  }

  const value = normalized.replace(/(btc|eth|sol|bitcoin|ethereum|solana|[↑↓$,\s])/gi, "").toLowerCase();

  if (value.endsWith("k")) {
    const parsedK = Number.parseFloat(value.slice(0, -1));
    return Number.isFinite(parsedK) ? parsedK * 1_000 : null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseUnderlying(text: string): Underlying | null {
  const lower = text.toLowerCase();

  if (lower.includes("bitcoin") || /\bbtc\b/.test(lower)) {
    return "BTC";
  }

  if (lower.includes("ethereum") || /\beth\b/.test(lower)) {
    return "ETH";
  }

  if (lower.includes("solana") || /\bsol\b/.test(lower)) {
    return "SOL";
  }

  return null;
}

function parseDirection(text: string): "up" | "down" | null {
  if (text.includes("↑")) {
    return "up";
  }

  if (text.includes("↓")) {
    return "down";
  }

  return null;
}

function parseMarketDetails(
  text: string,
): { defaultDirection?: "up" | "down"; pricingStyle: "binary" | "touch" } | null {
  if (HIT_EVENT_PATTERN.test(text)) {
    return { pricingStyle: "touch" };
  }

  const binaryMatch = text.match(BINARY_EVENT_PATTERN);

  if (!binaryMatch) {
    return null;
  }

  return {
    defaultDirection: binaryMatch[2] === "below" ? "down" : "up",
    pricingStyle: "binary",
  };
}

function locateRow(probabilityNode: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = probabilityNode;

  for (let depth = 0; current && depth < 8; depth += 1) {
    if (current.dataset.theoreticalRow === "ignore") {
      return null;
    }

    const priceNode = findPrimaryPriceNode(current);
    const probabilityCount = collectPrimaryProbabilityDescendants(current).length;

    if (priceNode && probabilityCount === 1 && hasTradeButtons(current)) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function collectTextCandidates(root: HTMLElement): HTMLElement[] {
  const selfCandidates = isVisible(root) && isLeafLike(root) ? [root] : [];
  const descendants = Array.from(root.querySelectorAll<HTMLElement>(TEXT_BLOCK_SELECTOR))
    .filter(isVisible)
    .filter(isLeafLike);

  return [...selfCandidates, ...descendants];
}

function findPrimaryPriceNode(row: HTMLElement): HTMLElement | null {
  const candidates = collectTextCandidates(row)
    .filter((node) => node.tagName === "P" || node.tagName === "SPAN")
    .filter(isPrimaryPriceNode);

  return candidates[0] ?? null;
}

function collectPrimaryProbabilityDescendants(row: HTMLElement): HTMLElement[] {
  return collectTextCandidates(row).filter(isPrimaryProbabilityNode);
}

function isPrimaryPriceNode(node: HTMLElement): boolean {
  const className = typeof node.className === "string" ? node.className : "";

  return parseBarrier(node.textContent ?? "") !== null && /text-heading-lg/.test(className);
}

function isPrimaryProbabilityNode(node: HTMLElement): boolean {
  const className = typeof node.className === "string" ? node.className : "";

  return (
    parseProbability(node.textContent ?? "") !== null &&
    node.tagName === "P" &&
    (/text-heading-2xl/.test(className) || /text-\[28px\]/.test(className))
  );
}

function hasTradeButtons(row: HTMLElement): boolean {
  const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>("button[data-active]"));

  if (buttons.length >= 2) {
    return true;
  }

  const buttonTexts = Array.from(row.querySelectorAll<HTMLButtonElement>("button"))
    .map((button) => button.textContent?.toLowerCase() ?? "")
    .join(" ");

  return buttonTexts.includes("buy yes") && buttonTexts.includes("buy no");
}

function parseProbability(text: string): number | null {
  const normalized = text.trim();
  const match = normalized.match(/^(\d{1,3}(?:\.\d+)?)%$/);

  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);

  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }

  return value / 100;
}

function getNormalizedTitle(documentRef: Document): string {
  const heading = documentRef.querySelector("h1")?.textContent?.trim();

  return heading || documentRef.title || "";
}

function parseExpiryFromText(text: string, pricingStyle: "binary" | "touch"): number | null {
  const lower = text.toLowerCase();
  const yearMatch = lower.match(/\b(\d{4})\b/);
  const beforeYearMatch = lower.match(/\bbefore[-\s_\/]+(\d{4})\b/);
  const monthMatch = lower.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/,
  );

  if (pricingStyle === "touch" && beforeYearMatch) {
    const cutoffYear = Number.parseInt(beforeYearMatch[1], 10);

    return zonedDateTimeToUtcMs(cutoffYear - 1, 11, 31, 23, 59, 59, MARKET_TIME_ZONE);
  }

  if (!monthMatch) {
    return null;
  }

  const now = new Date();
  const month = MONTH_LOOKUP[monthMatch[1]];
  const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : now.getUTCFullYear();
  const monthIndex = monthMatch.index ?? 0;
  const afterMonth = lower.slice(monthIndex + monthMatch[0].length);
  const beforeMonth = lower.slice(0, monthIndex);
  const afterDayRangeMatch = afterMonth.match(
    /^(?:[\s\-_\/]+)(\d{1,2})(?!\d)(?:[\s\-_\/]+(\d{1,2})(?!\d))?/,
  );
  const afterDayMatch = afterMonth.match(/^\s+(\d{1,2})(?!\d)/);
  const beforeDayMatch = beforeMonth.match(/(\d{1,2})\s+$/);
  const day = afterDayRangeMatch
    ? Number.parseInt(afterDayRangeMatch[2] ?? afterDayRangeMatch[1], 10)
    : afterDayMatch
      ? Number.parseInt(afterDayMatch[1], 10)
      : beforeDayMatch
        ? Number.parseInt(beforeDayMatch[1], 10)
        : lastUtcDayOfMonth(year, month);
  const explicitTime = parseExplicitTime(lower);
  const resolvedTime =
    pricingStyle === "binary" ? explicitTime ?? DEFAULT_BINARY_EXPIRY_TIME : DEFAULT_TOUCH_EXPIRY_TIME;

  return zonedDateTimeToUtcMs(
    year,
    month,
    day,
    resolvedTime.hour,
    resolvedTime.minute,
    resolvedTime.second,
    MARKET_TIME_ZONE,
  );
}

function parseEventSlug(pathname: string): string | null {
  const match = pathname.match(/^\/event\/([^/]+)/i);

  if (!match) {
    return null;
  }

  return match[1];
}

function isSupportedEventSlug(eventSlug: string): boolean {
  return SUPPORTED_EVENT_SLUG_PATTERN.test(eventSlug);
}

function lastUtcDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function parseExplicitTime(text: string): { hour: number; minute: number; second: number } | null {
  const match = text.match(/(?:^|[\s\-_\/])(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);

  if (!match) {
    return null;
  }

  const rawHour = Number.parseInt(match[1], 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;

  if (rawHour < 1 || rawHour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  const normalizedHour = rawHour % 12;

  return {
    hour: match[3].toLowerCase() === "pm" ? normalizedHour + 12 : normalizedHour,
    minute,
    second: 0,
  };
}

function zonedDateTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const targetUtcLike = Date.UTC(year, month, day, hour, minute, second);
  let guess = targetUtcLike;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = getTimeZoneParts(guess, timeZone);
    const interpretedUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );

    guess += targetUtcLike - interpretedUtc;
  }

  return guess;
}

function getTimeZoneParts(timestamp: number, timeZone: string): {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });

  const parts = formatter.formatToParts(new Date(timestamp));
  const lookup = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number.parseInt(part.value, 10)]),
  ) as Record<string, number>;

  return {
    day: lookup.day,
    hour: lookup.hour,
    minute: lookup.minute,
    month: lookup.month,
    second: lookup.second,
    year: lookup.year,
  };
}

function isLeafLike(node: HTMLElement): boolean {
  return (
    node.children.length === 0 ||
    Array.from(node.children).every(
      (child) => child instanceof HTMLElement && child.hasAttribute(THEORETICAL_ATTR),
    )
  );
}

function isVisible(node: HTMLElement): boolean {
  return Boolean(node.offsetParent || node.getClientRects().length);
}
