import type { InvestmentTransactionRow } from "./types";

export type InvestmentTransactionKind =
  "buy" | "sell" | "redemption" | "income" | "other";

const incomePattern = /股利|股息|配息|除權息|現金股利|利息|dividend|interest/u;
const redemptionPattern = /贖回|赎回|回贖|回赎|redemption|redeem/u;
const sellPattern = /賣|卖|出售|sell/u;
const buyPattern = /買|买|申購|申购|purchase|buy/u;

export function classifyInvestmentTransaction(
  transaction: InvestmentTransactionRow,
): InvestmentTransactionKind {
  const text = `${transaction.transactionName ?? ""} ${transaction.transactionCode ?? ""}`;
  if (incomePattern.test(text)) return "income";
  if (redemptionPattern.test(text)) return "redemption";
  if (sellPattern.test(text) || transaction.transactionCode === "123")
    return "sell";
  if (buyPattern.test(text) || transaction.transactionCode === "113")
    return "buy";
  return "other";
}
