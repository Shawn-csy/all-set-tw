import { isLikelyInvestmentCashFlow } from "./activity-flow";
import type { ActivityItem } from "./activity-types";
import type { ClassificationBehavior } from "./activity-types";
import {
  allocateInvoiceCategories,
  countedInvoiceAmount,
  type InvoiceCategoryLine,
  type InvoiceCategoryPart,
} from "./invoice-categories";
import { compareActivityItems, isActivityDateTime } from "./activity-list";
import type {
  MatchingTransaction,
  MatchingInvoice,
  InvoiceTransactionMatches,
} from "./activity-matching";
export interface ActivityAccount {
  id: string;
  institutionName?: string | null;
  accountName?: string | null;
  accountType?: string | null;
  accountLast4?: string | null;
}
export interface ActivityTransaction extends MatchingTransaction {
  accountId: string;
  institutionName?: string | null;
  accountName?: string | null;
  accountLast4?: string | null;
  sourceSummary?: string | null;
  status: string;
  excludedFromCalculation?: boolean;
  cashWithdrawal?: boolean;
  classification?: {
    label: string;
    categoryId: string;
    behavior?: ClassificationBehavior;
    source: ActivityItem["classificationSource"];
    ruleId?: string;
  };
}
export interface ActivityInvoice extends MatchingInvoice {
  sellerName?: string | null;
  invoiceNumber?: string | null;
  items?: Array<InvoiceCategoryLine & { description?: string }>;
}

function invoiceCategorySummary(parts: readonly InvoiceCategoryPart[]) {
  const labels = new Set(parts.map((part) => part.category));
  const ids = new Set(parts.map((part) => part.categoryId));
  return {
    category:
      labels.size === 0
        ? "未分類"
        : labels.size === 1
          ? [...labels][0]!
          : "多分類",
    categoryId:
      ids.size === 0 ? "other" : ids.size === 1 ? [...ids][0]! : "mixed",
  };
}
export interface ActivityTrade {
  id: string;
  name?: string | null;
  symbol?: string | null;
  tradeDate?: string | null;
  postedDate?: string | null;
  transactionName?: string | null;
  transactionCode?: string | null;
  quantity?: number | null;
  price?: number | null;
  amount?: number | null;
  currency: string;
}
const formatNumber = (value: number) =>
  new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(value);
