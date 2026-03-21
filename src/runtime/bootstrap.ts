import { createDeribitClient } from "../services/deribit";
import { computeTheoreticalProbabilities } from "../services/theoretical";
import { collectPriceRows, isSupportedPage, parsePageContext } from "../site/polymarket";
import { renderRowProbability } from "../ui/render";
import type { PageContext, PriceRow, RowProbability } from "../domain/types";

const REFRESH_MS = 60 * 60 * 1000;
const DOM_REFRESH_DEBOUNCE_MS = 300;
const MIN_DOM_REFRESH_INTERVAL_MS = 5_000;
const CACHE_TTL_MS = 30_000;
const OBSERVER_ACTIVE_WINDOW_MS = 12_000;
const URL_CHANGE_EVENT = "theoretical-probability:urlchange";

export async function bootstrap(): Promise<void> {
  if (!isSupportedPage(window.location)) {
    return;
  }

  const deribit = createDeribitClient();
  let lastUrl = window.location.href;
  let refreshTimer: number | undefined;
  let domRefreshTimer: number | undefined;
  let observerWindowTimer: number | undefined;
  let refreshInFlight = false;
  let lastRefreshAt = 0;
  let pendingRefresh = false;
  let pendingRefreshForce = false;
  let queuedForceRefresh = false;
  let observerConnected = false;
  let cachedSignature: string | null = null;
  let cachedResolved: RowProbability[] = [];
  let cachedAt = 0;

  const observer = new MutationObserver((records) => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      activateObserverWindow();
      queueRefresh(true);
      return;
    }

    if (!hasRelevantMutations(records)) {
      return;
    }

    queueRefresh();
  });

  const disconnectObserver = (): void => {
    if (!observerConnected) {
      return;
    }

    observer.disconnect();
    observerConnected = false;
  };

  const scheduleObserverDisconnect = (): void => {
    if (observerWindowTimer) {
      window.clearTimeout(observerWindowTimer);
    }

    observerWindowTimer = window.setTimeout(() => {
      disconnectObserver();
    }, OBSERVER_ACTIVE_WINDOW_MS);
  };

  const activateObserverWindow = (): void => {
    if (!observerConnected) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      observerConnected = true;
    }

    scheduleObserverDisconnect();
  };

  const runRefresh = async (force = false): Promise<void> => {
    if (!isSupportedPage(window.location)) {
      return;
    }

    if (refreshInFlight) {
      pendingRefresh = true;
      pendingRefreshForce ||= force;
      return;
    }

    refreshInFlight = true;
    lastRefreshAt = Date.now();

    try {
      const page = parsePageContext(document, window.location);

      if (!page) {
        return;
      }

      const rows = collectPriceRows(document.body, page);

      if (rows.length === 0) {
        activateObserverWindow();
        return;
      }

      const signature = buildRefreshSignature(page, rows);
      const now = Date.now();
      const canUseCachedResult =
        !force && cachedSignature === signature && now - cachedAt <= CACHE_TTL_MS;
      const resolved = canUseCachedResult
        ? rebindCachedRows(rows, cachedResolved)
        : await computeTheoreticalProbabilities({
            page,
            rows,
            deribit,
          });

      resolved.forEach((item) => {
        renderRowProbability(item.row, item.value);
      });

      if (!canUseCachedResult) {
        cachedSignature = signature;
        cachedResolved = resolved.map((item) => ({
          row: item.row,
          value: item.value,
        }));
        cachedAt = now;
      }

      scheduleObserverDisconnect();
    } catch (error) {
      console.error("[theoretical-probability] refresh failed", error);
    } finally {
      refreshInFlight = false;

      if (pendingRefresh) {
        const nextForce = pendingRefreshForce;
        pendingRefresh = false;
        pendingRefreshForce = false;
        queueRefresh(nextForce);
      }
    }
  };

  const queueRefresh = (force = false): void => {
    queuedForceRefresh ||= force;

    if (domRefreshTimer) {
      window.clearTimeout(domRefreshTimer);
    }

    const throttleDelay = queuedForceRefresh
      ? 0
      : Math.max(0, MIN_DOM_REFRESH_INTERVAL_MS - (Date.now() - lastRefreshAt));

    domRefreshTimer = window.setTimeout(() => {
      const nextForce = queuedForceRefresh;
      queuedForceRefresh = false;
      void runRefresh(nextForce);
    }, DOM_REFRESH_DEBOUNCE_MS + throttleDelay);
  };

  const scheduleRefresh = (): void => {
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
    }

    refreshTimer = window.setInterval(() => {
      void runRefresh(true);
    }, REFRESH_MS);
  };

  installHistoryHooks();
  window.addEventListener("popstate", () => {
    activateObserverWindow();
    queueRefresh(true);
  });
  window.addEventListener("hashchange", () => {
    activateObserverWindow();
    queueRefresh(true);
  });
  window.addEventListener(URL_CHANGE_EVENT, () => {
    activateObserverWindow();
    queueRefresh(true);
  });

  activateObserverWindow();

  scheduleRefresh();

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        void runRefresh(true);
      },
      { once: true },
    );
    return;
  }

  console.info("[theoretical-probability] bootstrap active", window.location.href);
  await runRefresh(true);
}

