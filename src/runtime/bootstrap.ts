import { createDeribitClient } from "../services/deribit";
import { computeTheoreticalProbabilities } from "../services/theoretical";
import { collectPriceRows, isSupportedPage, parsePageContext } from "../site/polymarket";
import { renderRowProbability } from "../ui/render";

const REFRESH_MS = 60 * 60 * 1000;
const DOM_REFRESH_DEBOUNCE_MS = 300;
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

  const runRefresh = async (): Promise<void> => {
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
        deribit,
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

  const queueRefresh = (): void => {
    if (domRefreshTimer) {
      window.clearTimeout(domRefreshTimer);
    }

    domRefreshTimer = window.setTimeout(() => {
      void runRefresh();
    }, DOM_REFRESH_DEBOUNCE_MS);
  };

  const scheduleRefresh = (): void => {
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
    subtree: true,
  });

  scheduleRefresh();

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        void runRefresh();
      },
      { once: true },
    );
    return;
  }

  console.info("[theoretical-probability] bootstrap active", window.location.href);
  await runRefresh();
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
