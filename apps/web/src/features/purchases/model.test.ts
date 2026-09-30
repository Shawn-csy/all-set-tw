import { describe, expect, it } from "vitest";
import {
  aggregatePurchaseAdjustments,
  aggregatePurchaseCategories,
  aggregatePurchaseItems,
  flattenPurchaseLines,
  purchaseLineDisplayAmount,
  purchaseLineKind,
  reconcileInvoice,
} from "./model";

describe("purchase line presentation", () => {
  it("turns legacy negative item rows into positive allowances", () => {
    const line = {
      id: "discount",
      sourceId: "discount",
      lineNumber: 2,
      description: "點數折抵",
      amount: -206,
      lineType: "item" as const,
    };

    expect(purchaseLineKind(line)).toBe("allowance");
    expect(purchaseLineDisplayAmount(line)).toBe(206);
  });

  it("keeps positive purchased item amounts positive", () => {
    const line = {
      id: "item",
      sourceId: "item",
      lineNumber: 1,
      description: "商品",
      amount: 500,
      lineType: "item" as const,
    };

    expect(purchaseLineKind(line)).toBe("item");
    expect(purchaseLineDisplayAmount(line)).toBe(500);
  });

  it("aggregates the same item across invoices without grouping by merchant", () => {
    const invoices = [
      {
        id: "invoice-1",
        connectorId: "einvoice" as const,
        sourceId: "invoice-1",
        invoiceDate: "2026-09-01T00:00:00.000Z",
        amount: 100,
        items: [
          {
            id: "line-1",
            sourceId: "1",
            lineNumber: 1,
            description: "鮮奶  ",
            quantity: 2,
            amount: 60,
            lineType: "item" as const,
          },
          {
            id: "line-metadata",
            sourceId: "metadata",
            lineNumber: 2,
            description: "付款:網信用卡",
            quantity: 1,
            amount: 0,
            lineType: "item" as const,
          },
        ],
        sellerName: "商店 A",
      },
      {
        id: "invoice-2",
        connectorId: "einvoice" as const,
        sourceId: "invoice-2",
        invoiceDate: "2026-09-12T00:00:00.000Z",
        amount: 50,
        items: [
          {
            id: "line-2",
            sourceId: "2",
            lineNumber: 1,
            description: "鮮奶",
            quantity: 1,
            amount: 30,
            lineType: "item" as const,
          },
        ],
        sellerName: "商店 B",
      },
    ];

    expect(
      aggregatePurchaseItems(flattenPurchaseLines(invoices)),
    ).toMatchObject([
      {
        key: "鮮奶",
        description: "鮮奶",
        lineCount: 2,
        invoiceCount: 2,
        quantity: 3,
        amount: 90,
        averageUnitPrice: 30,
        lastPurchasedAt: "2026-09-12T00:00:00.000Z",
        merchants: ["商店 A", "商店 B"],
      },
    ]);
  });

  it("keeps allowances out of item totals and summarizes them separately", () => {
    const invoice = {
      id: "invoice-1",
      connectorId: "einvoice" as const,
      sourceId: "invoice-1",
      invoiceDate: "2026-09-01T00:00:00.000Z",
      amount: 80,
      items: [
        {
          id: "line-1",
          sourceId: "1",
          lineNumber: 1,
          description: "麵包",
          quantity: 1,
          amount: 100,
          lineType: "item" as const,
        },
        {
          id: "line-2",
          sourceId: "2",
          lineNumber: 2,
          description: "紅利金/點數兌換",
          quantity: 1,
          amount: -20,
          lineType: "allowance" as const,
        },
      ],
    };
    const lines = flattenPurchaseLines([invoice]);

    expect(aggregatePurchaseItems(lines).map((item) => item.amount)).toEqual([
      100,
    ]);
    expect(aggregatePurchaseAdjustments(lines)).toMatchObject([
      {
        description: "紅利金/點數兌換",
        kind: "allowance",
        count: 1,
        amount: 20,
      },
    ]);
  });

  it("groups items by their classified category while keeping item details", () => {
    const invoice = {
      id: "invoice-1",
      connectorId: "einvoice" as const,
      sourceId: "invoice-1",
      invoiceDate: "2026-09-01T00:00:00.000Z",
      amount: 180,
      items: [
        {
          id: "line-1",
          sourceId: "1",
          lineNumber: 1,
          description: "鮮奶",
          quantity: 2,
          amount: 60,
          lineType: "item" as const,
          classification: {
            categoryId: "food",
            label: "餐飲",
            behavior: "normal" as const,
            source: "user_rule" as const,
          },
        },
        {
          id: "line-2",
          sourceId: "2",
          lineNumber: 2,
          description: "耳機",
          quantity: 1,
          amount: 120,
          lineType: "item" as const,
          classification: {
            categoryId: "shopping",
            label: "購物",
            behavior: "normal" as const,
            source: "user_rule" as const,
          },
        },
      ],
    };

    expect(
      aggregatePurchaseCategories(flattenPurchaseLines([invoice])),
    ).toMatchObject([
      {
        id: "shopping",
        label: "購物",
        amount: 120,
        itemCount: 1,
        items: [{ description: "耳機" }],
      },
      {
        id: "food",
        label: "餐飲",
        amount: 60,
        itemCount: 1,
        items: [{ description: "鮮奶" }],
      },
    ]);
  });

  it("reports when invoice line totals do not match the invoice amount", () => {
    const invoice = {
      id: "invoice-1",
      connectorId: "einvoice" as const,
      sourceId: "invoice-1",
      invoiceDate: "2026-09-01T00:00:00.000Z",
      amount: 35,
      items: [
        {
          id: "line-1",
          sourceId: "1",
          lineNumber: 1,
          description: "商品",
          amount: 65,
          lineType: "item" as const,
        },
        {
          id: "line-2",
          sourceId: "2",
          lineNumber: 2,
          description: "折讓",
          amount: -14,
          lineType: "allowance" as const,
        },
      ],
    };

    expect(reconcileInvoice(invoice)).toMatchObject({
      lineTotal: 51,
      rawLineTotal: 51,
      invoiceTotal: 35,
      redeemedAmount: 0,
      delta: 16,
    });
  });

  it("treats a uniquely reconciling positive line as a redeemed item", () => {
    const invoice = {
      id: "invoice-1",
      connectorId: "einvoice" as const,
      sourceId: "invoice-1",
      invoiceDate: "2026-09-28T00:00:00.000Z",
      amount: 35,
      items: [
        {
          id: "meal",
          sourceId: "1",
          lineNumber: 1,
          description: "飯糰",
          quantity: 1,
          amount: 49,
          lineType: "item" as const,
        },
        {
          id: "redeemed",
          sourceId: "2",
          lineNumber: 2,
          description: "大冰特濃經典拿鐵",
          quantity: 1,
          unitPrice: 65,
          amount: 65,
          lineType: "item" as const,
        },
        {
          id: "allowance",
          sourceId: "3",
          lineNumber: 3,
          description: "友善食光折扣",
          quantity: 1,
          amount: -14,
          lineType: "allowance" as const,
        },
      ],
    };
    const lines = flattenPurchaseLines([invoice]);

    expect(
      lines.find((row) => row.line.description === "大冰特濃經典拿鐵"),
    ).toMatchObject({
      displayAmount: 0,
      originalAmount: 65,
      settlement: "redeemed",
    });
    expect(aggregatePurchaseItems(lines)).toMatchObject([
      {
        description: "飯糰",
        amount: 49,
      },
      {
        description: "大冰特濃經典拿鐵",
        amount: 0,
        originalAmount: 65,
        redeemedCount: 1,
      },
    ]);
  });

  it("prefers the largest paid-item subset when a redemption has an ambiguous sum", () => {
    const invoice = {
      id: "invoice-july",
      connectorId: "einvoice" as const,
      sourceId: "invoice-july",
      invoiceDate: "2026-07-10T02:13:23.000Z",
      amount: 49,
      items: [
        {
          id: "redeemed",
          sourceId: "1",
          lineNumber: 1,
          description: "大冰特濃經典拿鐵",
          quantity: 1,
          unitPrice: 65,
          amount: 65,
          lineType: "item" as const,
        },
        {
          id: "tea",
          sourceId: "2",
          lineNumber: 2,
          description: "立頓原味奶茶",
          quantity: 1,
          amount: 30,
          lineType: "item" as const,
        },
        {
          id: "sandwich",
          sourceId: "3",
          lineNumber: 3,
          description: "榛果摩卡脆脆三明治",
          quantity: 1,
          amount: 35,
          lineType: "item" as const,
        },
        {
          id: "allowance",
          sourceId: "4",
          lineNumber: 4,
          description: "鮮食促",
          quantity: 1,
          amount: -16,
          lineType: "allowance" as const,
        },
      ],
    };
    const lines = flattenPurchaseLines([invoice]);

    expect(
      lines.find((row) => row.line.description === "大冰特濃經典拿鐵"),
    ).toMatchObject({
      displayAmount: 0,
      settlement: "redeemed",
    });
    expect(
      lines
        .filter((row) => row.kind === "item")
        .map((row) => row.displayAmount),
    ).toEqual([0, 30, 35]);
    expect(reconcileInvoice(invoice).delta).toBe(0);
  });
});
