import { describe, expect, it } from "vitest";
import {
  activityAmountTwd,
  activityCashAmountTwd,
  activityCashFlow,
  activityDisplayAmount,
  buildActivityCategorySlices,
} from "./chart";
import type { ActivityItem } from "./types";
import { allocateInvoiceCategories } from "@taiwan-fin-hub/core";

function item(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: "1",
    source: "bank",
    date: "2026-07-01",
    title: "交易",
    subtitle: "",
    amount: 0,
    currency: "TWD",
    category: "未分類",
    status: "posted",
    ...overrides,
  };
}

describe("activity category chart", () => {
  it("splits one invoice by item categories and leaves uncovered value uncategorized", () => {
    const parts = allocateInvoiceCategories(300, 270, [
      {
        id: "food",
        amount: 100,
        classification: { categoryId: "food", label: "餐飲" },
      },
      {
        id: "shopping",
        amount: 150,
        classification: {
          categoryId: "shopping",
          label: "購物",
          behavior: "excluded",
        },
      },
    ]);
    expect(parts.map(({ category, amount }) => [category, amount])).toEqual([
      ["餐飲", 90],
      ["購物", 135],
      ["未分類", 45],
    ]);
    const activity = item({
      source: "invoice",
      amount: 300,
      category: "多分類",
      categoryParts: parts,
    });
    expect(activityCashAmountTwd(activity, {})).toBe(-135);
    expect(
      buildActivityCategorySlices([activity], "expense", {}).map(
        ({ category, amount }) => [category, amount],
      ),
    ).toEqual([
      ["餐飲", 90],
      ["未分類", 45],
    ]);
  });

  it("does not treat allowance lines as a separate spending category", () => {
    const parts = allocateInvoiceCategories(180, 180, [
      {
        id: "item",
        amount: 200,
        lineType: "item",
        classification: { categoryId: "food", label: "餐飲" },
      },
      { id: "allowance", amount: 20, lineType: "allowance" },
    ]);
    expect(parts).toEqual([
      {
        itemId: "item",
        categoryId: "food",
        category: "餐飲",
        amount: 180,
        behavior: "normal",
      },
    ]);
  });
  it("converts zero foreign amounts without requiring an exchange rate", () => {
    expect(activityAmountTwd(item({ amount: 0, currency: "HKD" }), {})).toBe(0);
    expect(activityAmountTwd(item({ amount: -0, currency: "HKD" }), {})).toBe(
      0,
    );
  });

  it("keeps nonzero foreign amounts unavailable without an exchange rate", () => {
    for (const amount of [100, -100]) {
      expect(
        activityAmountTwd(item({ amount, currency: "HKD" }), {}),
      ).toBeUndefined();
    }
  });

  it("converts cash flow to TWD and keeps invoices as expenses", () => {
    expect(
      activityCashAmountTwd(item({ amount: 10, currency: "USD" }), { USD: 32 }),
    ).toBe(320);
    expect(
      activityCashAmountTwd(item({ source: "card", amount: -500 }), {}),
    ).toBe(-500);
    expect(
      activityCashAmountTwd(item({ source: "invoice", amount: 500 }), {}),
    ).toBe(-500);
    expect(activityCashFlow(item({ source: "invoice", amount: 500 }))).toBe(
      "expense",
    );
  });

  it("treats a positive card discount as income in display and totals", () => {
    const discount = item({
      source: "card",
      amount: 63,
      category: "購物",
      title: "信用卡消費折抵_樂購蝦皮－daniel0329",
    });

    expect(activityDisplayAmount(discount)).toBe(63);
    expect(activityCashAmountTwd(discount, {})).toBe(63);
    expect(activityCashFlow(discount)).toBe("income");
    expect(buildActivityCategorySlices([discount], "expense", {})).toEqual([]);
    expect(buildActivityCategorySlices([discount], "income", {})).toEqual([
      {
        category: "購物",
        amount: 63,
        percentage: 100,
        color: "#3e6f7c",
      },
    ]);
  });

  it("groups categories and sorts them by amount descending", () => {
    const slices = buildActivityCategorySlices(
      [
        item({ amount: -100, category: "餐飲" }),
        item({ id: "2", amount: -300, category: "交通" }),
        item({ id: "3", amount: -50, category: "餐飲" }),
        item({ id: "4", amount: 900, category: "薪資" }),
      ],
      "expense",
      {},
    );

    expect(
      slices.map(({ category, amount }) => ({ category, amount })),
    ).toEqual([
      { category: "交通", amount: 300 },
      { category: "餐飲", amount: 150 },
    ]);
    expect(slices[0]?.percentage).toBeCloseTo(66.67, 1);
  });

  it("keeps excluded categories selectable without counting their amount", () => {
    const excluded = item({ amount: -500, excludedFromCalculation: true });

    expect(activityCashAmountTwd(excluded, {})).toBe(0);
    expect(activityCashFlow(excluded)).toBe("expense");
    expect(buildActivityCategorySlices([excluded], "expense", {})).toEqual([
      {
        category: "未分類",
        amount: 0,
        percentage: 0,
        color: "#3e6f7c",
      },
    ]);
  });

  it("keeps investment principal out of cash-flow charts", () => {
    const transfer = item({
      amount: -10_000,
      cashFlowType: "asset_transfer",
      category: "投資",
    });

    expect(activityCashFlow(transfer)).toBeNull();
    expect(activityCashAmountTwd(transfer, {})).toBe(0);
    expect(buildActivityCategorySlices([transfer], "expense", {})).toEqual([]);
  });

  it("sorts zero-value excluded categories after counted categories", () => {
    const slices = buildActivityCategorySlices(
      [
        item({ amount: -500, category: "餐飲" }),
        item({
          id: "2",
          amount: -300,
          category: "未分類",
          excludedFromCalculation: true,
        }),
      ],
      "expense",
      {},
    );

    expect(
      slices.map(({ category, amount, percentage }) => ({
        category,
        amount,
        percentage,
      })),
    ).toEqual([
      { category: "餐飲", amount: 500, percentage: 100 },
      { category: "未分類", amount: 0, percentage: 0 },
    ]);
  });
});
