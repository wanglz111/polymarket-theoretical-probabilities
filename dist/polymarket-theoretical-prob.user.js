// ==UserScript==
// @name         Polymarket Touch Probabilities
// @version      0.2.0
// @description  Inject theoretical BTC, ETH, and SOL touch probabilities into Polymarket target price rows
// @match        https://polymarket.com/*
// @match        https://*.polymarket.com/*
// @connect      www.deribit.com
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  'use strict';

  const INDEX_BY_CURRENCY = {
    BTC: "btc_usd",
    ETH: "eth_usd",
    SOL: "sol_usdc"
  };
  const INSTRUMENT_CURRENCY = {
    BTC: "BTC",
    ETH: "ETH",
    SOL: "SOL"
  };
  const TEN_MINUTES_MS = 10 * 60 * 1e3;
  function createDeribitClient() {
    const instrumentsCache = {};
    async function getSpot(currency) {
      const response = await request(
        `https://www.deribit.com/api/v2/public/get_index_price?index_name=${INDEX_BY_CURRENCY[currency]}`
      );
      const spot = response.index_price ?? response.estimated_delivery_price;
      if (!spot) {
        throw new Error(`Unable to resolve ${currency} spot from Deribit`);
      }
      return spot;
    }
    async function getInstruments(currency) {
      const now = Date.now();
      const cached = instrumentsCache[currency];
      if (cached && cached.expiresAt > now) {
        return cached.value;
      }
      const result = await request(
        `https://www.deribit.com/api/v2/public/get_instruments?currency=${INSTRUMENT_CURRENCY[currency]}&kind=option&expired=false`
      );
      instrumentsCache[currency] = {
        expiresAt: now + TEN_MINUTES_MS,
        value: result
      };
      return result;
    }
    async function getTicker(instrumentName) {
      return request(
        `https://www.deribit.com/api/v2/public/ticker?instrument_name=${encodeURIComponent(
        instrumentName
      )}`
      );
    }
    async function getReferenceIV(currency, expiryUtcMs, spot) {
      const instruments = await getInstruments(currency);
      const activeInstruments = instruments.filter((item) => item.expiration_timestamp >= Date.now());
      const expiry = selectNearestExpiry(activeInstruments, expiryUtcMs);
      if (!expiry) {
        return null;
      }
      const sameExpiry = activeInstruments.filter((item) => item.expiration_timestamp === expiry);
      const strike = selectNearestStrike(sameExpiry, spot);
      if (!strike) {
        return null;
      }
      const call = sameExpiry.find(
        (item) => item.option_type === "call" && item.strike === strike
      );
      const put = sameExpiry.find(
        (item) => item.option_type === "put" && item.strike === strike
      );
      const ivValues = await Promise.all([
        call ? getTicker(call.instrument_name) : Promise.resolve(null),
        put ? getTicker(put.instrument_name) : Promise.resolve(null)
      ]);
      const values = ivValues.map((item) => item?.mark_iv).filter((item) => Number.isFinite(item));
      if (values.length === 0) {
        return null;
      }
      return values.reduce((sum, value) => sum + value, 0) / values.length / 100;
    }
    return {
      getReferenceIV,
      getSpot
    };
  }
  function selectNearestExpiry(instruments, expiryUtcMs) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const instrument of instruments) {
      const distance = Math.abs(instrument.expiration_timestamp - expiryUtcMs);
      if (distance < bestDistance) {
        best = instrument.expiration_timestamp;
        bestDistance = distance;
      }
    }
    return best;
  }
  function selectNearestStrike(instruments, spot) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const instrument of instruments) {
      const distance = Math.abs(instrument.strike - spot);
      if (distance < bestDistance) {
        best = instrument.strike;
        bestDistance = distance;
      }
    }
    return best;
  }
  async function request(url) {
    const responseText = await gmRequest(url);
    const payload = JSON.parse(responseText);
    return payload.result;
  }
  function gmRequest(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        onerror: () => reject(new Error(`Request failed: ${url}`)),
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`Request failed with status ${response.status}: ${url}`));
            return;
          }
          resolve(response.responseText);
        },
        url
      });
    });
  }
  const SQRT_2 = Math.sqrt(2);
  function normalCdf(value) {
    return 0.5 * (1 + erf(value / SQRT_2));
  }
  function erf(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }
  function oneTouchHitProb(input) {
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
  function binaryExpiryProb(input) {
    const { barrier, direction, q, r, sigma, spot, timeToExpiryYears } = input;
    if (!Number.isFinite(barrier) || !Number.isFinite(spot) || barrier <= 0 || spot <= 0) {
      return 0;
    }
    if (timeToExpiryYears <= 0 || sigma <= 0) {
      return 0;
    }
    const sigmaSqrtT = sigma * Math.sqrt(timeToExpiryYears);
    const d2 = (Math.log(spot / barrier) + (r - q - 0.5 * sigma * sigma) * timeToExpiryYears) / sigmaSqrtT;
    return clamp(direction === "up" ? normalCdf(d2) : normalCdf(-d2), 0, 1);
  }
  function calculateUpTouchProbability(barrier, q, r, sigma, spot, timeToExpiryYears) {
    const a = Math.log(barrier / spot);
    const sigmaSqrtT = sigma * Math.sqrt(timeToExpiryYears);
    const m = r - q - 0.5 * sigma * sigma;
    const left = (-a + m * timeToExpiryYears) / sigmaSqrtT;
    const right = (-a - m * timeToExpiryYears) / sigmaSqrtT;
    const mirror = Math.exp(2 * m * a / (sigma * sigma));
    return normalCdf(left) + mirror * normalCdf(right);
  }
  function calculateDownTouchProbability(barrier, q, r, sigma, spot, timeToExpiryYears) {
    const a = Math.log(spot / barrier);
    const sigmaSqrtT = sigma * Math.sqrt(timeToExpiryYears);
    const m = r - q - 0.5 * sigma * sigma;
    const left = (-a - m * timeToExpiryYears) / sigmaSqrtT;
    const right = (-a + m * timeToExpiryYears) / sigmaSqrtT;
    const mirror = Math.exp(-2 * m * a / (sigma * sigma));
    return normalCdf(left) + mirror * normalCdf(right);
  }
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  const FALLBACK_IV = 0.5;
  const HOURS_PER_YEAR = 24 * 365;
  async function computeTheoreticalProbabilities(params) {
    const spot = await params.deribit.getSpot(params.page.underlying);
    const referenceIV = await params.deribit.getReferenceIV(params.page.underlying, params.page.expiryUtcMs, spot) ?? FALLBACK_IV;
    const timeToExpiryYears = Math.max(
      (params.page.expiryUtcMs - Date.now()) / (1e3 * 60 * 60 * HOURS_PER_YEAR),
      0
    );
    return params.rows.map((row) => ({
      row,
      value: params.page.pricingStyle === "binary" ? binaryExpiryProb({
        barrier: row.barrier,
        direction: row.direction,
        q: 0,
        r: 0,
        sigma: referenceIV,
        spot,
        timeToExpiryYears
      }) : oneTouchHitProb({
        barrier: row.barrier,
        direction: row.direction,
        q: 0,
        r: 0,
        sigma: referenceIV,
        spot,
        timeToExpiryYears
      })
    }));
  }
  const TEXT_BLOCK_SELECTOR = "p, span";
  const THEORETICAL_ATTR = "data-theoretical-probability";
  const HIT_EVENT_PATTERN = /what-price-will-(bitcoin|btc|ethereum|eth|solana|sol)-hit/i;
  const BINARY_EVENT_PATTERN = /(bitcoin|btc|ethereum|eth|solana|sol)-(above|below)-on/i;
  const MARKET_TIME_ZONE = "America/New_York";
  const MONTH_LOOKUP = {
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
    september: 8
  };
  function isSupportedPage(location) {
    return location.hostname === "polymarket.com";
  }
  function parsePageContext(documentRef, location) {
    const title = getNormalizedTitle(documentRef);
    const eventSlug = parseEventSlug(location.pathname);
    const sourceText = eventSlug ?? title;
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
      underlying
    };
  }
  function collectPriceRows(root, page) {
    const probabilityNodes = Array.from(root.querySelectorAll("p")).filter(isVisible).filter(isLeafLike).filter((node) => parseProbability(node.textContent ?? "") !== null).filter(isPrimaryProbabilityNode);
    const rows = /* @__PURE__ */ new Map();
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
        marketProbability: parseProbability(probabilityNode.textContent ?? "") ?? void 0,
        priceNode,
        probabilityNode,
        rowNode: row
      });
    }
    return Array.from(rows.values()).sort((left, right) => left.barrier - right.barrier);
  }
  function parseBarrier(text) {
    const normalized = text.replace(/\s*理论\s+\d+(?:\.\d+)?%/gi, "").replace(/\s+/g, " ").trim();
    if (normalized.length === 0 || normalized.includes("%") || /vol\.?$/i.test(normalized) || !/^((btc|eth|sol|bitcoin|ethereum|solana)\s+)?([↑↓]\s*)?\$?\s*\d[\d,]*(?:\.\d+)?\s*k?$/i.test(
      normalized
    )) {
      return null;
    }
    const value = normalized.replace(/(btc|eth|sol|bitcoin|ethereum|solana|[↑↓$,\s])/gi, "").toLowerCase();
    if (value.endsWith("k")) {
      const parsedK = Number.parseFloat(value.slice(0, -1));
      return Number.isFinite(parsedK) ? parsedK * 1e3 : null;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function parseUnderlying(text) {
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
  function parseDirection(text) {
    if (text.includes("↑")) {
      return "up";
    }
    if (text.includes("↓")) {
      return "down";
    }
    return null;
  }
  function parseMarketDetails(text) {
    if (HIT_EVENT_PATTERN.test(text)) {
      return { pricingStyle: "touch" };
    }
    const binaryMatch = text.match(BINARY_EVENT_PATTERN);
    if (!binaryMatch) {
      return null;
    }
    return {
      defaultDirection: binaryMatch[2] === "below" ? "down" : "up",
      pricingStyle: "binary"
    };
  }
  function locateRow(probabilityNode) {
    let current = probabilityNode;
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
  function collectTextCandidates(root) {
    const selfCandidates = isVisible(root) && isLeafLike(root) ? [root] : [];
    const descendants = Array.from(root.querySelectorAll(TEXT_BLOCK_SELECTOR)).filter(isVisible).filter(isLeafLike);
    return [...selfCandidates, ...descendants];
  }
  function findPrimaryPriceNode(row) {
    const candidates = collectTextCandidates(row).filter((node) => node.tagName === "P" || node.tagName === "SPAN").filter(isPrimaryPriceNode);
    return candidates[0] ?? null;
  }
  function collectPrimaryProbabilityDescendants(row) {
    return collectTextCandidates(row).filter(isPrimaryProbabilityNode);
  }
  function isPrimaryPriceNode(node) {
    const className = typeof node.className === "string" ? node.className : "";
    return parseBarrier(node.textContent ?? "") !== null && /text-heading-lg/.test(className);
  }
  function isPrimaryProbabilityNode(node) {
    const className = typeof node.className === "string" ? node.className : "";
    return parseProbability(node.textContent ?? "") !== null && node.tagName === "P" && (/text-heading-2xl/.test(className) || /text-\[28px\]/.test(className));
  }
  function hasTradeButtons(row) {
    const buttons = Array.from(row.querySelectorAll("button[data-active]"));
    if (buttons.length >= 2) {
      return true;
    }
    const buttonTexts = Array.from(row.querySelectorAll("button")).map((button) => button.textContent?.toLowerCase() ?? "").join(" ");
    return buttonTexts.includes("buy yes") && buttonTexts.includes("buy no");
  }
  function parseProbability(text) {
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
  function getNormalizedTitle(documentRef) {
    const heading = documentRef.querySelector("h1")?.textContent?.trim();
    return heading || documentRef.title || "";
  }
  function parseExpiryFromText(text, pricingStyle) {
    const lower = text.toLowerCase();
    const yearMatch = lower.match(/\b(\d{4})\b/);
    const monthMatch = lower.match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/
    );
    if (!monthMatch) {
      return null;
    }
    const now = /* @__PURE__ */ new Date();
    const month = MONTH_LOOKUP[monthMatch[1]];
    const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : now.getUTCFullYear();
    const monthIndex = monthMatch.index ?? 0;
    const afterMonth = lower.slice(monthIndex + monthMatch[0].length);
    const beforeMonth = lower.slice(0, monthIndex);
    const afterDayRangeMatch = afterMonth.match(
      /^(?:[\s\-_\/]+)(\d{1,2})(?!\d)(?:[\s\-_\/]+(\d{1,2})(?!\d))?/
    );
    const afterDayMatch = afterMonth.match(/^\s+(\d{1,2})(?!\d)/);
    const beforeDayMatch = beforeMonth.match(/(\d{1,2})\s+$/);
    const day = afterDayRangeMatch ? Number.parseInt(afterDayRangeMatch[2] ?? afterDayRangeMatch[1], 10) : afterDayMatch ? Number.parseInt(afterDayMatch[1], 10) : beforeDayMatch ? Number.parseInt(beforeDayMatch[1], 10) : lastUtcDayOfMonth(year, month);
    return pricingStyle === "binary" ? zonedDateTimeToUtcMs(year, month, day, 12, 0, 0, MARKET_TIME_ZONE) : zonedDateTimeToUtcMs(year, month, day, 23, 59, 59, MARKET_TIME_ZONE);
  }
  function parseEventSlug(pathname) {
    const match = pathname.match(/^\/event\/([^/]+)/i);
    if (!match) {
      return null;
    }
    return match[1];
  }
  function lastUtcDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }
  function zonedDateTimeToUtcMs(year, month, day, hour, minute, second, timeZone) {
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
        parts.second
      );
      guess += targetUtcLike - interpretedUtc;
    }
    return guess;
  }
  function getTimeZoneParts(timestamp, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric"
    });
    const parts = formatter.formatToParts(new Date(timestamp));
    const lookup = Object.fromEntries(
      parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number.parseInt(part.value, 10)])
    );
    return {
      day: lookup.day,
      hour: lookup.hour,
      minute: lookup.minute,
      month: lookup.month,
      second: lookup.second,
      year: lookup.year
    };
  }
  function isLeafLike(node) {
    return node.children.length === 0 || Array.from(node.children).every(
      (child) => child instanceof HTMLElement && child.hasAttribute(THEORETICAL_ATTR)
    );
  }
  function isVisible(node) {
    return Boolean(node.offsetParent || node.getClientRects().length);
  }
  function formatPercent(value) {
    return `${(value * 100).toFixed(1)}%`;
  }
  function formatLabel(value) {
    return `理论 ${formatPercent(value)}`;
  }
  const MARKER_ATTR = "data-theoretical-probability";
  const renderedNodeByProbability = /* @__PURE__ */ new WeakMap();
  function renderRowProbability(row, value) {
    cleanupLegacyPriceNode(row.priceNode);
    const label = formatLabel(value);
    normalizeProbabilityLine(row.probabilityNode);
    const existing = resolveExistingNode(row.probabilityNode);
    if (existing) {
      existing.textContent = label;
      applyProbabilityAdjacentStyle(existing, row.probabilityNode);
      return;
    }
    const node = document.createElement("span");
    node.setAttribute(MARKER_ATTR, "true");
    node.textContent = label;
    applyProbabilityAdjacentStyle(node, row.probabilityNode);
    row.probabilityNode.insertAdjacentElement("beforebegin", node);
    renderedNodeByProbability.set(row.probabilityNode, node);
  }
  function applyProbabilityAdjacentStyle(target, reference) {
    const style = window.getComputedStyle(reference);
    const referenceFontSize = Number.parseFloat(style.fontSize);
    const fontSize = Number.isFinite(referenceFontSize) ? `${Math.max(12, Math.round(referenceFontSize * 0.72))}px` : style.fontSize;
    target.style.fontFamily = style.fontFamily;
    target.style.fontSize = fontSize;
    target.style.fontWeight = "600";
    target.style.lineHeight = style.lineHeight;
    target.style.color = style.color;
    target.style.display = "inline-flex";
    target.style.alignItems = "center";
    target.style.whiteSpace = "nowrap";
    target.style.flexShrink = "0";
    target.style.pointerEvents = "none";
    target.style.opacity = "0.9";
  }
  function normalizeProbabilityLine(probabilityNode) {
    probabilityNode.style.display = "inline-flex";
    probabilityNode.style.alignItems = "center";
    probabilityNode.style.whiteSpace = "nowrap";
    const parent = probabilityNode.parentElement;
    if (!parent) {
      return;
    }
    parent.style.display = "inline-flex";
    parent.style.alignItems = "center";
    parent.style.columnGap = "8px";
    parent.style.whiteSpace = "nowrap";
  }
  function cleanupLegacyPriceNode(priceNode) {
    const legacyChild = priceNode.querySelector(`:scope > [${MARKER_ATTR}]`);
    if (legacyChild) {
      legacyChild.remove();
    }
  }
  function resolveExistingNode(probabilityNode) {
    const mappedNode = renderedNodeByProbability.get(probabilityNode);
    if (mappedNode?.isConnected) {
      return mappedNode;
    }
    const previousSibling = probabilityNode.previousElementSibling;
    if (previousSibling instanceof HTMLElement && previousSibling.hasAttribute(MARKER_ATTR)) {
      renderedNodeByProbability.set(probabilityNode, previousSibling);
      return previousSibling;
    }
    return null;
  }
  const REFRESH_MS = 60 * 60 * 1e3;
  const DOM_REFRESH_DEBOUNCE_MS = 300;
  const URL_CHANGE_EVENT = "theoretical-probability:urlchange";
  async function bootstrap() {
    if (!isSupportedPage(window.location)) {
      return;
    }
    const deribit = createDeribitClient();
    let lastUrl = window.location.href;
    let refreshTimer;
    let domRefreshTimer;
    let refreshInFlight = false;
    const runRefresh = async () => {
      if (refreshInFlight || !isSupportedPage(window.location)) {
        return;
      }
      refreshInFlight = true;
      try {
        const page = parsePageContext(document, window.location);
        if (!page) {
          return;
        }
        const rows = collectPriceRows(document.body, page);
        if (rows.length === 0) {
          return;
        }
        const resolved = await computeTheoreticalProbabilities({
          page,
          rows,
          deribit
        });
        resolved.forEach((item) => {
          renderRowProbability(item.row, item.value);
        });
      } catch (error) {
        console.error("[theoretical-probability] refresh failed", error);
      } finally {
        refreshInFlight = false;
      }
    };
    const queueRefresh = () => {
      if (domRefreshTimer) {
        window.clearTimeout(domRefreshTimer);
      }
      domRefreshTimer = window.setTimeout(() => {
        void runRefresh();
      }, DOM_REFRESH_DEBOUNCE_MS);
    };
    const scheduleRefresh = () => {
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
      }
      refreshTimer = window.setInterval(() => {
        void runRefresh();
      }, REFRESH_MS);
    };
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        queueRefresh();
        return;
      }
      queueRefresh();
    });
    installHistoryHooks();
    window.addEventListener("popstate", queueRefresh);
    window.addEventListener("hashchange", queueRefresh);
    window.addEventListener(URL_CHANGE_EVENT, queueRefresh);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    scheduleRefresh();
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          void runRefresh();
        },
        { once: true }
      );
      return;
    }
    console.info("[theoretical-probability] bootstrap active", window.location.href);
    await runRefresh();
  }
  function installHistoryHooks() {
    const historyRef = window.history;
    if (historyRef.__theoreticalProbabilityPatched) {
      return;
    }
    historyRef.__theoreticalProbabilityPatched = true;
    const originalPushState = historyRef.pushState.bind(historyRef);
    const originalReplaceState = historyRef.replaceState.bind(historyRef);
    historyRef.pushState = ((...args) => {
      const result = originalPushState(...args);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
      return result;
    });
    historyRef.replaceState = ((...args) => {
      const result = originalReplaceState(...args);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
      return result;
    });
  }
  void bootstrap();

})();