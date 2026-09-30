import { describe, expect, it } from "vitest";
import type { BankData, BankTransactionRow } from "@/data/bank/types";
import type {
  InvoiceSummaryRow,
  InvoiceTransactionPreference,
} from "@/data/invoices/types";
import {
  calculateMonthlyActivityTotals,
  calculateMonthlyExpenseCategories,
} from "./monthly-totals";

function transaction(
  input: Partial<BankTransactionRow> &
    Pick<BankTransactionRow, "id" | "amount">,
): BankTransactionRow {
  return {
    connectorId: "sinopac",
    accountId: "account-1",
    sourceId: input.id,
    postedDate: "2026-07-02",
    currency: "TWD",
    status: "posted",
    excludedFromCalculation: false,
    ...input,
  };
}

function invoice(
  input: Partial<InvoiceSummaryRow> & Pick<InvoiceSummaryRow, "id" | "amount">,
): InvoiceSummaryRow {
  return {
    connectorId: "einvoice",
    sourceId: input.id,
    invoiceNumber: input.id,
    invoiceDate: "2026-07-02",
    sellerName: "測試商家",
    ...input,
  };
}

describe("calculateMonthlyActivityTotals", () => {
  it("按交易分類與發票品項彙總支出分類", () => {
    const result = calculateMonthlyExpenseCategories(
      {
        accounts: [
          {
            id: "account-1",
            connectorId: "sinopac",
            sourceId: "account-1",
            accountType: "deposit",
            currency: "TWD",
          },
        ],
        transactions: [
          transaction({
            id: "food-transaction",
            amount: -120,
            classification: {
              categoryId: "food",
              label: "餐飲",
              source: "user_rule",
              behavior: "normal",
            },
          }),
        ],
      },
      [
        invoice({
          id: "invoice-with-items",
          amount: 200,
          items: [
            {
              id: "grocery",
              sourceId: "grocery",
              lineNumber: 1,
              description: "日用品",
              amount: 80,
              classification: {
                categoryId: "daily",
                label: "日用品",
                behavior: "normal",
                source: "override",
              },
            },
          ],
        }),
      ],
      [],
      {},
    );

    expect(result).toEqual([
      { category: "餐飲", amount: 120 },
      { category: "未分類", amount: 120 },
      { category: "日用品", amount: 80 },
    ]);
  });

  it("uses item categories for a linked invoice and excludes only excluded item value", () => {
    const cardExpense = transaction({
      id: "item-card-expense",
      accountId: "card-1",
      accountType: "credit",
      amount: -270,
      classification: {
        categoryId: "transfer",
        label: "轉帳",
        behavior: "asset_transfer",
        source: "user_rule",
      },
    });
    const result = calculateMonthlyActivityTotals(
      {
        accounts: [
          {
            id: "card-1",
            connectorId: "sinopac",
            sourceId: "card-1",
            accountType: "credit",
            currency: "TWD",
          },
        ],
        transactions: [cardExpense],
      },
      [
        invoice({
          id: "mixed",
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
              id: "excluded",
              sourceId: "excluded",
              lineNumber: 2,
              description: "代購",
              amount: 150,
              classification: {
                categoryId: "excluded",
                label: "不列入統計",
                behavior: "excluded",
                source: "override",
              },
            },
          ],
        }),
      ],
      [
        {
          invoiceId: "mixed",
          transactionId: "item-card-expense",
          decision: "linked",
          updatedAt: "t",
        },
      ],
      {},
    );
    expect(result).toEqual({
      income: 0,
      expense: 135,
      ordinaryIncome: 0,
      ordinaryExpense: 135,
      investmentIncome: 0,
      investmentExpense: 0,
      netCashFlow: -135,
    });
  });
  it("指定卡片後不會把另一張卡的同額消費與發票誤當成同一筆", () => {
    const bank: BankData = {
      accounts: [
        {
          id: "card-other",
          connectorId: "sinopac",
          sourceId: "card-other",
          accountType: "credit",
          currency: "TWD",
        },
      ],
      transactions: [
        transaction({
          id: "other-purchase",
          accountId: "card-other",
          accountType: "credit",
          amount: -298,
        }),
      ],
    };
    expect(
      calculateMonthlyActivityTotals(
        bank,
        [invoice({ id: "spotify", sellerName: "Spotify AB", amount: 298 })],
        [],
        {},
        [],
        [{ matchKey: "spotifyab", accountId: "card-selected", updatedAt: "t" }],
        [{ invoiceId: "spotify", accountId: "card-selected", updatedAt: "t" }],
      ),
    ).toEqual({
      income: 0,
      expense: 596,
      ordinaryIncome: 0,
      ordinaryExpense: 596,
      investmentIncome: 0,
      investmentExpense: 0,
      netCashFlow: -596,
    });
  });
  it("統計銀行、信用卡與未配對發票，並略過已排除活動", () => {
    const bank: BankData = {
      accounts: [
        {
          id: "account-1",
          connectorId: "sinopac",
          sourceId: "account-1",
          accountType: "deposit",
          currency: "TWD",
        },
        {
          id: "card-1",
          connectorId: "sinopac",
          sourceId: "card-1",
          accountType: "credit",
          currency: "TWD",
        },
      ],
      transactions: [
        transaction({ id: "salary", amount: 10_000 }),
        transaction({
          id: "card-expense",
          accountId: "card-1",
          amount: -1_200,
        }),
        transaction({
          id: "excluded",
          amount: -500,
          excludedFromCalculation: true,
        }),
      ],
    };

    expect(
      calculateMonthlyActivityTotals(
        bank,
        [invoice({ id: "unmatched", amount: 300 })],
        [],
        {},
      ),
    ).toEqual({
      income: 10_000,
      expense: 1_500,
      ordinaryIncome: 10_000,
      ordinaryExpense: 1_500,
      investmentIncome: 0,
      investmentExpense: 0,
      netCashFlow: 8_500,
    });
  });

  it("已配對發票不會重複列入支出", () => {
    const cardExpense = transaction({
      id: "card-expense",
      accountId: "card-1",
      amount: -1_200,
    });
    const matchedInvoice = invoice({ id: "matched", amount: 1_200 });
    const mappings: InvoiceTransactionPreference[] = [
      {
        invoiceId: matchedInvoice.id,
        decision: "linked",
        transactionId: cardExpense.id,
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ];

    expect(
      calculateMonthlyActivityTotals(
        {
          accounts: [
            {
              id: "card-1",
              connectorId: "sinopac",
              sourceId: "card-1",
              accountType: "credit",
              currency: "TWD",
            },
          ],
          transactions: [cardExpense],
        },
        [matchedInvoice],
        mappings,
        {},
      ),
    ).toEqual({
      income: 0,
      expense: 1_200,
      ordinaryIncome: 0,
      ordinaryExpense: 1_200,
      investmentIncome: 0,
      investmentExpense: 0,
      netCashFlow: -1_200,
    });
  });

  it("把投資本金列入投資支出，但保留手續費為一般支出", () => {
    const result = calculateMonthlyActivityTotals(
      {
        accounts: [
          {
            id: "account-1",
            connectorId: "sinopac",
            sourceId: "account-1",
            accountType: "deposit",
            currency: "TWD",
          },
        ],
        transactions: [
          transaction({
            id: "stock-buy",
            amount: -10_000,
            description: "定期定額買台股 0050",
          }),
          transaction({
            id: "stock-fee",
            amount: -20,
            description: "股票交易手續費",
          }),
        ],
      },
      [],
      [],
      {},
      [{ symbol: "0050", name: "元大台灣50" }],
    );

    expect(result).toEqual({
      income: 0,
      expense: 10_020,
      ordinaryIncome: 0,
      ordinaryExpense: 20,
      investmentIncome: 0,
      investmentExpense: 10_000,
      netCashFlow: -10_020,
    });
  });

  it("把投資收回與配息列入投資收入", () => {
    const result = calculateMonthlyActivityTotals(
      {
        accounts: [
          {
            id: "account-1",
            connectorId: "sinopac",
            sourceId: "account-1",
            accountType: "deposit",
            currency: "TWD",
          },
        ],
        transactions: [
          transaction({
            id: "investment-buy",
            amount: -10_000,
            excludedFromCalculation: true,
            classification: {
              categoryId: "investment",
              label: "投資",
              behavior: "asset_transfer",
              source: "system_rule",
            },
          }),
          transaction({
            id: "investment-redemption",
            amount: 8_000,
            excludedFromCalculation: true,
            classification: {
              categoryId: "investment",
              label: "投資",
              behavior: "asset_transfer",
              source: "system_rule",
            },
          }),
          transaction({
            id: "dividend",
            amount: 200,
            description: "配息 GOOGL",
          }),
        ],
      },
      [],
      [],
      {},
    );

    expect(result).toEqual({
      income: 8_200,
      expense: 10_000,
      ordinaryIncome: 0,
      ordinaryExpense: 0,
      investmentIncome: 8_200,
      investmentExpense: 10_000,
      netCashFlow: -1_800,
    });
  });
});
