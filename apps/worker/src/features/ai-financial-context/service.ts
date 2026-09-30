import {
  activityCashFlowType,
  activityDisplayAmount,
  buildActivityItems,
  deduplicateBankTransactions,
  matchInvoicesToTransactions,
  type ActivityItem,
  type FinancialContextExport,
} from "@taiwan-fin-hub/core";
import { getCashWallet } from "../cash-wallet/service";
import {
  listInvoicePaymentAccountRules,
  listInvoicePaymentAccounts,
  listInvoiceTransactionPreferences,
} from "../activity/repository";
import { getBankRange } from "../bank/service";
import { listExchangeRates } from "../exchange-rates/repository";
import { getInvoicesRange } from "../invoices/service";
import { getManualAssets } from "../manual-assets/service";
import { listManualAssets } from "../manual-assets/repository";
import {
  getInvestmentPage,
  getInvestmentTransactionsRange,
} from "../investments/service";
import { normalizeBankAccountDisplay } from "../bank/display";

type FinancialContextPeriod = {
  from: string;
  to: string;
};

type CurrencyEntry = {
  currency: string;
  value: number | null;
};

const MAX_ACTIVITY_RECORDS = 5_000;
const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export async function getFinancialContext(
  db: D1Database,
  period: FinancialContextPeriod,
  generatedAt = new Date().toISOString(),
): Promise<FinancialContextExport> {
  const range = { from: period.from, to: addDays(period.to, 1) };
  const [
    bank,
    invoices,
    investmentTransactions,
    investmentPage,
    otherAssets,
    allManualAssets,
    rates,
    cashWallet,
    preferences,
    paymentRules,
    paymentAccounts,
  ] = await Promise.all([
    getBankRange(db, range),
    getInvoicesRange(db, range),
    getInvestmentTransactionsRange(db, range),
    getInvestmentPage(db, 10_000),
    getManualAssets(db),
    listManualAssets(db),
    listExchangeRates(db),
    getCashWallet(db),
    listInvoiceTransactionPreferences(db),
    listInvoicePaymentAccountRules(db),
    listInvoicePaymentAccounts(db),
  ]);

  const bankTransactions = deduplicateBankTransactions(bank.transactions);
  const accounts = bank.accounts.map(normalizeBankAccountDisplay);
  const accountMap = new Map(
    accounts.map((account) => [
      String(account.id),
      {
        ...account,
        id: String(account.id),
      },
    ]),
  );
  const invoiceMatches = matchInvoicesToTransactions(
    bankTransactions,
    invoices,
    preferences,
    paymentRules,
    paymentAccounts,
  );
  const activities = buildActivityItems(
    bankTransactions,
    invoices,
    investmentTransactions,
    accountMap,
    invoiceMatches,
  );
  const truncated = activities.length > MAX_ACTIVITY_RECORDS;
  const spending = buildSpending(activities, truncated);
  const holdings = investmentPage.positions.map((holding) => {
    const isManual = "isManual" in holding;
    const manualAsset = isManual
      ? allManualAssets.find((asset) => asset.id === holding.id)
      : undefined;
    const marketValue = holding.marketValue ?? null;
    const cashBalance = holding.cashBalance ?? null;
    const holdingValue = sumKnown([marketValue, cashBalance]);
    const costBasis = holding.costBasis ?? null;
    return {
      source: isManual ? ("manual" as const) : ("synced" as const),
      name: holding.name,
      symbol: holding.symbol ?? null,
      assetType: holding.assetType,
      quantity: holding.quantity ?? null,
      marketValue,
      cashBalance,
      costBasis,
      unrealizedPnl:
        holdingValue !== null && costBasis !== null
          ? holdingValue - costBasis
          : null,
      currency: holding.currency,
      asOfDate: holding.asOfDate,
      valuationStatus:
        holdingValue === null ? ("missing" as const) : ("valued" as const),
      ...(manualAsset?.note
        ? { investorNote: maskSensitiveText(manualAsset.note) ?? undefined }
        : {}),
    };
  });
  const investmentOutputTransactions = investmentTransactions.map(
    (transaction) => ({
      date: financialDate(transaction.tradeDate ?? transaction.postedDate),
      action:
        transaction.transactionName ??
        transaction.transactionCode ??
        "未命名交易",
      symbol: transaction.symbol ?? null,
      name: transaction.name ?? null,
      assetType: transaction.assetType ?? null,
      quantity: transaction.quantity ?? null,
      price: transaction.price ?? null,
      amount: transaction.amount ?? null,
      amountSource: transaction.amountSource ?? "missing",
      currency: transaction.currency,
    }),
  );
  const ratesByCurrency = new Map(
    rates.map((rate) => [rate.currency, rate.rateTwd]),
  );
  const accountOutput = accounts.map((account) => ({
    institution: account.institutionName ?? null,
    name: maskSensitiveText(account.accountName),
    type: account.accountType ?? null,
    role: isLiabilityAccount(account.accountType)
      ? ("liability" as const)
      : ("asset" as const),
    currency: account.currency,
    last4: account.accountLast4 ?? null,
    balance: account.balance ?? null,
    availableBalance: account.availableBalance ?? null,
    asOfAt: account.asOfAt ?? null,
  }));

  const cashEntries: CurrencyEntry[] = [
    ...accounts
      .filter((account) => !isLiabilityAccount(account.accountType))
      .map((account) => ({
        currency: account.currency,
        value: account.balance ?? null,
      })),
    { currency: cashWallet.currency, value: cashWallet.balance },
  ];
  const investmentEntries = holdings.map((holding) => ({
    currency: holding.currency,
    value: sumKnown([holding.marketValue, holding.cashBalance]),
  }));
  const otherEntries = otherAssets.map((asset) => ({
    currency: asset.currency,
    value: asset.value ?? null,
  }));
  const creditEntries = accounts
    .filter((account) => account.accountType === "credit")
    .map((account) => ({
      currency: account.currency,
      value: account.balance == null ? null : Math.abs(account.balance),
    }));
  const loanEntries = accounts
    .filter((account) => account.accountType === "loan")
    .map((account) => ({
      currency: account.currency,
      value: account.balance == null ? null : Math.abs(account.balance),
    }));
  const cashValues = aggregateCurrencyValues(cashEntries, ratesByCurrency);
  const investmentValues = aggregateCurrencyValues(
    investmentEntries,
    ratesByCurrency,
  );
  const otherValues = aggregateCurrencyValues(otherEntries, ratesByCurrency);
  const creditValues = aggregateCurrencyValues(creditEntries, ratesByCurrency);
  const loanValues = aggregateCurrencyValues(loanEntries, ratesByCurrency);
  const assetsTotalTwd = sumTwdValues([
    cashValues,
    investmentValues,
    otherValues,
  ]);
  const liabilitiesTotalTwd = sumTwdValues([creditValues, loanValues]);
  const hasCurrentData =
    accounts.length > 0 ||
    holdings.length > 0 ||
    otherAssets.length > 0 ||
    cashWallet.openingBalance !== 0 ||
    cashWallet.balance !== 0;
  const currentNetWorth =
    hasCurrentData && assetsTotalTwd !== null && liabilitiesTotalTwd !== null
      ? assetsTotalTwd - liabilitiesTotalTwd
      : null;
  const missingExchangeRates = [
    ...new Set(
      [
        ...cashEntries,
        ...investmentEntries,
        ...otherEntries,
        ...creditEntries,
        ...loanEntries,
      ]
        .map((entry) => entry.currency)
        .filter(
          (currency) => currency !== "TWD" && !ratesByCurrency.has(currency),
        ),
    ),
  ].sort();
  const missingValuations =
    holdings.filter((holding) => holding.valuationStatus === "missing").length +
    otherAssets.filter((asset) => asset.value == null).length;
  const latestDataAt = {
    accounts: maxDate(accounts.map((account) => account.asOfAt)),
    holdings: maxDate(holdings.map((holding) => holding.asOfDate)),
    otherAssets: maxDate(
      otherAssets.flatMap((asset) => [asset.date, asset.marketPriceAsOf]),
    ),
    exchangeRates: maxDate(rates.map((rate) => rate.updatedAt)),
  };
  const decisionSignals = buildDecisionSignals(
    investmentTransactions,
    allManualAssets,
  );

  return {
    schema: "taiwan-fin-hub.ai-financial-context",
    schemaVersion: 1,
    generatedAt,
    baseCurrency: "TWD",
    period: {
      from: period.from,
      to: period.to,
      days: daysBetween(period.from, period.to) + 1,
    },
    instructionsForAi: [
      "所有金額保留原始幣別；valueTwd 為依匯率換算的參考值，null 代表無法可靠換算。",
      "spending.byCategory 與 spending.byMonth 已排除資產轉移、信用卡繳款等不應重複計算的項目。",
      "investments.decisionSignals 是依交易代碼／名稱推定的觀察，不是使用者明確寫下的投資理由。",
      "不要把缺少估值或被標記為 excludedFromCalculation 的資料當成零。",
    ],
    summary: {
      assets: {
        cash: cashValues,
        investments: investmentValues,
        other: otherValues,
        totalTwd: assetsTotalTwd,
      },
      liabilities: {
        creditCards: creditValues,
        loans: loanValues,
        totalTwd: liabilitiesTotalTwd,
      },
      cashWallet: {
        currency: cashWallet.currency,
        balance: cashWallet.balance,
        openingBalance: cashWallet.openingBalance,
        cashWithdrawals: cashWallet.cashWithdrawals,
        cashExpenses: cashWallet.cashExpenses,
      },
      netWorthEstimateTwd: currentNetWorth,
      valuationStatus:
        currentNetWorth === null
          ? "unavailable"
          : missingExchangeRates.length > 0 || missingValuations > 0
            ? "partial"
            : "complete",
      cashFlow: spending.byCurrency,
    },
    accounts: accountOutput,
    spending: spending.output,
    investments: {
      holdings,
      transactions: investmentOutputTransactions,
      decisionSignals,
      totals: {
        marketValue: aggregateCurrencyValues(
          holdings.map((holding) => ({
            currency: holding.currency,
            value: holding.marketValue,
          })),
          ratesByCurrency,
        ),
        costBasis: aggregateCurrencyValues(
          holdings.map((holding) => ({
            currency: holding.currency,
            value: holding.costBasis,
          })),
          ratesByCurrency,
        ),
        unrealizedPnl: aggregateCurrencyValues(
          holdings.map((holding) => ({
            currency: holding.currency,
            value: holding.unrealizedPnl,
          })),
          ratesByCurrency,
        ),
      },
    },
    dataQuality: {
      sourceCounts: {
        accounts: accounts.length,
        bankTransactions: bankTransactions.length,
        invoices: invoices.length,
        investmentTransactions: investmentTransactions.length,
        holdings: holdings.length,
        otherAssets: otherAssets.length,
      },
      latestDataAt,
      missingExchangeRates,
      missingValuations,
      truncated,
      omittedSensitiveFields: [
        "銀行帳號完整號碼、sourceId、connectorId",
        "券商帳號、券商內部帳戶代號與 rawPayload",
      ],
      limitations: [
        "目前資料庫沒有逐筆保存使用者的投資決策理由、風險承受度或目標價。",
        ...(truncated
          ? [
              `活動明細超過 ${MAX_ACTIVITY_RECORDS} 筆，僅輸出最新 ${MAX_ACTIVITY_RECORDS} 筆；彙總仍以完整查詢結果計算。`,
            ]
          : []),
      ],
    },
  };
}