function buildRefreshSignature(page: PageContext, rows: PriceRow[]): string {
  return [
    page.slug,
    page.pricingStyle,
    page.expiryUtcMs,
    page.underlying,
    rows.map((row) => `${row.direction}:${row.barrier}`).join("|"),
  ].join("::");
}

function rebindCachedRows(rows: PriceRow[], cachedResolved: RowProbability[]): RowProbability[] {
  const valueByKey = new Map(
    cachedResolved.map((item) => [`${item.row.direction}:${item.row.barrier}`, item.value] as const),
  );

  return rows.map((row) => ({
    row,
    value: valueByKey.get(`${row.direction}:${row.barrier}`) ?? 0,
  }));
}

function hasRelevantMutations(records: MutationRecord[]): boolean {
  return records.some((record) => {
    if (record.type !== "childList") {
      return false;
    }

    return hasRelevantNodes(record.addedNodes) || hasRelevantNodes(record.removedNodes);
  });
}

function hasRelevantNodes(nodes: NodeList): boolean {
  return Array.from(nodes).some((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    if (node.hasAttribute("data-theoretical-probability")) {
      return false;
    }

    if (node.querySelector?.("[data-theoretical-probability]")) {
      const nonTheoreticalDescendant = Array.from(node.children).some(
        (child) => !(child instanceof HTMLElement) || !child.hasAttribute("data-theoretical-probability"),
      );

      if (!nonTheoreticalDescendant) {
        return false;
      }
    }

    return Boolean(node.querySelector?.("button, p, span") || /^(BUTTON|P|SPAN)$/.test(node.tagName));
  });
}

function installHistoryHooks(): void {
  const historyRef = window.history as History & {
    __theoreticalProbabilityPatched?: boolean;
  };

  if (historyRef.__theoreticalProbabilityPatched) {
    return;
  }

  historyRef.__theoreticalProbabilityPatched = true;

  const originalPushState = historyRef.pushState.bind(historyRef);
  const originalReplaceState = historyRef.replaceState.bind(historyRef);

  historyRef.pushState = ((...args: Parameters<History["pushState"]>) => {
    const result = originalPushState(...args);
    window.dispatchEvent(new Event(URL_CHANGE_EVENT));
    return result;
  }) as History["pushState"];

  historyRef.replaceState = ((...args: Parameters<History["replaceState"]>) => {
    const result = originalReplaceState(...args);
    window.dispatchEvent(new Event(URL_CHANGE_EVENT));
    return result;
  }) as History["replaceState"];
}
