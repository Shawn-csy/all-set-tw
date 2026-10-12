import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addManualInvestmentHolding,
  getManualInvestmentHoldings,
} from "../../../src/features/manual-assets/service";
import {
  getInvestmentPage,
  getInvestmentTransactionsRange,
  setInvestmentPositionCost,
} from "../../../src/features/investments/service";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

describe("investment service", () => {
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
      harness.binding.prepare("DELETE FROM investment_transactions"),
      harness.binding.prepare(
        "DELETE FROM investment_transaction_amount_overrides",
      ),
      harness.binding.prepare("DELETE FROM investment_positions"),
      harness.binding.prepare("DELETE FROM investment_position_cost_overrides"),
    ]);
  });

  it("exposes a manually entered US stock as an investment holding", async () => {
    const id = await addManualInvestmentHolding(harness.binding, {
      name: "Apple",
      symbol: "aapl",
      quantity: 2.5,
      costPerShare: 200,
    });

    await expect(getManualInvestmentHoldings(harness.binding)).resolves.toEqual(
      [
        expect.objectContaining({
          id,
          assetType: "stock",
          symbol: "AAPL",
          quantity: 2.5,
          marketValue: 500,
          costPerShare: 200,
          costBasis: 500,
          currency: "USD",
          isManual: true,
        }),
      ],
    );

    const page = await getInvestmentPage(harness.binding, 100);
    expect(page.positions).toEqual([
      expect.objectContaining({
        id,
        symbol: "AAPL",
        marketValue: 500,
        costBasis: 500,
        isManual: true,
      }),
    ]);
  });

  it("adds a synced holding cost without changing its quantity or market value", async () => {
    await harness.binding
      .prepare(
        `INSERT INTO investment_positions
          (id, connector_id, source_id, asset_type, symbol, name, quantity, market_value,
           currency, as_of_date, created_at, updated_at)
         VALUES ('tdcc-holding', 'tdcc', '9627:0241272:0050:2026-09-12',
           'etf', '0050', '元大台灣50', 906, 101834, 'TWD',
           '2026-09-12', '2026-09-12', '2026-09-12')`,
      )
      .run();

    expect(
      await setInvestmentPositionCost(harness.binding, "tdcc-holding", 66.94),
    ).toBe(true);
    const page = await getInvestmentPage(harness.binding, 100);
    expect(page.positions).toEqual([
      expect.objectContaining({
        id: "tdcc-holding",
        quantity: 906,
        marketValue: 101834,
        costPerShare: 66.94,
        costBasis: Math.round(906 * 66.94),
      }),
    ]);
  });

  it("fills a missing TDCC trade amount from the trade-date close", async () => {
    await harness.binding
      .prepare(
        `INSERT INTO investment_transactions (
          id, connector_id, account_id, source_id, symbol, name, asset_type,
          trade_date, transaction_code, transaction_name, quantity, currency,
          amount, created_at, updated_at
        ) VALUES (?, 'tdcc', 'broker', ?, '2330', '台積電', 'stock', ?, '123', '賣出', ?, 'TWD', NULL, ?, ?)`,
      )
      .bind(
        "tdcc-sell",
        "sell-source",
        "2026-09-10T00:00:00.000Z",
        60,
        "2026-09-12T00:00:00.000Z",
        "2026-09-12T00:00:00.000Z",
      )
      .run();

    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("www.twse.com.tw");
      return new Response(
        JSON.stringify({
          stat: "OK",
          data: [["115/09/10", "", "", "", "", "", "123.45"]],
        }),
        { headers: { "content-type": "application/json" } },
      );
    };

    const rows = await getInvestmentTransactionsRange(
      harness.binding,
      { from: "2026-09-01", to: "2026-10-01" },
      undefined,
      fetcher,
    );

    expect(rows).toEqual([
      expect.objectContaining({
        id: "tdcc-sell",
        amount: 7407,
        amountSource: "historical-close",
        amountReferencePrice: 123.45,
        amountPriceDate: "2026-09-10",
        amountProvider: "twse-close",
      }),
    ]);
  });

  it("falls back to the OTC Yahoo symbol when TWSE has no history", async () => {
    await harness.binding
      .prepare(
        `INSERT INTO investment_transactions (
          id, connector_id, account_id, source_id, symbol, name, asset_type,
          trade_date, transaction_code, transaction_name, quantity, currency,
          amount, created_at, updated_at
        ) VALUES (?, 'tdcc', 'broker', ?, '00679B', '元大美債20年', 'etf', ?, '123', '賣出', ?, 'TWD', NULL, ?, ?)`,
      )
      .bind(
        "tdcc-otc-sell",
        "otc-sell-source",
        "2026-09-10",
        1000,
        "2026-09-12T00:00:00.000Z",
        "2026-09-12T00:00:00.000Z",
      )
      .run();

    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "www.twse.com.tw") {
        return new Response(
          JSON.stringify({ stat: "很抱歉，沒有符合條件的資料!" }),
        );
      }
      if (url.pathname.endsWith("00679B.TW")) {
        return new Response(JSON.stringify({ chart: { result: [null] } }));
      }
      return new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                timestamp: [Date.parse("2026-09-09T16:00:00Z") / 1000],
                indicators: { quote: [{ close: [31.25] }] },
              },
            ],
          },
        }),
      );
    };

    const rows = await getInvestmentTransactionsRange(
      harness.binding,
      { from: "2026-09-01", to: "2026-10-01" },
      undefined,
      fetcher,
    );

    expect(rows).toEqual([
      expect.objectContaining({
        id: "tdcc-otc-sell",
        amount: 31250,
        amountSource: "historical-close",
        amountReferencePrice: 31.25,
        amountPriceDate: "2026-09-10",
        amountProvider: "yahoo-close",
      }),
    ]);
  });

  it("calculates realized profit from the FIFO cost of sold shares", async () => {
    await harness.binding
      .prepare(
        `INSERT INTO investment_transactions (
          id, connector_id, account_id, source_id, symbol, name, asset_type,
          trade_date, transaction_code, transaction_name, quantity, currency,
          amount, created_at, updated_at
        ) VALUES (?, 'broker', 'broker-account', ?, '2330', '台積電', 'stock', ?, '113', '買進', ?, 'TWD', ?, ?, ?)`,
      )
      .bind(
        "buy-2330",
        "buy-source",
        "2025-01-02",
        100,
        10_000,
        "2025-01-02T00:00:00.000Z",
        "2025-01-02T00:00:00.000Z",
      )
      .run();
    await harness.binding
      .prepare(
        `INSERT INTO investment_transactions (
          id, connector_id, account_id, source_id, symbol, name, asset_type,
          trade_date, transaction_code, transaction_name, quantity, currency,
          amount, created_at, updated_at
        ) VALUES (?, 'broker', 'broker-account', ?, '2330', '台積電', 'stock', ?, '123', '賣出', ?, 'TWD', ?, ?, ?)`,
      )
      .bind(
        "sell-2330",
        "sell-source",
        "2026-09-10",
        40,
        6_000,
        "2026-09-10T00:00:00.000Z",
        "2026-09-10T00:00:00.000Z",
      )
      .run();

    const rows = await getInvestmentTransactionsRange(harness.binding, {
      from: "2026-09-01",
      to: "2026-10-01",
    });

    expect(rows).toEqual([
      expect.objectContaining({
        id: "sell-2330",
        amount: 6_000,
        realizedProfit: 2_000,
      }),
    ]);
  });
});