function buildSpending(activities: ActivityItem[], truncated: boolean) {
  const categoryMap = new Map<
    string,
    {
      categoryId: string;
      category: string;
      currency: string;
      amount: number;
      transactionCount: number;
    }
  >();
  const merchantMap = new Map<
    string,
    {
      merchant: string;
      currency: string;
      amount: number;
      transactionCount: number;
    }
  >();
  const monthMap = new Map<
    string,
    {
      month: string;
      currency: string;
      income: number;
      expenses: number;
      investmentContributions: number;
      investmentIncome: number;
      transfers: number;
      netCashFlow: number;
    }
  >();
  const currencyMap = new Map<
    string,
    {
      currency: string;
      income: number;
      expenses: number;
      investmentContributions: number;
      investmentIncome: number;
      transfers: number;
      netCashFlow: number;
    }
  >();
  const transactions = activities
    .filter((item) => item.source !== "investment")
    .map((item) => {
      const type = activityCashFlowType(item);
      const amount = activityDisplayAmount(item);
      const flow = flowForActivity(type);
      const currency = item.currency;
      const date = financialDate(item.date);
      const signedAmount = amount ?? 0;
      const expense =
        type === "expense" && signedAmount < 0 && !item.excludedFromCalculation;
      const income =
        type === "income" && signedAmount > 0 && !item.excludedFromCalculation;
      const investmentContribution =
        type === "investment_expense" && signedAmount < 0;
      const investmentIncome = type === "investment_income" && signedAmount > 0;
      const transfer = type === "asset_transfer";
      const magnitude = Math.abs(signedAmount);
      if (expense) {
        const parts =
          item.categoryParts?.filter(
            (part) => part.behavior === "normal" && part.amount > 0,
          ) ?? [];
        if (parts.length > 0) {
          for (const part of parts)
            addCategory(
              categoryMap,
              part.categoryId,
              part.category,
              currency,
              part.amount,
            );
        } else {
          addCategory(
            categoryMap,
            item.categoryId ?? "other",
            item.category,
            currency,
            magnitude,
          );
        }
        addMerchant(merchantMap, item.title, currency, magnitude);
      }
      const monthly = getMonthEntry(monthMap, date.slice(0, 7), currency);
      const byCurrency = getCurrencyEntry(currencyMap, currency);
      if (expense) {
        monthly.expenses += magnitude;
        byCurrency.expenses += magnitude;
      }
      if (income) {
        monthly.income += signedAmount;
        byCurrency.income += signedAmount;
      }
      if (investmentContribution) {
        monthly.investmentContributions += magnitude;
        byCurrency.investmentContributions += magnitude;
      }
      if (investmentIncome) {
        monthly.investmentIncome += signedAmount;
        byCurrency.investmentIncome += signedAmount;
      }
      if (transfer) {
        monthly.transfers += magnitude;
        byCurrency.transfers += magnitude;
      }
      monthly.netCashFlow =
        monthly.income -
        monthly.expenses -
        monthly.investmentContributions +
        monthly.investmentIncome;
      byCurrency.netCashFlow =
        byCurrency.income -
        byCurrency.expenses -
        byCurrency.investmentContributions +
        byCurrency.investmentIncome;
      return {
        date,
        source: item.source as "bank" | "card" | "invoice",
        flow,
        description: maskSensitiveText(item.title) ?? "未命名活動",
        category: item.category,
        categoryId: item.categoryId ?? "other",
        amount: amount ?? null,
        currency,
        excludedFromCalculation: Boolean(item.excludedFromCalculation),
        classificationSource: item.classificationSource ?? null,
      };
    });
  return {
    byCurrency: [...currencyMap.values()].sort((left, right) =>
      left.currency.localeCompare(right.currency),
    ),
    output: {
      byCategory: [...categoryMap.values()].sort(
        (left, right) => right.amount - left.amount,
      ),
      byMonth: [...monthMap.values()].sort(
        (left, right) =>
          left.month.localeCompare(right.month) ||
          left.currency.localeCompare(right.currency),
      ),
      topMerchants: [...merchantMap.values()]
        .sort((left, right) => right.amount - left.amount)
        .slice(0, 20),
      transactions: truncated
        ? transactions.slice(0, MAX_ACTIVITY_RECORDS)
        : transactions,
    },
  };
}

