import type {
  InvestmentRow,
  InvestmentTransactionRow,
} from "@/data/investments/types";
import {
  classifyInvestmentTransaction,
  type InvestmentTransactionKind,
} from "@/data/investments/transaction-kind";
export { classifyInvestmentTransaction } from "@/data/investments/transaction-kind";

export type { InvestmentTransactionKind } from "@/data/investments/transaction-kind";

export interface ClassifiedInvestmentTransaction {
  transaction: InvestmentTransactionRow;
  kind: InvestmentTransactionKind;
  date?: string;
}

export interface InvestmentReturnSummary {
  currentValue: number;
  knownMarketValue: number;
  knownCost: number;
  unrealizedReturn: number;
  knownPositionReturnRate: number;
  investedAmount: number;
  returnedAmount: number;
  incomeAmount: number;
  overallReturn: number;
  overallReturnRate: number | null;
  overallBasis: "cash-flow" | "positions" | "unavailable";
  transactionCount: number;
  missingAmountCount: number;
  buyCount: number;
  buyQuantity: number;
  sellCount: number;
  sellQuantity: number;
  redemptionCount: number;
  redemptionQuantity: number;
  incomeCount: number;
}

export type CurrencyConverter = (amount: number, currency: string) => number;

export function classifyInvestmentTransactions(
  transactions: InvestmentTransactionRow[],
) {
  return transactions.map((transaction) => ({
    transaction,
    kind: classifyInvestmentTransaction(transaction),
    date: transaction.tradeDate ?? transaction.postedDate,
  }));
}

function transactionAmount(
  transaction: InvestmentTransactionRow,
  toTwd: CurrencyConverter,
) {
  if (transaction.amount == null || !Number.isFinite(transaction.amount))
    return undefined;
  return toTwd(Math.abs(transaction.amount), transaction.currency);
}

function quantity(transaction: InvestmentTransactionRow) {
  return Math.abs(transaction.quantity ?? 0);
}

export function calculateInvestmentReturns(
  positions: InvestmentRow[],
  transactions: InvestmentTransactionRow[],
  toTwd: CurrencyConverter,
  options: { completeHistory?: boolean } = {},
): InvestmentReturnSummary {
  let currentValue = 0;
  let knownMarketValue = 0;
  let knownCost = 0;
  let missingAmountCount = 0;
  let investedAmount = 0;
  let returnedAmount = 0;
  let incomeAmount = 0;
  let buyCount = 0;
  let buyQuantity = 0;
  let sellCount = 0;
  let sellQuantity = 0;
  let redemptionCount = 0;
  let redemptionQuantity = 0;
  let incomeCount = 0;
  let actionableTransactionCount = 0;

  for (const position of positions) {
    if (position.marketValue != null && Number.isFinite(position.marketValue))
      currentValue += toTwd(position.marketValue, position.currency);
    if (
      position.costBasis != null &&
      position.marketValue != null &&
      Number.isFinite(position.costBasis) &&
      Number.isFinite(position.marketValue)
    ) {
      knownCost += toTwd(position.costBasis, position.currency);
      knownMarketValue += toTwd(position.marketValue, position.currency);
    }
  }

  for (const classified of classifyInvestmentTransactions(transactions)) {
    const { transaction, kind } = classified;
    if (kind === "other") continue;
    actionableTransactionCount += 1;
    const amount = transactionAmount(transaction, toTwd);
    if (amount == null) missingAmountCount += 1;

    if (kind === "buy") {
      buyCount += 1;
      buyQuantity += quantity(transaction);
      if (amount != null) investedAmount += amount;
    } else if (kind === "sell") {
      sellCount += 1;
      sellQuantity += quantity(transaction);
      if (amount != null) returnedAmount += amount;
    } else if (kind === "redemption") {
      redemptionCount += 1;
      redemptionQuantity += quantity(transaction);
      if (amount != null) returnedAmount += amount;
    } else {
      incomeCount += 1;
      if (amount != null) incomeAmount += amount;
    }
  }

  const unrealizedReturn = knownMarketValue - knownCost;
  const knownPositionReturnRate =
    knownCost === 0 ? 0 : (unrealizedReturn / knownCost) * 100;
  const hasCompleteCashFlow =
    options.completeHistory === true &&
    actionableTransactionCount > 0 &&
    missingAmountCount === 0 &&
    investedAmount > 0;

  if (hasCompleteCashFlow) {
    const overallReturn =
      currentValue + returnedAmount + incomeAmount - investedAmount;
    return {
      currentValue,
      knownMarketValue,
      knownCost,
      unrealizedReturn,
      knownPositionReturnRate,
      investedAmount,
      returnedAmount,
      incomeAmount,
      overallReturn,
      overallReturnRate: (overallReturn / investedAmount) * 100,
      overallBasis: "cash-flow",
      transactionCount: actionableTransactionCount,
      missingAmountCount,
      buyCount,
      buyQuantity,
      sellCount,
      sellQuantity,
      redemptionCount,
      redemptionQuantity,
      incomeCount,
    };
  }

  if (knownCost > 0) {
    return {
      currentValue,
      knownMarketValue,
      knownCost,
      unrealizedReturn,
      knownPositionReturnRate,
      investedAmount,
      returnedAmount,
      incomeAmount,
      overallReturn: unrealizedReturn,
      overallReturnRate: (unrealizedReturn / knownCost) * 100,
      overallBasis: "positions",
      transactionCount: actionableTransactionCount,
      missingAmountCount,
      buyCount,
      buyQuantity,
      sellCount,
      sellQuantity,
      redemptionCount,
      redemptionQuantity,
      incomeCount,
    };
  }

  return {
    currentValue,
    knownMarketValue,
    knownCost,
    unrealizedReturn,
    knownPositionReturnRate,
    investedAmount,
    returnedAmount,
    incomeAmount,
    overallReturn: 0,
    overallReturnRate: null,
    overallBasis: "unavailable",
    transactionCount: actionableTransactionCount,
    missingAmountCount,
    buyCount,
    buyQuantity,
    sellCount,
    sellQuantity,
    redemptionCount,
    redemptionQuantity,
    incomeCount,
  };
}

export function investmentTransactionLabel(kind: InvestmentTransactionKind) {
  switch (kind) {
    case "buy":
      return "買進／投入";
    case "sell":
      return "賣出／收回";
    case "redemption":
      return "贖回／收回";
    case "income":
      return "配息／收益";
    default:
      return "其他投資交易";
  }
}
