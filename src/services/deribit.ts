import type { Underlying } from "../domain/types";

interface DeribitRequestResult<T> {
  result: T;
}

interface IndexPriceResult {
  estimated_delivery_price?: number;
  index_price?: number;
}

interface Instrument {
  expiration_timestamp: number;
  instrument_name: string;
  kind: "option";
  option_type: "call" | "put";
  strike: number;
}

interface TickerResult {
  mark_iv?: number;
}

interface InstrumentsCacheEntry {
  expiresAt: number;
  value: Instrument[];
}

type InstrumentsCache = Partial<Record<Underlying, InstrumentsCacheEntry>>;

export interface DeribitClient {
  getReferenceIV(currency: Underlying, expiryUtcMs: number, spot: number): Promise<number | null>;
  getSpot(currency: Underlying): Promise<number>;
}

const INDEX_BY_CURRENCY: Record<Underlying, string> = {
  BTC: "btc_usd",
  ETH: "eth_usd",
  SOL: "sol_usdc",
};

const INSTRUMENT_CURRENCY: Record<Underlying, string> = {
  BTC: "BTC",
  ETH: "ETH",
  SOL: "SOL",
};

const TEN_MINUTES_MS = 10 * 60 * 1000;

export function createDeribitClient(): DeribitClient {
  const instrumentsCache: InstrumentsCache = {};

  async function getSpot(currency: Underlying): Promise<number> {
    const response = await request<IndexPriceResult>(
      `https://www.deribit.com/api/v2/public/get_index_price?index_name=${INDEX_BY_CURRENCY[currency]}`,
    );

    const spot = response.index_price ?? response.estimated_delivery_price;

    if (!spot) {
      throw new Error(`Unable to resolve ${currency} spot from Deribit`);
    }

    return spot;
  }

  async function getInstruments(currency: Underlying): Promise<Instrument[]> {
    const now = Date.now();
    const cached = instrumentsCache[currency];

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const result = await request<Instrument[]>(
      `https://www.deribit.com/api/v2/public/get_instruments?currency=${INSTRUMENT_CURRENCY[currency]}&kind=option&expired=false`,
    );

    instrumentsCache[currency] = {
      expiresAt: now + TEN_MINUTES_MS,
      value: result,
    };

    return result;
  }

  async function getTicker(instrumentName: string): Promise<TickerResult> {
    return request<TickerResult>(
      `https://www.deribit.com/api/v2/public/ticker?instrument_name=${encodeURIComponent(
        instrumentName,
      )}`,
    );
  }

  async function getReferenceIV(
    currency: Underlying,
    expiryUtcMs: number,
    spot: number,
  ): Promise<number | null> {
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
      (item) => item.option_type === "call" && item.strike === strike,
    );
    const put = sameExpiry.find(
      (item) => item.option_type === "put" && item.strike === strike,
    );

    const ivValues = await Promise.all([
      call ? getTicker(call.instrument_name) : Promise.resolve(null),
      put ? getTicker(put.instrument_name) : Promise.resolve(null),
    ]);

    const values = ivValues
      .map((item) => item?.mark_iv)
      .filter((item): item is number => Number.isFinite(item));

    if (values.length === 0) {
      return null;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length / 100;
  }

  return {
    getReferenceIV,
    getSpot,
  };
}

function selectNearestExpiry(instruments: Instrument[], expiryUtcMs: number): number | null {
  let best: number | null = null;
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

function selectNearestStrike(instruments: Instrument[], spot: number): number | null {
  let best: number | null = null;
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

async function request<T>(url: string): Promise<T> {
  const responseText = await gmRequest(url);
  const payload = JSON.parse(responseText) as DeribitRequestResult<T>;

  return payload.result;
}

function gmRequest(url: string): Promise<string> {
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
      url,
    });
  });
}
