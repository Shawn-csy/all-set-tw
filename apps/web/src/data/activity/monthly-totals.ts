import type { BankData, BankTransactionRow } from "@/data/bank/types";
import {
  isLikelyInvestmentCashFlow,
  allocateInvoiceCategories,
  countedInvoiceAmount,
  type InvestmentCashTransferHint,
} from "@taiwan-fin-hub/core";
import type {
  InvoiceSummaryRow,
  InvoiceTransactionPreference,
  InvoicePaymentAccountRule,
  InvoicePaymentAccountAssignment,
} from "@/data/invoices/types";
import { transactionValueTwd } from "@/shared/format/financial";
import {
  deduplicateBankTransactions,
  matchInvoicesToTransactions,
} from "./matching";

export interface MonthlyActivityTotals {
  income: number;
  expense: number;
  ordinaryIncome: number;
  ordinaryExpense: number;
  investmentIncome: number;
  investmentExpense: number;
  netCashFlow: number;
}

export interface MonthlyExpenseCategoryTotal {
  category: string;
  amount: number;
}

interface MonthlyActivityBreakdown extends MonthlyActivityTotals {
  categories: MonthlyExpenseCategoryTotal[];
}

function addCategoryAmount(
  categories: Map<string, number>,
  category: string,
  amount: number,
) {
  if (amount <= 0) return;
  categories.set(category, (categories.get(category) ?? 0) + amount);
}

function calculateMonthlyActivityBreakdown(
  bank: BankData,
  invoices: InvoiceSummaryRow[],
  mappings: InvoiceTransactionPreference[],
  rates: Record<string, number>,
  investmentTrades: readonly InvestmentCashTransferHint[] = [],
  paymentAccountRules: InvoicePaymentAccountRule[] = [],
  paymentAccounts: InvoicePaymentAccountAssignment[] = [],
): MonthlyActivityBreakdown {
  const accounts = new Map(
    bank.accounts.map((account) => [account.id, account]),
  );
  const transactions = deduplicateBankTransactions(
    bank.transactions.map((transaction) => ({
      ...transaction,
      accountType:
        transaction.accountType ??
        accounts.get(transaction.accountId)?.accountType,
    })),
  );
  const matches = matchInvoicesToTransactions(
    transactions,
    invoices,
    mappings,
    paymentAccountRules,
    paymentAccounts,
  );
  const categories = new Map<string, number>();

  const totals = transactions.reduce(
    (result, transaction) => {
      const amount = transactionValueTwd(transaction, rates);
      const isInvestment = isLikelyInvestmentCashFlow(
        {
          ...transaction,
          categoryId: transaction.classification?.categoryId,
        },
        investmentTrades,
      );
      if (isInvestment) {
        if (amount < 0) result.investmentExpense += Math.abs(amount);
        if (amount > 0) result.investmentIncome += amount;
        return result;
      }
      if (transaction.excludedFromCalculation) return result;
      const matchedInvoice = matches.transactionToInvoice.get(transaction.id);
      if (matchedInvoice?.items?.length) {
        const parts = allocateInvoiceCategories(
          matchedInvoice.amount,
          Math.abs(amount),
          matchedInvoice.items,
        );
        result.ordinaryExpense += countedInvoiceAmount(parts);
        for (const part of parts) {
          if (part.behavior === "normal")
            addCategoryAmount(categories, part.category, part.amount);
        }
        return result;
      }
      if (
        transaction.classification?.behavior === "excluded" ||
        transaction.classification?.behavior === "asset_transfer" ||
        transaction.classification?.behavior === "cash_withdrawal"
      )
        return result;
      if (matchedInvoice && transaction.accountType === "credit") {
        const expense = Math.abs(amount);
        result.ordinaryExpense += expense;
        addCategoryAmount(categories, "未分類", expense);
        return result;
      }
      if (amount > 0) result.ordinaryIncome += amount;
      if (amount < 0) {
        const expense = Math.abs(amount);
        result.ordinaryExpense += expense;
        addCategoryAmount(
          categories,
          transaction.classification?.label ?? "未分類",
          expense,
        );
      }
      return result;
    },
    {
      ordinaryIncome: 0,
      ordinaryExpense: 0,
      investmentIncome: 0,
      investmentExpense: 0,
    },
  );

  totals.ordinaryExpense += invoices
    .filter((invoice) => !matches.invoiceToTransactionId.has(invoice.id))
    .reduce((sum, invoice) => {
      const parts = allocateInvoiceCategories(
        invoice.amount,
        invoice.amount,
        invoice.items,
      );
      for (const part of parts) {
        if (part.behavior === "normal")
          addCategoryAmount(categories, part.category, part.amount);
      }
      return sum + countedInvoiceAmount(parts);
    }, 0);

  const income = totals.ordinaryIncome + totals.investmentIncome;
  const expense = totals.ordinaryExpense + totals.investmentExpense;
  return {
    income,
    expense,
    ordinaryIncome: totals.ordinaryIncome,
    ordinaryExpense: totals.ordinaryExpense,
    investmentIncome: totals.investmentIncome,
    investmentExpense: totals.investmentExpense,
    netCashFlow: income - expense,
    categories: [...categories.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((left, right) => right.amount - left.amount),
  };
}

export function calculateMonthlyActivityTotals(
  bank: BankData,
  invoices: InvoiceSummaryRow[],
  mappings: InvoiceTransactionPreference[],
  rates: Record<string, number>,
  investmentTrades: readonly InvestmentCashTransferHint[] = [],
  paymentAccountRules: InvoicePaymentAccountRule[] = [],
  paymentAccounts: InvoicePaymentAccountAssignment[] = [],
): MonthlyActivityTotals {
  const { categories: _categories, ...totals } =
    calculateMonthlyActivityBreakdown(
      bank,
      invoices,
      mappings,
      rates,
      investmentTrades,
      paymentAccountRules,
      paymentAccounts,
    );
  return totals;
}

export function calculateMonthlyExpenseCategories(
  bank: BankData,
  invoices: InvoiceSummaryRow[],
  mappings: InvoiceTransactionPreference[],
  rates: Record<string, number>,
  investmentTrades: readonly InvestmentCashTransferHint[] = [],
  paymentAccountRules: InvoicePaymentAccountRule[] = [],
  paymentAccounts: InvoicePaymentAccountAssignment[] = [],
) {
  return calculateMonthlyActivityBreakdown(
    bank,
    invoices,
    mappings,
    rates,
    investmentTrades,
    paymentAccountRules,
    paymentAccounts,
  ).categories;
}
