import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addManualInvestmentHolding,
  getManualInvestmentHoldings,
} from "../../../src/features/manual-assets/service";
import {
  getInvestmentPage,
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
});