function normalizeFinancialDate(value?: string) {
  if (!value) return "";
  const roc = value.match(/^0(\d{3})-(\d{2})-(\d{2})(.*)$/);
  return roc ? `${Number(roc[1]) + 1911}-${roc[2]}-${roc[3]}${roc[4]}` : value;
}
export function buildActivityItems(
  activityBankTransactions: ActivityTransaction[],
  invoices: ActivityInvoice[],
  trades: ActivityTrade[],
  accounts: ReadonlyMap<string, ActivityAccount>,
  invoiceMatches: InvoiceTransactionMatches<ActivityInvoice>,
): ActivityItem[] {
  return [
    ...activityBankTransactions.map((t) => {
      const account = accounts.get(t.accountId);
      const matchedInvoice = invoiceMatches.transactionToInvoice.get(t.id);
      const isCard =
        account?.accountType === "credit" || t.accountType === "credit";
      const categoryParts = matchedInvoice?.items?.length
        ? allocateInvoiceCategories(
            matchedInvoice.amount,
            Math.abs(t.amount),
            matchedInvoice.items,
          )
        : undefined;
      const invoiceCategory = categoryParts
        ? invoiceCategorySummary(categoryParts)
        : undefined;
      const hasAuthorizationTime = isActivityDateTime(
        t.authorizedAt ?? undefined,
      );
      const invoiceTime = isActivityDateTime(matchedInvoice?.invoiceDate)
        ? matchedInvoice.invoiceDate
        : undefined;
      const institutionName =
        t.institutionName ??
        account?.institutionName ??
        (isCard ? "信用卡" : "銀行");
      const accountLast4 = t.accountLast4 ?? account?.accountLast4;
      const accountName =
        t.accountName ??
        account?.accountName ??
        (accountLast4 ? `末四碼 ${accountLast4}` : "");
      const isInvestmentCashFlow =
        !categoryParts &&
        isLikelyInvestmentCashFlow(
          {
            ...t,
            categoryId: t.classification?.categoryId,
          },
          trades,
        );
      // The bank/card row establishes payment; invoice items establish what
      // was purchased. Its old transaction category must not hide the items.
      const classificationBehavior = categoryParts
        ? undefined
        : t.classification?.behavior;
      const isCashWithdrawal = classificationBehavior === "cash_withdrawal";
      const isClassificationAssetTransfer =
        classificationBehavior === "asset_transfer";
      return {
        id: t.id,
        source: isCard ? ("card" as const) : ("bank" as const),
        date: invoiceTime ?? t.authorizedAt ?? t.postedDate ?? "",
        dateHasTime: hasAuthorizationTime || invoiceTime != null,
        title: t.description ?? t.counterparty ?? "銀行交易",
        sourceSummary: t.sourceSummary ?? undefined,
        searchText: [
          t.counterparty,
          t.sourceSummary,
          matchedInvoice?.sellerName,
          matchedInvoice ? "電子發票" : undefined,
          ...(matchedInvoice?.items?.map((item) => item.description) ?? []),
          ...(categoryParts?.map((part) => part.category) ?? []),
          accountLast4,
          isCard ? "信用卡" : "銀行",
        ]
          .filter(Boolean)
          .join(" "),
        subtitle: [institutionName, accountName, matchedInvoice?.invoiceNumber]
          .filter(Boolean)
          .join(" · "),
        institutionName,
        accountName,
        amount: matchedInvoice && isCard ? -Math.abs(t.amount) : t.amount,
        currency: t.currency,
        cashFlowType: isInvestmentCashFlow
          ? t.amount < 0
            ? ("investment_expense" as const)
            : t.amount > 0
              ? ("investment_income" as const)
              : ("asset_transfer" as const)
          : isCashWithdrawal || isClassificationAssetTransfer
            ? ("asset_transfer" as const)
            : undefined,
        cashTransferType: isCashWithdrawal
          ? ("cash_withdrawal" as const)
          : isInvestmentCashFlow
            ? ("investment" as const)
            : undefined,
        category:
          invoiceCategory?.category ?? t.classification?.label ?? "未分類",
        categoryId:
          invoiceCategory?.categoryId ??
          t.classification?.categoryId ??
          "other",
        categoryParts,
        classificationPattern: t.counterparty ?? t.description ?? undefined,
        classificationSource: t.classification?.source ?? "fallback",
        classificationRuleId: t.classification?.ruleId,
        classificationBehavior,
        transactionId: t.id,
        invoiceId: matchedInvoice?.id,
        invoiceAmount: matchedInvoice?.amount,
        excludedFromCalculation:
          (t.excludedFromCalculation && !isInvestmentCashFlow) ||
          (categoryParts != null &&
            countedInvoiceAmount(categoryParts) === 0) ||
          classificationBehavior === "excluded" ||
          (classificationBehavior === "asset_transfer" &&
            !isInvestmentCashFlow) ||
          classificationBehavior === "cash_withdrawal",
        status: t.status,
      };
    }),
    ...invoices
      .filter((i) => !invoiceMatches.invoiceToTransactionId.has(i.id))
      .map((i) => {
        const cash = invoiceMatches.cashInvoiceIds.has(i.id);
        const accountId = cash
          ? undefined
          : invoiceMatches.learnedAccountByInvoice.get(i.id);
        const account = accountId ? accounts.get(accountId) : undefined;
        const accountLabel = accountId
          ? [
              account?.accountName,
              account?.accountLast4
                ? `末四碼 ${account.accountLast4}`
                : undefined,
            ]
              .filter(Boolean)
              .join(" · ")
          : "";
        const categoryParts = allocateInvoiceCategories(
          i.amount,
          i.amount,
          i.items,
        );
        const invoiceCategory = invoiceCategorySummary(categoryParts);
        return {
          id: i.id,
          source: "invoice" as const,
          date: i.invoiceDate,
          dateHasTime: isActivityDateTime(i.invoiceDate),
          title: i.sellerName ?? "電子發票",
          searchText: [
            i.invoiceNumber,
            account?.institutionName,
            accountLabel,
            ...(i.items?.map((item) => item.description) ?? []),
            ...categoryParts.map((part) => part.category),
          ]
            .filter(Boolean)
            .join(" "),
          subtitle: [i.invoiceNumber, account?.institutionName, accountLabel]
            .filter(Boolean)
            .join(" · "),
          institutionName: accountId
            ? (account?.institutionName ?? "信用卡")
            : "電子發票",
          accountName: accountId ? accountLabel : (i.invoiceNumber ?? ""),
          amount: i.amount,
          currency: "TWD",
          category: invoiceCategory.category,
          categoryId: invoiceCategory.categoryId,
          categoryParts,
          invoiceId: i.id,
          invoiceAmount: i.amount,
          excludedFromCalculation: countedInvoiceAmount(categoryParts) === 0,
          invoicePaymentMethod: cash
            ? ("cash" as const)
            : accountId
              ? ("card" as const)
              : undefined,
          invoicePaymentAccountId: accountId,
          invoicePaymentAccountSource: accountId
            ? invoiceMatches.assignedAccountByInvoice.has(i.id)
              ? ("selected" as const)
              : ("learned" as const)
            : undefined,
          status: "已開立",
        };
      }),
    ...trades.map((t) => {
      const accountName = [
        t.transactionName ?? t.transactionCode,
        t.quantity != null ? `${formatNumber(t.quantity)} 股` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        id: t.id,
        source: "investment" as const,
        date: normalizeFinancialDate(t.tradeDate ?? t.postedDate ?? undefined),
        dateHasTime: false,
        title: t.name ?? t.symbol ?? "投資交易",
        searchText: t.symbol ?? undefined,
        subtitle: accountName,
        institutionName: "投資",
        accountName,
        amount: t.price === 1 ? undefined : (t.amount ?? undefined),
        currency: t.currency,
        cashFlowType: "asset_transfer" as const,
        category: "投資",
        status: "已完成",
      };
    }),
  ].sort(compareActivityItems);
}
