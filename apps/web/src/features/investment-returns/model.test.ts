import { describe, expect, it } from "vitest";
import type {
  InvestmentRow,
  InvestmentTransactionRow,
} from "@/data/investments/types";
import {
  calculateInvestmentReturns,
  classifyInvestmentTransaction,
} from "./model";

const identity = (amount: number) => amount;

function transaction(
  overrides: Partial<InvestmentTransactionRow>,
): InvestmentTransactionRow {
  return {
    id: overrides.id ?? "transaction",
    connectorId: overrides.connectorId ?? "tdcc",
    accountId: overrides.accountId ?? "account",
    sourceId: overrides.sourceId ?? "source",
    currency: overrides.currency ?? "TWD",
    ...overrides,
  };
}

function position(overrides: Partial<InvestmentRow>): InvestmentRow {
  return {
    id: overrides.id ?? "position",
    assetType: overrides.assetType ?? "stock",
    name: overrides.name ?? "標的",
    currency: overrides.currency ?? "TWD",
    asOfDate: overrides.asOfDate ?? "2026-09-26",
    ...overrides,
  };
}

describe("investment return model", () => {
  it("classifies buys, sales, redemptions, and income separately", () => {
    expect(
      classifyInvestmentTransaction(
        transaction({ transactionCode: "113", transactionName: "買　　進" }),
      ),
    ).toBe("buy");
    expect(
      classifyInvestmentTransaction(
        transaction({ transactionCode: "123", transactionName: "賣　　出" }),
      ),
    ).toBe("sell");
    expect(
      classifyInvestmentTransaction(
        transaction({ transactionName: "基金贖回" }),
      ),
    ).toBe("redemption");
    expect(
      classifyInvestmentTransaction(
        transaction({ transactionName: "現金股利" }),
      ),
    ).toBe("income");
    expect(
      classifyInvestmentTransaction(
        transaction({
          transactionCode: "113",
          transactionName: "買　　進",
          name: "元大高股息",
        }),
      ),
    ).toBe("buy");
  });

  it("calculates overall return from current value and complete cash flows", () => {
    const summary = calculateInvestmentReturns(
      [position({ marketValue: 800 })],
      [
        transaction({ id: "buy", transactionName: "買進", amount: -1_000 }),
        transaction({ id: "sell", transactionName: "賣出", amount: 200 }),
        transaction({ id: "income", transactionName: "股利", amount: 50 }),
      ],
      identity,
      { completeHistory: true },
    );

    expect(summary.investedAmount).toBe(1_000);
    expect(summary.returnedAmount).toBe(200);
    expect(summary.incomeAmount).toBe(50);
    expect(summary.overallReturn).toBe(50);
    expect(summary.overallReturnRate).toBe(5);
    expect(summary.overallBasis).toBe("cash-flow");
  });

  it("does not invent a return when a sell amount is missing", () => {
    const summary = calculateInvestmentReturns(
      [position({ marketValue: 1_100, costBasis: 1_000 })],
      [
        transaction({
          transactionName: "賣出",
          quantity: 10,
          amount: undefined,
        }),
      ],
      identity,
    );

    expect(summary.missingAmountCount).toBe(1);
    expect(summary.returnedAmount).toBe(0);
    expect(summary.overallBasis).toBe("positions");
    expect(summary.overallReturnRate).toBe(10);
  });

  it("only calculates holding gain from positions with both cost and value", () => {
    const summary = calculateInvestmentReturns(
      [
        position({ id: "known", marketValue: 1_100, costBasis: 1_000 }),
        position({ id: "unknown", marketValue: 5_000 }),
      ],
      [],
      identity,
    );
    expect(summary.currentValue).toBe(6_100);
    expect(summary.knownMarketValue).toBe(1_100);
    expect(summary.unrealizedReturn).toBe(100);
    expect(summary.overallReturnRate).toBe(10);
  });

  it("does not call a 12-month transaction window a complete lifetime return", () => {
    const summary = calculateInvestmentReturns(
      [position({ marketValue: 800, costBasis: 700 })],
      [transaction({ transactionName: "買進", amount: 1_000 })],
      identity,
    );
    expect(summary.overallBasis).toBe("positions");
    expect(summary.overallReturnRate).toBeCloseTo((100 / 700) * 100);
  });
});
