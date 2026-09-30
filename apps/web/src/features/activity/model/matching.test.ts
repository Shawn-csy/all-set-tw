import { describe, expect, it } from "vitest";
import {
  deduplicateBankTransactions,
  invoicePaymentMatchKey,
  invoiceTransactionCandidates,
  matchInvoicesToTransactions,
} from "@/data/activity/matching";
import { buildActivityItems } from "@taiwan-fin-hub/core";
import type { BankTransactionRow } from "@/data/bank/types";
import type { InvoiceSummaryRow } from "@/data/invoices/types";

function transaction(
  overrides: Partial<BankTransactionRow> = {},
): BankTransactionRow {
  return {
    id: "transaction-1",
    connectorId: "sinopac",
    accountId: "card-1",
    sourceId: "source-1",
    postedDate: "2026-07-10",
    authorizedAt: "2026-07-10T12:00:00.000Z",
    amount: -860,
    currency: "TWD",
    description: "信用卡消費",
    counterparty: "好食餐飲",
    status: "posted",
    excludedFromCalculation: false,
    ...overrides,
  };
}

function invoice(
  overrides: Partial<InvoiceSummaryRow> = {},
): InvoiceSummaryRow {
  return {
    id: "invoice-1",
    connectorId: "einvoice",
    sourceId: "invoice-source-1",
    invoiceDate: "2026-07-10",
    invoiceNumber: "AB12345678",
    sellerName: "好食餐飲有限公司",
    amount: 860,
    ...overrides,
  };
}

