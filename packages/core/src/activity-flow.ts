import type { ActivityCashFlowType, ActivityItem } from "./activity-types";
export type ActivityFlow = "income" | "expense";
export type { ActivityCashFlowType } from "./activity-types";

export interface InvestmentCashTransferHint {
  symbol?: string | null;
  name?: string | null;
  tradeDate?: string | null;
  postedDate?: string | null;
  transactionName?: string | null;
  transactionCode?: string | null;
}

export interface InvestmentCashMovement {
  description?: string | null;
  counterparty?: string | null;
  sourceSummary?: string | null;
  accountType?: string | null;
  categoryId?: string | null;
}

const INVESTMENT_PRINCIPAL_MARKER =
  /股票|複委託|定期定額|基金|etf|證券交割|股款交割|交割款/u;
const INVESTMENT_FEE_MARKER = /手續費|交易稅|證交稅|佣金|稅金|稅額/u;
const INVESTMENT_INCOME_MARKER = /股利|配息|股息|除權息/u;

function normalizeMatchText(value?: string | null) {
  return (value ?? "")
    .toLocaleLowerCase("zh-TW")
    .replace(/[\s\-_/．。・]/gu, "");
}

/**
 * Detects the bank-side cash leg of an investment principal movement.
 * Fees and dividends are intentionally excluded here; the broader
 * isLikelyInvestmentCashFlow helper classifies dividends as investment income.
 */
export function isLikelyInvestmentCashTransfer(
  movement: InvestmentCashMovement,
  trades: readonly InvestmentCashTransferHint[] = [],
) {
  if (movement.accountType === "credit") return false;
  const text = normalizeMatchText(
    [movement.description, movement.counterparty, movement.sourceSummary]
      .filter(Boolean)
      .join(" "),
  );
  if (!text || INVESTMENT_FEE_MARKER.test(text)) return false;
  if (INVESTMENT_INCOME_MARKER.test(text)) return false;
  if (INVESTMENT_PRINCIPAL_MARKER.test(text)) return true;

  return trades.some((trade) => {
    const identifiers = [trade.symbol, trade.name]
      .map(normalizeMatchText)
      .filter((value) => value.length >= 2);
    return identifiers.some((identifier) => text.includes(identifier));
  });
}

/**
 * Detects both principal movements and investment income on the bank side.
 * The sign is interpreted by the caller: negative is an investment expense,
 * positive is an investment income/cash return.
 */
export function isLikelyInvestmentCashFlow(
  movement: InvestmentCashMovement,
  trades: readonly InvestmentCashTransferHint[] = [],
) {
  if (movement.accountType === "credit") return false;
  if (movement.categoryId === "investment") return true;
  const text = normalizeMatchText(
    [movement.description, movement.counterparty, movement.sourceSummary]
      .filter(Boolean)
      .join(" "),
  );
  if (!text || INVESTMENT_FEE_MARKER.test(text)) return false;
  if (INVESTMENT_INCOME_MARKER.test(text)) return true;
  return isLikelyInvestmentCashTransfer(movement, trades);
}

export function activityDisplayAmount(item: ActivityItem) {
  if (item.amount == null) return undefined;
  return item.source === "invoice" ? -Math.abs(item.amount) : item.amount;
}

export function activityCashFlowType(
  item: ActivityItem,
): ActivityCashFlowType | null {
  if (
    item.cashFlowType === "investment_income" ||
    item.cashFlowType === "investment_expense" ||
    item.cashFlowType === "asset_transfer" ||
    item.cashFlowType === "valuation"
  )
    return item.cashFlowType;
  if (
    item.amount == null ||
    (item.source !== "bank" &&
      item.source !== "card" &&
      item.source !== "invoice")
  )
    return null;
  const amount = activityDisplayAmount(item);
  if (amount == null) return null;
  if (amount > 0) return "income";
  if (amount < 0) return "expense";
  return null;
}

export function activityCashFlow(item: ActivityItem): ActivityFlow | null {
  const type = activityCashFlowType(item);
  if (type === "income" || type === "investment_income") return "income";
  if (type === "expense" || type === "investment_expense") return "expense";
  return null;
}

export function isInvestmentCashFlow(item: ActivityItem) {
  const type = activityCashFlowType(item);
  return type === "investment_income" || type === "investment_expense";
}