function buildDecisionSignals(
  transactions: Awaited<ReturnType<typeof getInvestmentTransactionsRange>>,
  otherAssets: Awaited<ReturnType<typeof listManualAssets>>,
) {
  return {
    observations: transactions.map((transaction) => {
      const inference = inferInvestmentDecision(
        transaction.transactionCode,
        transaction.transactionName,
      );
      return {
        date: financialDate(transaction.tradeDate ?? transaction.postedDate),
        decision: inference.decision,
        confidence: inference.confidence,
        symbol: transaction.symbol ?? null,
        name: transaction.name ?? null,
        evidence: {
          transactionCode: transaction.transactionCode ?? null,
          transactionName: transaction.transactionName ?? null,
        },
        amount: transaction.amount ?? null,
        currency: transaction.currency,
      };
    }),
    manualNotes: otherAssets
      .filter((asset) => asset.category === "us_stock" && asset.note)
      .map((asset) => ({
        symbol: asset.symbol ?? null,
        name: asset.name,
        note: maskSensitiveText(asset.note) ?? "",
      })),
    limitations: [
      "buy／sell／dividend／fee 僅由同步來源的交易代碼或交易名稱推定。",
      "若要讓 AI 理解真正的投資理由，請在持倉備註或未來的投資日誌中補充背景、目標與風險。",
    ],
  };
}