describe("invoice transaction matching", () => {
  it("does not confuse a credit-card bill settlement with a purchase", () => {
    const settlement = transaction({
      id: "card-bill",
      accountId: "bank-1",
      accountType: "deposit",
      description: "繳富邦信用卡款",
      counterparty: undefined,
    });
    const target = invoice();
    const result = matchInvoicesToTransactions([settlement], [target]);
    expect(result.invoiceToTransactionId.size).toBe(0);
    expect(invoiceTransactionCandidates([settlement], target)).toEqual([]);
    expect(
      matchInvoicesToTransactions(
        [settlement],
        [target],
        [
          {
            invoiceId: target.id,
            transactionId: settlement.id,
            decision: "linked",
          },
        ],
      ).invoiceToTransactionId.size,
    ).toBe(0);
  });

  it("does not use excluded or transfer rows as invoice payments", () => {
    const transfer = transaction({
      id: "bank-transfer",
      description: "銀行扣款",
      counterparty: undefined,
      classification: {
        categoryId: "transfer",
        label: "轉帳",
        behavior: "asset_transfer",
        source: "user_rule",
      },
    });
    expect(
      matchInvoicesToTransactions([transfer], [invoice()])
        .invoiceToTransactionId.size,
    ).toBe(0);
  });

  it("counts investment cash flow while keeping withdrawals and transfers excluded", () => {
    const investment = transaction({
      id: "investment-cash",
      accountId: "bank-1",
      accountType: "deposit",
      amount: -1000,
      description: "證券交割款",
      counterparty: undefined,
      excludedFromCalculation: true,
      classification: {
        categoryId: "investment",
        label: "投資",
        behavior: "asset_transfer",
        source: "system_rule",
      },
    });
    const withdrawal = transaction({
      id: "cash-withdrawal",
      accountId: "bank-1",
      accountType: "deposit",
      amount: -500,
      description: "ATM提款",
      counterparty: undefined,
      classification: {
        categoryId: "cash-withdrawal",
        label: "提領現金",
        behavior: "cash_withdrawal",
        source: "system_rule",
      },
    });
    const transfer = transaction({
      id: "asset-transfer",
      accountId: "bank-1",
      accountType: "deposit",
      amount: -800,
      description: "銀行轉帳",
      counterparty: undefined,
      classification: {
        categoryId: "transfer",
        label: "轉帳",
        behavior: "asset_transfer",
        source: "system_rule",
      },
    });
    const items = buildActivityItems(
      [investment, withdrawal, transfer],
      [],
      [],
      new Map(),
      matchInvoicesToTransactions([investment, withdrawal, transfer], []),
    );

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transactionId: "investment-cash",
          cashFlowType: "investment_expense",
          excludedFromCalculation: false,
        }),
        expect.objectContaining({
          transactionId: "cash-withdrawal",
          cashFlowType: "asset_transfer",
          excludedFromCalculation: true,
        }),
        expect.objectContaining({
          transactionId: "asset-transfer",
          cashFlowType: "asset_transfer",
          excludedFromCalculation: true,
        }),
      ]),
    );
  });

  it("matches the same day and amount without checking the merchant", () => {
    const result = matchInvoicesToTransactions(
      [transaction({ counterparty: "完全不同的商家" })],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe(
      "transaction-1",
    );
    expect(result.transactionToInvoice.get("transaction-1")?.id).toBe(
      "invoice-1",
    );
  });

  it("matches a positive pending credit-card expense by absolute amount", () => {
    const result = matchInvoicesToTransactions(
      [transaction({ accountType: "credit", amount: 860 })],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe(
      "transaction-1",
    );
  });

  it("does not auto-match a payment with a different amount", () => {
    const result = matchInvoicesToTransactions(
      [
        transaction({
          accountType: "credit",
          amount: -125,
          description: "連支×楓康超市",
        }),
      ],
      [invoice({ amount: 168 })],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
  });

  it("reuses the card learned from an earlier invoice on the same day", () => {
    const result = matchInvoicesToTransactions(
      [
        transaction({
          id: "spotify-card",
          accountId: "card-spotify",
          postedDate: "2026-07-10",
          authorizedAt: undefined,
          amount: -298,
          counterparty: "SPOTIFY AB",
        }),
        transaction({
          id: "other-card",
          accountId: "card-other",
          postedDate: "2026-07-10",
          authorizedAt: undefined,
          amount: -298,
          counterparty: "其他服務",
        }),
      ],
      [
        invoice({
          id: "spotify-next",
          invoiceDate: "2026-07-10",
          sellerName: "Spotify AB",
          amount: 298,
        }),
      ],
      [],
      [
        {
          matchKey: "spotifyab",
          accountId: "card-spotify",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    );

    expect(result.invoiceToTransactionId.get("spotify-next")).toBe(
      "spotify-card",
    );
    expect(result.learnedAccountByInvoice.get("spotify-next")).toBe(
      "card-spotify",
    );
  });

  it("keeps an explicitly selected card on the invoice and never auto-links another card", () => {
    const target = invoice({
      id: "spotify",
      sellerName: "Spotify AB",
      amount: 298,
    });
    const otherCard = transaction({
      id: "other-card",
      accountId: "card-other",
      amount: -298,
    });
    const matches = matchInvoicesToTransactions(
      [otherCard],
      [target],
      [],
      [{ matchKey: "spotifyab", accountId: "card-old" }],
      [{ invoiceId: target.id, accountId: "card-selected" }],
    );

    expect(matches.invoiceToTransactionId.size).toBe(0);
    expect(matches.learnedAccountByInvoice.get(target.id)).toBe(
      "card-selected",
    );
    const items = buildActivityItems(
      [otherCard],
      [target],
      [],
      new Map([
        [
          "card-selected",
          {
            id: "card-selected",
            accountType: "credit",
            institutionName: "國泰世華",
            accountLast4: "1234",
          },
        ],
      ]),
      matches,
    );
    expect(
      items.find(
        (item) => item.invoiceId === target.id && item.source === "invoice",
      ),
    ).toMatchObject({
      invoicePaymentMethod: "card",
      invoicePaymentAccountId: "card-selected",
      invoicePaymentAccountSource: "selected",
      institutionName: "國泰世華",
    });
  });

  it("does not infer a card for an invoice marked as cash", () => {
    const target = invoice({ sellerName: "Spotify AB", amount: 298 });
    const matches = matchInvoicesToTransactions(
      [],
      [target],
      [{ invoiceId: target.id, transactionId: null, decision: "cash" }],
      [{ matchKey: "spotifyab", accountId: "card-1" }],
    );
    expect(matches.learnedAccountByInvoice.has(target.id)).toBe(false);
    expect(
      buildActivityItems([], [target], [], new Map(), matches)[0],
    ).toMatchObject({ invoicePaymentMethod: "cash" });
  });

  it("learns identical item content without assigning another item from the same merchant", () => {
    const matchKey = invoicePaymentMatchKey("蝦皮", ["服務費", "音樂訂閱"]);
    const matches = matchInvoicesToTransactions(
      [],
      [
        invoice({ id: "same", sellerName: "蝦皮", paymentMatchKey: matchKey }),
        invoice({
          id: "other",
          sellerName: "蝦皮",
          paymentMatchKey: invoicePaymentMatchKey("蝦皮", ["生活用品"]),
        }),
      ],
      [],
      [{ matchKey, accountId: "card-1" }],
    );
    expect(matches.learnedAccountByInvoice.get("same")).toBe("card-1");
    expect(matches.learnedAccountByInvoice.has("other")).toBe(false);
  });

  it("shows item-level categories on an unmatched invoice, then keeps them after a card match", () => {
    const target = invoice({
      id: "mixed-invoice",
      amount: 300,
      items: [
        {
          id: "food",
          sourceId: "food",
          lineNumber: 1,
          description: "便當",
          amount: 100,
          classification: {
            categoryId: "food",
            label: "餐飲",
            behavior: "normal",
            source: "override",
          },
        },
        {
          id: "shopping",
          sourceId: "shopping",
          lineNumber: 2,
          description: "用品",
          amount: 200,
          classification: {
            categoryId: "shopping",
            label: "購物",
            behavior: "normal",
            source: "override",
          },
        },
      ],
    });
    const standalone = buildActivityItems(
      [],
      [target],
      [],
      new Map(),
      matchInvoicesToTransactions([], [target]),
    );
    expect(standalone[0]).toMatchObject({
      category: "多分類",
      categoryId: "mixed",
      categoryParts: [
        expect.objectContaining({ category: "餐飲", amount: 100 }),
        expect.objectContaining({ category: "購物", amount: 200 }),
      ],
    });
    const card = transaction({
      id: "card-mixed",
      accountType: "credit",
      amount: -270,
      classification: {
        categoryId: "transfer",
        label: "轉帳",
        behavior: "asset_transfer",
        source: "user_rule",
      },
    });
    const linked = buildActivityItems(
      [card],
      [target],
      [],
      new Map(),
      matchInvoicesToTransactions(
        [card],
        [target],
        [{ invoiceId: target.id, transactionId: card.id, decision: "linked" }],
      ),
    );
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({
      source: "card",
      category: "多分類",
      categoryParts: [
        expect.objectContaining({ category: "餐飲", amount: 90 }),
        expect.objectContaining({ category: "購物", amount: 180 }),
      ],
    });
    expect(linked[0]?.cashFlowType).toBeUndefined();
    expect(linked[0]?.excludedFromCalculation).toBe(false);
  });

  it("still offers same-day expenses with different amounts for manual mapping", () => {
    const transactions = [
      transaction({
        id: "pxpay-tea",
        accountType: "credit",
        postedDate: "2026-07-06T00:00:00.000Z",
        authorizedAt: undefined,
        amount: 37,
        description: "全支付﹘樂法 台中漢口店",
        counterparty: "全支付﹘樂法 台中漢口店",
      }),
      transaction({
        id: "linepay-dinner",
        accountType: "credit",
        postedDate: "2026-07-06",
        authorizedAt: undefined,
        amount: -265,
        description: "連支＊萬川雞飯．肉骨茶",
        counterparty: "連支＊萬川雞飯．肉骨茶",
      }),
    ];
    const targetInvoice = invoice({
      invoiceDate: "2026-07-06T04:39:18.000Z",
      sellerName: "菲尖極道商行",
      amount: 50,
    });
    const result = matchInvoicesToTransactions(transactions, [targetInvoice]);

    expect(result.invoiceToTransactionId.size).toBe(0);
    expect(
      invoiceTransactionCandidates(transactions, targetInvoice).map(
        ({ id }) => id,
      ),
    ).toEqual(["pxpay-tea", "linepay-dinner"]);
  });

  it("applies manual links before automatic matching", () => {
    const result = matchInvoicesToTransactions(
      [transaction()],
      [invoice({ sellerName: "不同商家", amount: 999 })],
      [
        {
          invoiceId: "invoice-1",
          transactionId: "transaction-1",
          decision: "linked",
          updatedAt: "2026-07-19T00:00:00.000Z",
        },
      ],
    );

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe(
      "transaction-1",
    );
  });

  it("keeps an automatic match separate after the user unlinks it", () => {
    const result = matchInvoicesToTransactions(
      [transaction()],
      [invoice()],
      [
        {
          invoiceId: "invoice-1",
          transactionId: null,
          decision: "separate",
          updatedAt: "2026-07-19T00:00:00.000Z",
        },
      ],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
    expect(result.transactionToInvoice.size).toBe(0);
  });

  it("keeps a cash-paid invoice separate and marks it for the cash wallet", () => {
    const result = matchInvoicesToTransactions(
      [transaction()],
      [invoice()],
      [
        {
          invoiceId: "invoice-1",
          transactionId: null,
          decision: "cash",
          updatedAt: "2026-07-19T00:00:00.000Z",
        },
      ],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
    expect(result.transactionToInvoice.size).toBe(0);
    expect(result.cashInvoiceIds.has("invoice-1")).toBe(true);
  });

  it("pairs ambiguous same-day amounts deterministically and one-to-one", () => {
    const result = matchInvoicesToTransactions(
      [
        transaction({
          id: "transaction-b",
          amount: -860,
        }),
        transaction({
          id: "transaction-a",
          amount: -860,
        }),
        transaction({ id: "transaction-c", amount: -860 }),
      ],
      [invoice({ id: "invoice-b" }), invoice({ id: "invoice-a" })],
    );

    expect(Array.from(result.invoiceToTransactionId)).toEqual([
      ["invoice-a", "transaction-a"],
      ["invoice-b", "transaction-b"],
    ]);
    expect(
      Array.from(result.transactionToInvoice, ([transactionId, row]) => [
        transactionId,
        row.id,
      ]),
    ).toEqual([
      ["transaction-a", "invoice-a"],
      ["transaction-b", "invoice-b"],
    ]);
    expect(result.transactionToInvoice.has("transaction-c")).toBe(false);
  });

  it("does not treat a positive bank deposit as an expense match", () => {
    const result = matchInvoicesToTransactions(
      [transaction({ accountType: "checking", amount: 860 })],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
  });

  it("uses the authorization day when the posting day differs", () => {
    const result = matchInvoicesToTransactions(
      [
        transaction({
          postedDate: "2026-07-11",
          authorizedAt: "2026-07-10T12:00:00.000Z",
        }),
      ],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe(
      "transaction-1",
    );
  });

  it("uses the Taipei calendar day for ISO timestamps near midnight", () => {
    const nextTaipeiDay = transaction({
      accountType: "credit",
      postedDate: "2026-07-06T16:00:00.000Z",
      authorizedAt: "2026-07-06T16:00:00.000Z",
      amount: 50,
    });
    const targetInvoice = invoice({
      invoiceDate: "2026-07-06T04:39:18.000Z",
      amount: 50,
    });

    expect(
      matchInvoicesToTransactions([nextTaipeiDay], [targetInvoice])
        .invoiceToTransactionId.size,
    ).toBe(0);
    expect(
      invoiceTransactionCandidates([nextTaipeiDay], targetInvoice).map(
        ({ id }) => id,
      ),
    ).toEqual([]);
  });

  it("uses the posted-date prefix for a legacy transaction without authorization time", () => {
    const legacy = transaction({
      accountType: "credit",
      postedDate: "2026-07-06T16:00:00.000Z",
      authorizedAt: undefined,
      amount: 50,
    });
    const targetInvoice = invoice({
      invoiceDate: "2026-07-06T04:39:18.000Z",
      amount: 50,
    });

    expect(
      invoiceTransactionCandidates([legacy], targetInvoice).map(({ id }) => id),
    ).toEqual(["transaction-1"]);
  });

  it("does not match when the amount or date differs", () => {
    expect(
      matchInvoicesToTransactions([transaction({ amount: -861 })], [invoice()])
        .invoiceToTransactionId.size,
    ).toBe(0);
    expect(
      matchInvoicesToTransactions(
        [transaction({ postedDate: "2026-07-20", authorizedAt: undefined })],
        [invoice()],
      ).invoiceToTransactionId.size,
    ).toBe(0);
  });

  it("does not match a non-TWD transaction", () => {
    const result = matchInvoicesToTransactions(
      [transaction({ currency: "USD" })],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
  });
});

describe("bank transaction deduplication", () => {
  it("prefers the posted E.SUN lifecycle copy and lets its invoice match", () => {
    const pending = transaction({
      id: "pending",
      connectorId: "esun",
      sourceId:
        "2026-07-05T00:00:00.000Z:credit:esun:1204:全支付﹘全聯:252:TWD:未入帳:1",
      accountType: "credit",
      postedDate: "2026-07-05T00:00:00.000Z",
      authorizedAt: "2026-07-05T00:00:00.000Z",
      amount: 252,
      description: "全支付﹘全聯",
      counterparty: "全支付﹘全聯",
    });
    const posted = transaction({
      ...pending,
      id: "posted",
      sourceId: pending.sourceId.replace("未入帳", "已入帳"),
    });
    const transactions = deduplicateBankTransactions([pending, posted]);

    expect(transactions.map(({ id }) => id)).toEqual(["posted"]);
    expect(
      matchInvoicesToTransactions(transactions, [
        invoice({
          invoiceDate: "2026-07-05T14:41:11.000Z",
          sellerName: "全聯實業股份有限公司台中旅順分公司",
          amount: 252,
        }),
      ]).invoiceToTransactionId.get("invoice-1"),
    ).toBe("posted");
  });

  it("keeps distinct occurrences and unrelated connectors", () => {
    const first = transaction({
      id: "first",
      connectorId: "esun",
      sourceId: "same:已入帳:1",
    });
    const second = transaction({
      id: "second",
      connectorId: "esun",
      sourceId: "same:已入帳:2",
    });
    const unrelated = transaction({ id: "unrelated", connectorId: "tdcc" });

    expect(
      deduplicateBankTransactions([first, second, unrelated]).map(
        ({ id }) => id,
      ),
    ).toEqual(["first", "second", "unrelated"]);
  });
});
