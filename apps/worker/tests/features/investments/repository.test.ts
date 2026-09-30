import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestD1 } from "../../../../../packages/db/testing/d1";
import * as repository from "../../../src/features/investments/repository";

const now = "2026-09-12T00:00:00.000Z";

describe("investment repository", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  beforeAll(async () => {
    harness = await createTestD1();
  }, 60_000);
  afterAll(async () => {
    await harness?.mf.dispose();
  });
  beforeEach(async () => {
    await harness.binding.batch([
      harness.binding.prepare("DELETE FROM investment_transactions"),
      harness.binding.prepare(
        "DELETE FROM investment_transaction_amount_overrides",
      ),
      harness.binding.prepare("DELETE FROM investment_positions"),
      harness.binding.prepare("DELETE FROM investment_position_cost_overrides"),
    ]);
  });

  async function position(input: {
    id: string;
    connectorId?: string;
    sourceId: string;
    assetType: "stock" | "etf" | "fund";
    name: string;
    asOfDate: string;
  }) {
    await harness.binding
      .prepare(
        `INSERT INTO investment_positions (
          id, connector_id, source_id, asset_type, name, currency,
          as_of_date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'TWD', ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.connectorId ?? "tdcc",
        input.sourceId,
        input.assetType,
        input.name,
        input.asOfDate,
        now,
        now,
      )
      .run();
  }

  async function trade(input: {
    id: string;
    sourceId: string;
    tradeDate?: string | null;
    postedDate?: string | null;
    updatedAt?: string;
    name?: string;
    amount?: number | null;
  }) {
    await harness.binding
      .prepare(
        `INSERT INTO investment_transactions (
          id, connector_id, account_id, source_id, name, currency, amount,
          trade_date, posted_date, created_at, updated_at
        ) VALUES (?, 'tdcc', 'broker', ?, ?, 'TWD', ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.sourceId,
        input.name ?? input.id,
        input.amount ?? null,
        input.tradeDate ?? null,
        input.postedDate ?? null,
        now,
        input.updatedAt ?? now,
      )
      .run();
  }

  it("lists the latest position per connector and asset type with keyset pagination", async () => {
    const db = harness.binding;
    await position({
      id: "old-stock",
      sourceId: "2330-old",
      assetType: "stock",
      name: "台積電",
      asOfDate: "2026-08-01",
    });
    await position({
      id: "new-stock-b",
      sourceId: "2330-b",
      assetType: "stock",
      name: "台積電B",
      asOfDate: "2026-09-01",
    });
    await position({
      id: "new-stock-a",
      sourceId: "2330-a",
      assetType: "stock",
      name: "台積電A",
      asOfDate: "2026-09-01",
    });
    await position({
      id: "fund",
      connectorId: "manual",
      sourceId: "fund-1",
      assetType: "fund",
      name: "現金",
      asOfDate: "2026-07-01",
    });
    const first = await repository.listLatestInvestmentPositions(db, 2);
    expect(first.map((row) => row.id)).toEqual(["new-stock-a", "new-stock-b"]);
    const next = await repository.listLatestInvestmentPositions(db, 2, {
      asOfDate: first[1].asOfDate,
      assetType: first[1].assetType,
      name: first[1].name,
      id: first[1].id,
    });
    expect(next.map((row) => row.id)).toEqual(["fund"]);
    expect(next.some((row) => row.id === "old-stock")).toBe(false);
  });

  it("pages transactions by effective_date and filters TEXT date ranges", async () => {
    const db = harness.binding;
    await trade({
      id: "aug",
      sourceId: "aug",
      tradeDate: "2026-08-31",
    });
    await trade({
      id: "sep-old",
      sourceId: "sep-old",
      postedDate: "2026-09-01",
      updatedAt: "2026-09-01T01:00:00.000Z",
    });
    await trade({
      id: "sep-new",
      sourceId: "sep-new",
      tradeDate: "2026-09-01",
      updatedAt: "2026-09-01T02:00:00.000Z",
    });
    const first = await repository.listInvestmentTransactions(db, 2);
    expect(first.map((row) => row.id)).toEqual(["sep-new", "sep-old"]);
    const next = await repository.listInvestmentTransactions(db, 2, {
      effectiveDate: first[1].effectiveDate,
      updatedAt: first[1].updatedAt,
      id: first[1].id,
    });
    expect(next.map((row) => row.id)).toEqual(["aug"]);
    const range = { from: "2026-09-01", to: "2026-10-01" };
    expect(
      (await repository.listInvestmentTransactionsInRange(db, range)).map(
        (row) => row.id,
      ),
    ).toEqual(["sep-new", "sep-old"]);
    expect(
      (
        await repository.listInvestmentTransactionsInRange(db, range, [
          "2026-09-01",
        ])
      ).map((row) => row.id),
    ).toEqual(["sep-new", "sep-old"]);
  });

  it("keeps a cost override across TDCC snapshot dates for the same broker holding", async () => {
    const db = harness.binding;
    await db
      .prepare(
        `INSERT INTO investment_positions
          (id, connector_id, source_id, asset_type, symbol, name, quantity, market_value,
           currency, as_of_date, created_at, updated_at)
         VALUES (?, 'tdcc', ?, 'etf', '0050', '元大台灣50', ?, ?, 'TWD', ?, ?, ?)`,
      )
      .bind(
        "first",
        "9627:0241272:0050:2026-09-12",
        906,
        100_000,
        "2026-09-12",
        now,
        now,
      )
      .run();
    await repository.upsertInvestmentPositionCost(db, {
      connectorId: "tdcc",
      holdingKey: "9627:0241272:0050",
      costPerShare: 66.94,
      currency: "TWD",
    });
    await db
      .prepare(
        `INSERT INTO investment_positions
          (id, connector_id, source_id, asset_type, symbol, name, quantity, market_value,
           currency, as_of_date, created_at, updated_at)
         VALUES (?, 'tdcc', ?, 'etf', '0050', '元大台灣50', ?, ?, 'TWD', ?, ?, ?)`,
      )
      .bind(
        "next",
        "9627:0241272:0050:2026-09-13",
        900,
        101_000,
        "2026-09-13",
        now,
        now,
      )
      .run();
    const latest = await repository.listLatestInvestmentPositions(db, 10);
    expect(latest).toEqual([
      expect.objectContaining({
        id: "next",
        quantity: 900,
        costPerShare: 66.94,
      }),
    ]);
  });

  it("keeps a manual transaction amount separate from the synced amount", async () => {
    const db = harness.binding;
    await trade({
      id: "missing-amount",
      sourceId: "missing-amount",
      tradeDate: "2026-09-12",
    });

    expect(
      await repository.listInvestmentTransactionsInRange(db, {
        from: "2026-09-01",
        to: "2026-10-01",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "missing-amount",
        amount: null,
        rawAmount: null,
        amountSource: "missing",
      }),
    ]);

    await expect(
      repository.upsertInvestmentTransactionAmount(db, {
        transactionId: "missing-amount",
        amount: 123_456,
      }),
    ).resolves.toBe(true);
    expect(
      await repository.listInvestmentTransactionsInRange(db, {
        from: "2026-09-01",
        to: "2026-10-01",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "missing-amount",
        amount: 123_456,
        rawAmount: null,
        amountSource: "manual",
      }),
    ]);

    await expect(
      repository.deleteInvestmentTransactionAmount(db, "missing-amount"),
    ).resolves.toBe(true);

    await expect(
      repository.upsertInvestmentTransactionAmount(db, {
        transactionId: "missing-amount",
        amount: 123_000,
        source: "historical-close",
        referencePrice: 123,
        priceDate: "2026-09-12",
        provider: "twse-close",
      }),
    ).resolves.toBe(true);
    expect(
      await repository.listInvestmentTransactionsInRange(db, {
        from: "2026-09-01",
        to: "2026-10-01",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "missing-amount",
        amount: 123_000,
        rawAmount: null,
        amountSource: "historical-close",
        amountReferencePrice: 123,
        amountPriceDate: "2026-09-12",
        amountProvider: "twse-close",
      }),
    ]);
  });
});