function inferInvestmentDecision(code?: string | null, name?: string | null) {
  const text = `${code ?? ""} ${name ?? ""}`.toLocaleLowerCase("zh-TW");
  if (/買|申購|認購|定期定額|buy|purchase/u.test(text))
    return { decision: "buy" as const, confidence: "high" as const };
  if (/賣|贖回|sell|redeem/u.test(text))
    return { decision: "sell" as const, confidence: "high" as const };
  if (/股利|股息|配息|dividend/u.test(text))
    return { decision: "dividend" as const, confidence: "high" as const };
  if (/手續費|交易稅|證交稅|佣金|fee|tax/u.test(text))
    return { decision: "fee" as const, confidence: "medium" as const };
  return { decision: "other" as const, confidence: "low" as const };
}

function flowForActivity(
  type: ReturnType<typeof activityCashFlowType>,
): "income" | "expense" | "investment" | "transfer" {
  if (type === "income") return "income";
  if (type === "investment_income" || type === "investment_expense")
    return "investment";
  if (type === "asset_transfer") return "transfer";
  return "expense";
}

function addCategory(
  map: Map<
    string,
    {
      categoryId: string;
      category: string;
      currency: string;
      amount: number;
      transactionCount: number;
    }
  >,
  categoryId: string,
  category: string,
  currency: string,
  amount: number,
) {
  const key = `${categoryId}\u0000${currency}`;
  const current = map.get(key) ?? {
    categoryId,
    category,
    currency,
    amount: 0,
    transactionCount: 0,
  };
  current.amount += amount;
  current.transactionCount += 1;
  map.set(key, current);
}

