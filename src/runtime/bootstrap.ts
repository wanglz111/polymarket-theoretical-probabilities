import { createDeribitClient } from "../services/deribit";
import { computeTheoreticalProbabilities } from "../services/theoretical";
import { collectPriceRows, isSupportedPage, parsePageContext } from "../site/polymarket";
import { renderRowProbability } from "../ui/render";

const REFRESH_MS = 60 * 60 * 1000;
const DOM_REFRESH_DEBOUNCE_MS = 300;
const MIN_DOM_REFRESH_INTERVAL_MS = 2_500;
const URL_CHANGE_EVENT = "theoretical-probability:urlchange";

export async function bootstrap(): Promise<void> {
  if (!isSupportedPage(window.location)) {
    return;
  }

  const deribit = createDeribitClient();
  let lastUrl = window.location.href;
  let refreshTimer: number | undefined;
  let domRefreshTimer: number | undefined;
  let refreshInFlight = false;
  let lastRefreshAt = 0;
  let pendingRefresh = false;
  let pendingRefreshForce = false;
  let queuedForceRefresh = false;

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
        return;
      }

      const resolved = await computeTheoreticalProbabilities({
        page,
        rows,
        deribit,
      });

      resolved.forEach((item) => {
        renderRowProbability(item.row, item.value);
      });
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

  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      queueRefresh();
      return;
    }

    queueRefresh();
  });

  installHistoryHooks();
  window.addEventListener("popstate", () => queueRefresh(true));
  window.addEventListener("hashchange", () => queueRefresh(true));
  window.addEventListener(URL_CHANGE_EVENT, () => queueRefresh(true));

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

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
