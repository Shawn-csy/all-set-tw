import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../../src/platform/env";
import { createManualAsset } from "../../../src/features/manual-assets/repository";
import { getFinancialContext } from "../../../src/features/ai-financial-context/service";
import { aiFinancialContextRoutes } from "../../../src/features/ai-financial-context/route";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

describe("AI financial context export", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;

  beforeAll(async () => {
    harness = await createTestD1();
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  beforeEach(async () => {
    await harness.binding.batch([
      harness.binding.prepare("DELETE FROM classification_overrides"),
      harness.binding.prepare("DELETE FROM bank_transactions"),
      harness.binding.prepare("DELETE FROM bank_balance_snapshots"),
      harness.binding.prepare("DELETE FROM bank_accounts"),
      harness.binding.prepare(
        "DELETE FROM investment_transaction_amount_overrides",
      ),
      harness.binding.prepare("DELETE FROM investment_transactions"),
      harness.binding.prepare("DELETE FROM investment_position_cost_overrides"),
      harness.binding.prepare("DELETE FROM investment_positions"),
      harness.binding.prepare(
        "DELETE FROM net_worth_history WHERE source = 'manual'",
      ),
      harness.binding.prepare("DELETE FROM manual_assets"),
      harness.binding.prepare("DELETE FROM exchange_rates"),
    ]);
  });

  it("combines current wealth, spending, holdings, and decision signals without secrets", async () => {
    const db = harness.binding;
    await db.batch([
      db
        .prepare(
          `INSERT INTO bank_accounts
            (id, connector_id, source_id, institution_name, account_name, account_type,
             currency, account_last4, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "checking",
          "test",
          "bank:test:1234",
          "測試銀行",
          "日常帳戶",
          "checking",
          "TWD",
          "1234",
          "2026-09-01",
          "2026-09-30",
        ),
      db
        .prepare(
          `INSERT INTO bank_accounts
            (id, connector_id, source_id, institution_name, account_name, account_type,
             currency, account_last4, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "credit",
          "test",
          "card:test:5678",
          "測試銀行",
          "信用卡",
          "credit",
          "TWD",
          "5678",
          "2026-09-01",
          "2026-09-30",
        ),
      db
        .prepare(
          `INSERT INTO bank_balance_snapshots
            (id, connector_id, account_id, source_id, balance, currency, as_of_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "checking-balance",
          "test",
          "checking",
          "balance:checking",
          10000,
          "TWD",
          "2026-09-30T00:00:00.000Z",
          "2026-09-30",
          "2026-09-30",
        ),
      db
        .prepare(
          `INSERT INTO bank_balance_snapshots
            (id, connector_id, account_id, source_id, balance, currency, as_of_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "credit-balance",
          "test",
          "credit",
          "balance:credit",
          1000,
          "TWD",
          "2026-09-30T00:00:00.000Z",
          "2026-09-30",
          "2026-09-30",
        ),
      db
        .prepare(
          `INSERT INTO bank_transactions
            (id, connector_id, account_id, source_id, posted_date, authorized_at, amount,
             currency, description, counterparty, raw_payload, created_at, updated_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "lunch",
          "test",
          "credit",
          "transaction:lunch",
          "2026-09-15",
          "2026-09-15",
          -300,
          "TWD",
          "午餐",
          "餐廳",
          '{"cardNumber":"secret"}',
          "2026-09-15",
          "2026-09-15",
          "posted",
        ),
      db
        .prepare(
          `INSERT INTO investment_positions
            (id, connector_id, source_id, asset_type, symbol, name, quantity, market_value,
             currency, as_of_date, raw_payload, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "position-0050",
          "tdcc",
          "holding:0050:2026-09-30",
          "etf",
          "0050",
          "元大台灣50",
          10,
          1000,
          "TWD",
          "2026-09-30",
          '{"account":"secret"}',
          "2026-09-30",
          "2026-09-30",
        ),
      db
        .prepare(
          `INSERT INTO investment_position_cost_overrides
            (id, connector_id, holding_key, cost_per_share, currency, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "cost-0050",
          "tdcc",
          "holding:0050",
          80,
          "TWD",
          "2026-09-30",
          "2026-09-30",
        ),
      db
        .prepare(
          `INSERT INTO investment_transactions
            (id, connector_id, account_id, source_id, symbol, name, asset_type,
             trade_date, transaction_code, transaction_name, quantity, price, amount,
             currency, raw_payload, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "trade-0050",
          "tdcc",
          "broker-secret",
          "trade:0050",
          "0050",
          "元大台灣50",
          "etf",
          "2026-09-10",
          "BUY",
          "買進",
          10,
          80,
          800,
          "TWD",
          '{"brokerAccount":"secret"}',
          "2026-09-10",
          "2026-09-10",
        ),
      db
        .prepare(
          "INSERT INTO exchange_rates (currency, rate_to_twd, updated_at) VALUES (?, ?, ?)",
        )
        .bind("USD", 32, "2026-09-30T00:00:00.000Z"),
    ]);
    await createManualAsset(db, {
      id: "manual:home",
      name: "房屋",
      category: "real_estate",
      note: "自住",
      currency: "TWD",
      value: 5000,
      date: "2026-09-30",
      now: "2026-09-30T00:00:00.000Z",
    });
    await createManualAsset(db, {
      id: "manual:aapl",
      name: "Apple",
      category: "us_stock",
      note: "長期持有",
      symbol: "AAPL",
      quantity: 2,
      costPerShare: 200,
      currency: "USD",
      value: 500,
      date: "2026-09-30",
      now: "2026-09-30T00:00:00.000Z",
    });

    const result = await getFinancialContext(
      db,
      { from: "2026-09-01", to: "2026-09-30" },
      "2026-09-30T12:00:00.000Z",
    );

    expect(result.schema).toBe("taiwan-fin-hub.ai-financial-context");
    expect(result.summary.netWorthEstimateTwd).toBe(31_000);
    expect(result.spending.byMonth).toContainEqual(
      expect.objectContaining({ month: "2026-09", expenses: 300 }),
    );
    expect(result.investments.holdings).toHaveLength(2);
    expect(result.investments.holdings).toContainEqual(
      expect.objectContaining({
        symbol: "0050",
        marketValue: 1000,
        costBasis: 800,
        unrealizedPnl: 200,
      }),
    );
    expect(result.investments.decisionSignals.observations).toContainEqual(
      expect.objectContaining({ decision: "buy", confidence: "high" }),
    );
    expect(result.investments.decisionSignals.manualNotes).toContainEqual(
      expect.objectContaining({ symbol: "AAPL", note: "長期持有" }),
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret");
    expect(result.dataQuality.omittedSensitiveFields).toContain(
      "銀行帳號完整號碼、sourceId、connectorId",
    );
  });

  it("serves a downloadable JSON response and validates date ranges", async () => {
    const valid = await aiFinancialContextRoutes.request(
      "/ai/financial-context?from=2026-09-01&to=2026-09-30",
      {},
      { DB: harness.binding } as Env,
    );
    expect(valid.status).toBe(200);
    expect(valid.headers.get("content-disposition")).toContain(
      "taiwan-fin-hub-ai-context-2026-09-30.json",
    );
    await expect(valid.json()).resolves.toMatchObject({
      schema: "taiwan-fin-hub.ai-financial-context",
      period: { from: "2026-09-01", to: "2026-09-30" },
    });

    const invalid = await aiFinancialContextRoutes.request(
      "/ai/financial-context?from=2026-09-01",
      {},
      { DB: harness.binding } as Env,
    );
    expect(invalid.status).toBe(400);
  });
});
