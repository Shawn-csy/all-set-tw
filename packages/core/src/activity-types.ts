export interface ActivityItem {
  id: string;
  source: "bank" | "card" | "investment" | "invoice";
  date: string;
  /** Only true when the selected source value contains a reliable timestamp. */
  dateHasTime?: boolean;
  title: string;
  subtitle: string;
  /** Provider-supplied transaction type, such as CD提款 or 行動跨轉. */
  sourceSummary?: string;
  searchText?: string;
  institutionName?: string;
  accountName?: string;
  amount?: number;
  currency: string;
  /** Cash-flow classification used by reports and charts. */
  cashFlowType?: ActivityCashFlowType;
  cashTransferType?: "investment" | "cash_withdrawal";
  category: string;
  categoryId?: string;
  categoryParts?: Array<{
    itemId?: string;
    description?: string;
    categoryId: string;
    category: string;
    amount: number;
    behavior: ClassificationBehavior;
  }>;
  classificationPattern?: string;
  classificationSource?:
    | "override"
    | "user_rule"
    | "system_rule"
    | "merchant_product_rule"
    | "merchant_default"
    | "auto_transfer"
    | "auto_offset"
    | "fallback";
  classificationRuleId?: string;
  classificationBehavior?: ClassificationBehavior;
  transactionId?: string;
  excludedFromCalculation?: boolean;
  invoiceId?: string;
  invoiceAmount?: number;
  invoicePaymentMethod?: "cash" | "card";
  invoicePaymentAccountId?: string;
  invoicePaymentAccountSource?: "selected" | "learned";
  status: string;
}

export type ClassificationBehavior =
  "normal" | "asset_transfer" | "cash_withdrawal" | "excluded";

export type ActivityCashFlowType =
  | "income"
  | "expense"
  | "investment_income"
  | "investment_expense"
  | "asset_transfer"
  | "valuation";
