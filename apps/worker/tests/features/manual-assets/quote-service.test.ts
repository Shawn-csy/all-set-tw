import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  createManualAsset,
  listManualAssetHistory,
  listManualAssets,
} from "../../../src/features/manual-assets/repository";
import { refreshManualAssetQuotes } from "../../../src/features/manual-assets/service";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

describe("manual asset quote service", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;

  beforeAll(async () => {
    harness = await createTestD1();
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  beforeEach(async () => {
    await harness.binding.batch([
      harness.binding.prepare("DELETE FROM net_worth_history"),
      harness.binding.prepare("DELETE FROM manual_assets"),
    ]);
  });

  it("updates the cached price and valuation from Twelve Data", async () => {
    await createManualAsset(harness.binding, {
      id: "manual:aapl",
      name: "Apple",
      category: "us_stock",
      note: null,
      symbol: "AAPL",
      quantity: 2.5,
      currency: "USD",
      value: 100,
      date: "2026-09-23",
      now: "2026-09-23T00:00:00.000Z",
    });

    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toBe(
        "https://api.twelvedata.com/price?symbol=AAPL",
      );
      expect(init?.headers).toMatchObject({
        Authorization: "apikey test-key",
      });
      return new Response(JSON.stringify({ price: "123.45" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await expect(
      refreshManualAssetQuotes(
        harness.binding,
        "test-key",
        fetcher,
        { force: true, now: new Date("2026-09-24T01:00:00.000Z") },
      ),
    ).resolves.toEqual({
      status: "updated",
      updated: 1,
      skipped: 0,
      failed: 0,
    });

    await expect(listManualAssets(harness.binding)).resolves.toMatchObject([
      {
        id: "manual:aapl",
        marketPrice: 123.45,
        marketPriceAsOf: "2026-09-24T01:00:00.000Z",
        marketPriceProvider: "twelve-data",
      },
    ]);
    await expect(
      listManualAssetHistory(harness.binding, "manual:aapl"),
    ).resolves.toEqual([
      { date: "2026-09-23", value: 100 },
      { date: "2026-09-24", value: 309 },
    ]);
  });

  it("does not call the provider when the API key is missing", async () => {
    await expect(
      refreshManualAssetQuotes(harness.binding, undefined),
    ).resolves.toEqual({
      status: "not_configured",
      updated: 0,
      skipped: 0,
      failed: 0,
    });
  });
});
