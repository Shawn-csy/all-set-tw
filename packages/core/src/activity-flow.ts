import type { ActivityItem } from "./activity-types";
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
  accountType?: string | null;
}

const INVESTMENT_PRINCIPAL_MARKER =
  /股票|複委託|定期定額|基金|etf|證券交割|交割款/u;
const INVESTMENT_FEE_MARKER = /手續費|交易稅|證交稅|佣金|稅金|稅額/u;
const INVESTMENT_INCOME_MARKER = /股利|配息|股息|除權息/u;

function normalizeMatchText(value?: string | null) {
  return (value ?? "")
    .toLocaleLowerCase("zh-TW")
    .replace(/[\s\-_/．。・]/gu, "");
}

/**
 * Detects the bank-side cash leg of an investment transaction.
 * Fees and dividends intentionally remain ordinary expense/income items.
 */
export function isLikelyInvestmentCashTransfer(
  movement: InvestmentCashMovement,
  trades: readonly InvestmentCashTransferHint[] = [],
) {
  if (movement.accountType === "credit") return false;
  const text = normalizeMatchText(
    [movement.description, movement.counterparty].filter(Boolean).join(" "),
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

export function activityDisplayAmount(item: ActivityItem) {
  if (item.amount == null) return undefined;
  return item.source === "invoice" ? -Math.abs(item.amount) : item.amount;
}

export function activityCashFlow(item: ActivityItem): ActivityFlow | null {
  if (
    item.cashFlowType === "asset_transfer" ||
    item.cashFlowType === "valuation"
  )
    return null;
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
