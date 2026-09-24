import {
  createManualAsset as createManualAssetRecord,
  deleteManualAsset as deleteManualAssetRecord,
  deleteManualAssetHistory as deleteManualAssetHistoryRecord,
  listLatestManualAssetValues,
  listManualAssetHistory as listManualAssetHistoryRecords,
  listManualAssets as listManualAssetRecords,
  updateManualAsset as updateManualAssetRecord,
  updateManualAssetQuote,
  upsertManualAssetHistory,
} from "./repository";

import { z } from "zod";

const TWELVE_DATA_PRICE_URL = "https://api.twelvedata.com/price";
const TWELVE_DATA_PROVIDER = "twelve-data";
const QUOTE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 10_000;
const priceResponseSchema = z.object({
  price: z.union([z.string(), z.number()]),
});

export async function getManualAssets(db: D1Database) {
  const [assets, history] = await Promise.all([
    listManualAssetRecords(db),
    listLatestManualAssetValues(db),
  ]);
  const valueMap = Object.fromEntries(
    history.map((row) => [row.assetId, { value: row.value, date: row.date }]),
  );
  return assets.map((asset) => ({ ...asset, ...valueMap[asset.id] }));
}

export async function addManualAsset(
  db: D1Database,
  input: {
    name: string;
    category: string;
    note?: string;
    symbol?: string | null;
    quantity?: number | null;
    currency: string;
    value: number;
    date: string;
  },
) {
  const id = `manual:${crypto.randomUUID()}`;
  await createManualAssetRecord(db, {
    ...input,
    id,
    note: input.note ?? null,
    now: new Date().toISOString(),
  });
  return id;
}

export function editManualAsset(
  db: D1Database,
  id: string,
  input: {
    name?: string;
    category?: string;
    note?: string | null;
    symbol?: string | null;
    quantity?: number | null;
    currency?: string;
    value?: number;
    date?: string;
  },
) {
  return updateManualAssetRecord(db, id, input, new Date().toISOString());
}

export function removeManualAsset(db: D1Database, id: string) {
  return deleteManualAssetRecord(db, id);
}

export type ManualAssetQuoteRefreshResult = {
  status: "updated" | "not_configured" | "nothing_to_update";
  updated: number;
  skipped: number;
  failed: number;
};

export async function refreshManualAssetQuotes(
  db: D1Database,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
  options: { force?: boolean; now?: Date } = {},
): Promise<ManualAssetQuoteRefreshResult> {
  if (!apiKey?.trim()) {
    return { status: "not_configured", updated: 0, skipped: 0, failed: 0 };
  }

  const assets = await listManualAssetRecords(db);
  const candidates = assets.filter((asset) => asset.symbol);
  if (candidates.length === 0) {
    return { status: "nothing_to_update", updated: 0, skipped: 0, failed: 0 };
  }

  const now = options.now ?? new Date();
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const asset of candidates) {
    if (
      !options.force &&
      asset.marketPriceAsOf &&
      now.getTime() - new Date(asset.marketPriceAsOf).getTime() < QUOTE_MAX_AGE_MS
    ) {
      skipped += 1;
      continue;
    }

    try {
      const price = await fetchTwelveDataPrice(
        asset.symbol!,
        apiKey.trim(),
        fetcher,
      );
      const value =
        asset.quantity === null || asset.quantity === undefined
          ? undefined
          : Math.round(price * asset.quantity);
      const priceAsOf = now.toISOString();
      await updateManualAssetQuote(db, {
        id: asset.id,
        price,
        priceAsOf,
        provider: TWELVE_DATA_PROVIDER,
        value,
        date: taipeiDate(now),
        now: priceAsOf,
      });
      updated += 1;
    } catch {
      // Keep the previous cached price and valuation when one symbol fails.
      failed += 1;
    }
  }

  return {
    status: updated > 0 ? "updated" : "nothing_to_update",
    updated,
    skipped,
    failed,
  };
}

export async function refreshScheduledManualAssetQuotes(
  db: D1Database,
  apiKey: string | undefined,
) {
  if (!apiKey?.trim()) return;
  try {
    await refreshManualAssetQuotes(db, apiKey);
  } catch {
    console.error(
      JSON.stringify({
        event: "manual_asset_quotes_refresh_failed",
        provider: TWELVE_DATA_PROVIDER,
      }),
    );
  }
}

export function getManualAssetHistory(db: D1Database, id: string) {
  return listManualAssetHistoryRecords(db, id);
}

export function setManualAssetHistory(
  db: D1Database,
  id: string,
  input: { date: string; value: number },
) {
  return upsertManualAssetHistory(
    db,
    id,
    input.date,
    input.value,
    new Date().toISOString(),
  );
}

export function removeManualAssetHistory(
  db: D1Database,
  id: string,
  date: string,
) {
  return deleteManualAssetHistoryRecord(db, id, date);
}

async function fetchTwelveDataPrice(
  symbol: string,
  apiKey: string,
  fetcher: typeof fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetcher(
        `${TWELVE_DATA_PRICE_URL}?symbol=${encodeURIComponent(symbol)}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `apikey ${apiKey}`,
          },
          signal: controller.signal,
        },
      );
    } catch {
      throw new Error("Twelve Data request failed.");
    }

    if (!response.ok) {
      throw new Error("Twelve Data returned an unavailable response.");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Twelve Data returned invalid JSON.");
    }

    const parsed = priceResponseSchema.safeParse(payload);
    if (!parsed.success) throw new Error("Twelve Data returned no price.");
    const price = Number(parsed.data.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error("Twelve Data returned an invalid price.");
    }
    return price;
  } finally {
    clearTimeout(timeout);
  }
}

function taipeiDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}