function addMerchant(
  map: Map<
    string,
    {
      merchant: string;
      currency: string;
      amount: number;
      transactionCount: number;
    }
  >,
  merchant: string,
  currency: string,
  amount: number,
) {
  const safeMerchant = maskSensitiveText(merchant) ?? "未命名商家";
  const key = `${safeMerchant}\u0000${currency}`;
  const current = map.get(key) ?? {
    merchant: safeMerchant,
    currency,
    amount: 0,
    transactionCount: 0,
  };
  current.amount += amount;
  current.transactionCount += 1;
  map.set(key, current);
}

function getMonthEntry(
  map: Map<
    string,
    {
      month: string;
      currency: string;
      income: number;
      expenses: number;
      investmentContributions: number;
      investmentIncome: number;
      transfers: number;
      netCashFlow: number;
    }
  >,
  month: string,
  currency: string,
) {
  const key = `${month}\u0000${currency}`;
  const current = map.get(key) ?? {
    month,
    currency,
    income: 0,
    expenses: 0,
    investmentContributions: 0,
    investmentIncome: 0,
    transfers: 0,
    netCashFlow: 0,
  };
  map.set(key, current);
  return current;
}

function getCurrencyEntry(
  map: Map<
    string,
    {
      currency: string;
      income: number;
      expenses: number;
      investmentContributions: number;
      investmentIncome: number;
      transfers: number;
      netCashFlow: number;
    }
  >,
  currency: string,
) {
  const current = map.get(currency) ?? {
    currency,
    income: 0,
    expenses: 0,
    investmentContributions: 0,
    investmentIncome: 0,
    transfers: 0,
    netCashFlow: 0,
  };
  map.set(currency, current);
  return current;
}

function aggregateCurrencyValues(
  entries: CurrencyEntry[],
  rates: ReadonlyMap<string, number>,
) {
  const groups = new Map<string, { value: number; unknown: boolean }>();
  for (const entry of entries) {
    const current = groups.get(entry.currency) ?? { value: 0, unknown: false };
    if (entry.value === null) current.unknown = true;
    else current.value += entry.value;
    groups.set(entry.currency, current);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, entry]) => ({
      currency,
      value: entry.unknown ? null : entry.value,
      valueTwd: entry.unknown ? null : toTwd(entry.value, currency, rates),
    }));
}

function sumTwdValues(groups: Array<Array<{ valueTwd: number | null }>>) {
  const values = groups.flat().map((entry) => entry.valueTwd);
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function toTwd(
  value: number,
  currency: string,
  rates: ReadonlyMap<string, number>,
) {
  if (currency === "TWD") return value;
  const rate = rates.get(currency);
  return rate === undefined ? null : Math.round(value * rate * 100) / 100;
}

function sumKnown(values: Array<number | null>) {
  if (values.every((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function isLiabilityAccount(accountType?: string | null) {
  return accountType === "credit" || accountType === "loan";
}

function maskSensitiveText(value?: string | null) {
  if (!value) return value ?? null;
  return value.replace(/(?<!\d)(?:\d[\s-]?){8,}(?!\d)/gu, "[已遮罩帳號]");
}

function maxDate(values: Array<string | null | undefined>) {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  );
}

function financialDate(value?: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}/u.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : taipeiDateFormatter.format(parsed);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}
