export type MarketDataFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type HistoricalCloseQuote = {
  symbol: string;
  tradeDate: string;
  price: number;
  provider: "twse-close" | "yahoo-close";
};

type TwseResponse = {
  stat?: unknown;
  data?: unknown;
};

type YahooResponse = {
  chart?: {
    result?: Array<{
      timestamp?: unknown;
      indicators?: { quote?: Array<{ close?: unknown }> };
    } | null>;
  };
};

/**
 * Find a historical close for a Taiwan-listed security.
 *
 * TWSE is preferred because its monthly endpoint is stable and returns the
 * local trading date explicitly. Yahoo is only a fallback for symbols that
 * are not present in TWSE, such as OTC/bond ETFs.
 */
export async function fetchHistoricalClose(
  symbol: string,
  tradeDate: string,
  fetcher: MarketDataFetcher = fetch,
): Promise<HistoricalCloseQuote | undefined> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol || !isIsoDate(tradeDate)) return undefined;

  const twseQuote = await fetchTwseClose(normalizedSymbol, tradeDate, fetcher);
  if (twseQuote !== undefined) return twseQuote;

  for (const suffix of ["TW", "TWO"] as const) {
    const quote = await fetchYahooClose(
      normalizedSymbol,
      tradeDate,
      suffix,
      fetcher,
    );
    if (quote !== undefined) return quote;
  }

  return undefined;
}

async function fetchTwseClose(
  symbol: string,
  tradeDate: string,
  fetcher: MarketDataFetcher,
): Promise<HistoricalCloseQuote | undefined> {
  const url = new URL("https://www.twse.com.tw/exchangeReport/STOCK_DAY");
  url.searchParams.set("response", "json");
  url.searchParams.set("date", `${tradeDate.slice(0, 7).replace("-", "")}01`);
  url.searchParams.set("stockNo", symbol);

  const payload = await fetchJson<TwseResponse>(fetcher, url);
  if (!payload || payload.stat !== "OK" || !Array.isArray(payload.data)) {
    return undefined;
  }

  for (const row of payload.data) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const date = parseRocDate(row[0]);
    const price = parsePrice(row[6]);
    if (date === tradeDate && price !== undefined) {
      return { symbol, tradeDate, price, provider: "twse-close" };
    }
  }
  return undefined;
}

async function fetchYahooClose(
  symbol: string,
  tradeDate: string,
  suffix: "TW" | "TWO",
  fetcher: MarketDataFetcher,
): Promise<HistoricalCloseQuote | undefined> {
  const from = Date.parse(`${tradeDate.slice(0, 7)}-01T00:00:00Z`) / 1000;
  const [year, month] = tradeDate.slice(0, 7).split("-").map(Number);
  const to =
    Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 2) /
    1000;
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${symbol}.${suffix}`)}`,
  );
  url.searchParams.set("period1", String(from - 86_400));
  url.searchParams.set("period2", String(to + 86_400));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "history");

  const payload = await fetchJson<YahooResponse>(fetcher, url);
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) return undefined;

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    const price = parsePrice(closes[index]);
    if (
      typeof timestamp === "number" &&
      taipeiDateFromUnixSeconds(timestamp) === tradeDate &&
      price !== undefined
    ) {
      return { symbol, tradeDate, price, provider: "yahoo-close" };
    }
  }
  return undefined;
}

async function fetchJson<T>(
  fetcher: MarketDataFetcher,
  url: URL,
): Promise<T | undefined> {
  try {
    const response = await fetcher(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

function parseRocDate(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return undefined;
  return `${Number(match[1]) + 1911}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
}

function parsePrice(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function taipeiDateFromUnixSeconds(value: number) {
  return new Date((value + 8 * 60 * 60) * 1_000).toISOString().slice(0, 10);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
