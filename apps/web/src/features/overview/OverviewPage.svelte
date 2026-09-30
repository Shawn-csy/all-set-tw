<script lang="ts">
  import { toStore } from "svelte/store";
  import {
    ChartNoAxesCombined,
    ChevronRight,
    CreditCard,
    RefreshCw,
  } from "@lucide/svelte";
  import { createQuery } from "@tanstack/svelte-query";
  import {
    activityCashFlow,
    activityDisplayAmount,
    buildActivityItems,
    isLikelyInvestmentCashFlow,
    type ActivityItem,
  } from "@taiwan-fin-hub/core";
  import Button from "@/shared/ui/Button.svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import Select from "@/shared/ui/Select.svelte";
  import TabsList from "@/shared/ui/TabsList.svelte";
  import TabsTrigger from "@/shared/ui/TabsTrigger.svelte";
  import type { ApiClient } from "@/shared/api/client";
  import {
    exchangeRatesQuery,
    manualAssetsQuery,
    cashWalletQuery,
  } from "@/data/assets/queries";
  import { bankRangeQuery } from "@/data/bank/queries";
  import { syncJobsQuery } from "@/data/connectors/queries";
  import type { ConnectorId } from "@/data/connectors/types";
  import {
    getActionableSyncJobs,
    getConfiguredSyncJobs,
    getHealthySyncJobs,
    getPendingSyncJobs,
  } from "@/data/connectors/sync-status";
  import {
    investmentsQuery,
    investmentTransactionsRangeQuery,
  } from "@/data/investments/queries";
  import { classifyInvestmentTransaction } from "@/data/investments/transaction-kind";
  import type {
    InvestmentRow,
    InvestmentTransactionRow,
  } from "@/data/investments/types";
  import {
    deduplicateBankTransactions,
    matchInvoicesToTransactions,
  } from "@/data/activity/matching";
  import type { BankTransactionRow } from "@/data/bank/types";
  import {
    invoiceTransactionMappingsQuery,
    invoicePaymentAccountRulesQuery,
    invoicePaymentAccountsQuery,
    invoicesRangeQuery,
  } from "@/data/invoices/queries";
  import {
    calculateMonthlyActivityTotals,
    calculateMonthlyExpenseCategories,
  } from "@/data/activity/monthly-totals";
  import type { View } from "@/app/types";
  import {
    formatCompactTwd,
    formatCurrency,
    formatDate,
    missingExchangeRateCurrencies,
    rateMap,
  } from "@/shared/format/financial";
  import {
    monthRangeCoveringDates,
    persistSalaryDay,
    previousCalendarMonthDateRange,
    previousSalaryCycleDateRange,
    readSalaryDay,
    salaryCycleDateRange,
    salaryDayLabel,
    type CalendarDateRange,
  } from "@/shared/date-range";

  type InsightTone = "coral" | "amber" | "moss" | "steel";
  type InsightIcon = "sync" | "card" | "cashflow";

  interface OverviewInsight {
    id: string;
    title: string;
    detail: string;
    tone: InsightTone;
    icon: InsightIcon;
    view: View;
    connectorId?: ConnectorId;
  }

  interface SpendingCategoryRow {
    category: string;
    amount: number;
    previousAmount: number;
  }

  interface SpendingDetail {
    id: string;
    key: string;
    date?: string;
    title: string;
    subtitle: string;
    amount: number;
    count: number;
  }

  interface SpendingComparisonRow {
    key: string;
    current?: SpendingDetail;
    previous?: SpendingDetail;
  }

  let {
    api,
    navigate,
  }: {
    api: ApiClient;
    navigate: (view: View, connectorId?: ConnectorId) => void;
  } = $props();

  type OverviewPeriod = "calendar" | "salary";
  const overviewNow = new Date();
  const monthKey = `${overviewNow.getFullYear()}-${String(overviewNow.getMonth() + 1).padStart(2, "0")}`;
  const calendarDateRange: CalendarDateRange = {
    from: `${monthKey}-01`,
    to: `${monthKey}-${String(overviewNow.getDate()).padStart(2, "0")}`,
  };
  let overviewPeriod = $state<OverviewPeriod>("salary");
  let salaryDay = $state(String(readSalaryDay()));
  const periodDateRange = $derived(
    overviewPeriod === "salary"
      ? salaryCycleDateRange(overviewNow, Number(salaryDay))
      : calendarDateRange,
  );
  const previousPeriodDateRange = $derived(
    overviewPeriod === "salary"
      ? previousSalaryCycleDateRange(overviewNow, Number(salaryDay))
      : previousCalendarMonthDateRange(overviewNow),
  );
  const overviewDataDateRange = $derived({
    from:
      previousPeriodDateRange.from < periodDateRange.from
        ? previousPeriodDateRange.from
        : periodDateRange.from,
    to:
      previousPeriodDateRange.to > periodDateRange.to
        ? previousPeriodDateRange.to
        : periodDateRange.to,
  });
  const periodMonthRange = $derived(
    monthRangeCoveringDates(overviewDataDateRange),
  );
  const overviewCache = {
    staleTime: 5 * 60 * 1_000,
    gcTime: 30 * 60 * 1_000,
  };
  const monthlyBank = createQuery(
    toStore(() => ({
      ...bankRangeQuery(() => api, periodMonthRange),
      ...overviewCache,
    })),
  );
  const investments = createQuery({
    ...investmentsQuery(() => api),
    ...overviewCache,
  });
  const monthlyInvestmentTrades = createQuery(
    toStore(() => ({
      ...investmentTransactionsRangeQuery(() => api, periodMonthRange),
      ...overviewCache,
    })),
  );
  const monthlyInvoices = createQuery(
    toStore(() => ({
      ...invoicesRangeQuery(() => api, periodMonthRange),
      ...overviewCache,
    })),
  );
  const invoiceMappings = createQuery({
    ...invoiceTransactionMappingsQuery(() => api),
    ...overviewCache,
  });
  const invoicePaymentAccountRules = createQuery({
    ...invoicePaymentAccountRulesQuery(() => api),
    ...overviewCache,
  });
  const invoicePaymentAccounts = createQuery({
    ...invoicePaymentAccountsQuery(() => api),
    ...overviewCache,
  });
  const manualAssets = createQuery({
    ...manualAssetsQuery(() => api),
    ...overviewCache,
  });
  const cashWallet = createQuery({
    ...cashWalletQuery(() => api),
    ...overviewCache,
  });
  const rates = createQuery({
    ...exchangeRatesQuery(() => api),
    ...overviewCache,
  });
  const jobs = createQuery(syncJobsQuery(() => api));

  const bankData = $derived(
    $monthlyBank.data ?? { accounts: [], transactions: [] },
  );
  function inDateRange(value: string | undefined, range: CalendarDateRange) {
    const date = value?.slice(0, 10);
    return Boolean(date && date >= range.from && date <= range.to);
  }
  function inPeriod(value: string | undefined) {
    return inDateRange(value, periodDateRange);
  }
  function inPreviousPeriod(value: string | undefined) {
    return inDateRange(value, previousPeriodDateRange);
  }
  const periodBankData = $derived({
    accounts: bankData.accounts,
    transactions: bankData.transactions.filter((transaction) =>
      inPeriod(transaction.postedDate ?? transaction.authorizedAt),
    ),
  });
  const previousBankData = $derived({
    accounts: bankData.accounts,
    transactions: bankData.transactions.filter((transaction) =>
      inPreviousPeriod(transaction.postedDate ?? transaction.authorizedAt),
    ),
  });
  const periodInvoices = $derived(
    ($monthlyInvoices.data ?? []).filter((invoice) =>
      inPeriod(invoice.invoiceDate),
    ),
  );
  const periodInvestmentTrades = $derived(
    ($monthlyInvestmentTrades.data ?? []).filter((trade) =>
      inPeriod(trade.postedDate ?? trade.tradeDate),
    ),
  );
  const previousInvoices = $derived(
    ($monthlyInvoices.data ?? []).filter((invoice) =>
      inPreviousPeriod(invoice.invoiceDate),
    ),
  );
  const previousInvestmentTrades = $derived(
    ($monthlyInvestmentTrades.data ?? []).filter((trade) =>
      inPreviousPeriod(trade.postedDate ?? trade.tradeDate),
    ),
  );
  const rateValues = $derived(rateMap($rates.data));
  const toTwd = (value: number, currency: string) =>
    currency === "TWD" ? value : value * (rateValues[currency] ?? 0);
  const deposits = $derived(
    bankData.accounts.filter((account) => account.accountType !== "credit"),
  );
  const cards = $derived(
    bankData.accounts.filter((account) => account.accountType === "credit"),
  );
  const depositTotal = $derived(
    deposits.reduce(
      (sum, account) => sum + toTwd(account.balance ?? 0, account.currency),
      0,
    ),
  );
  const cashBalance = $derived($cashWallet.data?.balance ?? 0);
  const bankAndCashTotal = $derived(depositTotal + cashBalance);
  const cardDebt = $derived(
    cards.reduce(
      (sum, account) =>
        sum + Math.abs(toTwd(account.balance ?? 0, account.currency)),
      0,
    ),
  );
  const investmentMarketValue = $derived(
    ($investments.data ?? []).reduce(
      (sum, item) => sum + toTwd(item.marketValue ?? 0, item.currency),
      0,
    ),
  );
  const investmentCash = $derived(
    ($investments.data ?? []).reduce(
      (sum, item) => sum + toTwd(item.cashBalance ?? 0, item.currency),
      0,
    ),
  );
  const manualInvestmentHoldings = $derived(
    ($investments.data ?? []).filter(
      (item): item is InvestmentRow =>
        item.isManual === true &&
        Boolean(item.symbol) &&
        item.quantity != null &&
        item.costPerShare != null &&
        item.quantity > 0 &&
        item.costPerShare > 0,
    ),
  );
  const investmentTotal = $derived(investmentMarketValue + investmentCash);
  const manualTotal = $derived(
    ($manualAssets.data ?? []).reduce(
      (sum, item) => sum + toTwd(item.value ?? 0, item.currency),
      0,
    ),
  );
  const gross = $derived(bankAndCashTotal + investmentTotal + manualTotal);
  const netWorth = $derived(gross - cardDebt);
  const allocation = $derived([
    {
      label: "銀行與現金",
      value: bankAndCashTotal,
      detail: `${deposits.length} 個帳戶 · 現金 ${formatCompactTwd(cashBalance)}`,
    },
    {
      label: "投資",
      value: investmentTotal,
      detail: `${$investments.data?.length ?? 0} 個持倉`,
    },
    {
      label: "其他資產",
      value: manualTotal,
      detail: "保險、房產",
    },
  ]);
  const monthlyTotals = $derived(
    calculateMonthlyActivityTotals(
      periodBankData,
      periodInvoices,
      $invoiceMappings.data ?? [],
      rateValues,
      periodInvestmentTrades,
      $invoicePaymentAccountRules.data ?? [],
      $invoicePaymentAccounts.data ?? [],
    ),
  );
  const previousMonthlyTotals = $derived(
    calculateMonthlyActivityTotals(
      previousBankData,
      previousInvoices,
      $invoiceMappings.data ?? [],
      rateValues,
      previousInvestmentTrades,
      $invoicePaymentAccountRules.data ?? [],
      $invoicePaymentAccounts.data ?? [],
    ),
  );
  const monthlyIncome = $derived(monthlyTotals.income);
  const monthlyExpense = $derived(monthlyTotals.expense);
  const monthlyNet = $derived(monthlyIncome - monthlyExpense);
  const monthlyOrdinaryIncome = $derived(monthlyTotals.ordinaryIncome);
  const monthlyOrdinaryExpense = $derived(monthlyTotals.ordinaryExpense);
  const expenseCategories = $derived(
    calculateMonthlyExpenseCategories(
      periodBankData,
      periodInvoices,
      $invoiceMappings.data ?? [],
      rateValues,
      periodInvestmentTrades,
      $invoicePaymentAccountRules.data ?? [],
      $invoicePaymentAccounts.data ?? [],
    ),
  );
  const investmentSummary = $derived({
    invested: monthlyTotals.investmentExpense,
    returned: monthlyTotals.investmentIncome,
  });
  const previousInvestmentSummary = $derived({
    invested: previousMonthlyTotals.investmentExpense,
    returned: previousMonthlyTotals.investmentIncome,
  });
  const previousExpenseCategories = $derived(
    calculateMonthlyExpenseCategories(
      previousBankData,
      previousInvoices,
      $invoiceMappings.data ?? [],
      rateValues,
      previousInvestmentTrades,
      $invoicePaymentAccountRules.data ?? [],
      $invoicePaymentAccounts.data ?? [],
    ),
  );
  const spendingCategories = $derived.by(() => {
    const current = new Map(
      expenseCategories.map((item) => [item.category, item.amount]),
    );
    const previous = new Map(
      previousExpenseCategories.map((item) => [item.category, item.amount]),
    );
    const names = new Set([...current.keys(), ...previous.keys()]);

    return [...names]
      .map((category): SpendingCategoryRow => ({
        category,
        amount: current.get(category) ?? 0,
        previousAmount: previous.get(category) ?? 0,
      }))
      .filter((item) => item.amount > 0 || item.previousAmount > 0)
      .sort(
        (left, right) =>
          right.amount - left.amount ||
          right.previousAmount - left.previousAmount,
      );
  });
  const investmentCategories = $derived([
    ...(investmentSummary.invested > 0 || previousInvestmentSummary.invested > 0
      ? [
          {
            category: "投資投入",
            amount: investmentSummary.invested,
            previousAmount: previousInvestmentSummary.invested,
          },
        ]
      : []),
    ...(investmentSummary.returned > 0 || previousInvestmentSummary.returned > 0
      ? [
          {
            category: "投資收入",
            amount: investmentSummary.returned,
            previousAmount: previousInvestmentSummary.returned,
          },
        ]
      : []),
  ]);
  const displaySpendingCategories = $derived([
    ...spendingCategories,
    ...investmentCategories,
  ]);
  const largestSpendingCategory = $derived(
    Math.max(...spendingCategories.map((item) => item.amount), 1),
  );
  let expandedSpendingCategory = $state<string | null>(null);
  let spendingDetailSearch = $state("");
  const activityAccounts = $derived(
    new Map(periodBankData.accounts.map((account) => [account.id, account])),
  );
  const activityBankTransactions = $derived(
    deduplicateBankTransactions(
      periodBankData.transactions.map((transaction) => ({
        ...transaction,
        accountType:
          transaction.accountType ??
          activityAccounts.get(transaction.accountId)?.accountType,
      })),
    ),
  );
  const activityInvoiceMatches = $derived(
    matchInvoicesToTransactions(
      activityBankTransactions,
      periodInvoices,
      $invoiceMappings.data ?? [],
      $invoicePaymentAccountRules.data ?? [],
      $invoicePaymentAccounts.data ?? [],
    ),
  );
  const overviewActivityItems = $derived(
    buildActivityItems(
      activityBankTransactions,
      periodInvoices,
      periodInvestmentTrades,
      activityAccounts,
      activityInvoiceMatches,
    ),
  );
  const previousActivityAccounts = $derived(
    new Map(previousBankData.accounts.map((account) => [account.id, account])),
  );
  const previousActivityBankTransactions = $derived(
    deduplicateBankTransactions(
      previousBankData.transactions.map((transaction) => ({
        ...transaction,
        accountType:
          transaction.accountType ??
          previousActivityAccounts.get(transaction.accountId)?.accountType,
      })),
    ),
  );
  const previousActivityInvoiceMatches = $derived(
    matchInvoicesToTransactions(
      previousActivityBankTransactions,
      previousInvoices,
      $invoiceMappings.data ?? [],
      $invoicePaymentAccountRules.data ?? [],
      $invoicePaymentAccounts.data ?? [],
    ),
  );
  const previousOverviewActivityItems = $derived(
    buildActivityItems(
      previousActivityBankTransactions,
      previousInvoices,
      previousInvestmentTrades,
      previousActivityAccounts,
      previousActivityInvoiceMatches,
    ),
  );
  function spendingDetailKey(title: string) {
    return title.trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-TW");
  }
  function investmentDateKey(value?: string) {
    return value?.slice(0, 10);
  }
  function investmentText(value?: string) {
    return (value ?? "")
      .replace(/[\s\-_/．。・]/gu, "")
      .toLocaleLowerCase("zh-TW");
  }
  function investmentTradeMatches(
    transaction: BankTransactionRow,
    trades: InvestmentTransactionRow[],
  ) {
    const transactionDates = new Set(
      [transaction.postedDate, transaction.authorizedAt]
        .map(investmentDateKey)
        .filter((value): value is string => Boolean(value)),
    );
    const sameDateTrades = trades.filter((trade) =>
      [trade.tradeDate, trade.postedDate].some((date) =>
        transactionDates.has(investmentDateKey(date) ?? ""),
      ),
    );
    const directionalTrades = sameDateTrades.filter((trade) => {
      const kind = classifyInvestmentTransaction(trade);
      return transaction.amount < 0
        ? kind === "buy"
        : kind === "sell" || kind === "redemption" || kind === "income";
    });
    const text = investmentText(
      [
        transaction.description,
        transaction.counterparty,
        transaction.sourceSummary,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const symbolMatches = directionalTrades.filter((trade) =>
      [trade.symbol, trade.name]
        .map(investmentText)
        .some(
          (identifier) => identifier.length >= 2 && text.includes(identifier),
        ),
    );
    const hasSpecificSecurity = /\d{4,6}/u.test(text);
    return symbolMatches.length > 0 || hasSpecificSecurity
      ? symbolMatches
      : directionalTrades;
  }
  function investmentDirection(
    transaction: BankTransactionRow,
    trade?: InvestmentTransactionRow,
  ) {
    const text = [transaction.description, transaction.counterparty]
      .filter(Boolean)
      .join(" ");
    const kind = trade ? classifyInvestmentTransaction(trade) : undefined;
    if (kind === "sell") return "賣出";
    if (kind === "redemption") return "贖回";
    if (kind === "income") return "配息";
    if (/贖回|回贖/u.test(text)) return "贖回";
    if (kind === "buy" || transaction.amount < 0) return "買進";
    if (transaction.amount > 0) return "投資收入";
    return "投資交易";
  }
  function investmentBankSecurityLabel(transaction: BankTransactionRow) {
    const text = [transaction.description, transaction.counterparty]
      .filter(Boolean)
      .join(" ");
    const symbols = text.match(/\d{4,6}/gu);
    if (symbols?.length)
      return [...new Set(symbols)].join("、").replace(/FUND$/iu, "");

    const description = transaction.description?.trim();
    if (!description) return undefined;
    if (
      /^(?:富邦綜合[－-])?複委託$|^股票$|^證券交割$|^定期定額買台股$/u.test(
        description,
      )
    )
      return undefined;
    return description.replace(/^贖回/u, "").replace(/FUND$/iu, "").trim();
  }
  function isGenericUsStockBankTransaction(transaction: BankTransactionRow) {
    const description = transaction.description?.trim() ?? "";
    const sourceSummary = transaction.sourceSummary?.trim() ?? "";
    return (
      description === "股票" ||
      (/複委託/u.test(description) && !/匯入款/u.test(sourceSummary))
    );
  }
  function manualUsHoldingCandidates(
    transaction: BankTransactionRow,
    holdings: InvestmentRow[],
  ) {
    if (
      transaction.amount >= 0 ||
      !isGenericUsStockBankTransaction(transaction)
    )
      return [];
    return [
      ...new Set(
        holdings
          .filter((holding) => holding.currency === "USD" && holding.symbol)
          .map((holding) => holding.symbol as string),
      ),
    ];
  }
  function manualUsHoldingMatches(
    transaction: BankTransactionRow,
    holdings: InvestmentRow[],
  ) {
    if (
      transaction.amount >= 0 ||
      !isGenericUsStockBankTransaction(transaction)
    )
      return [];
    const transactionAmountTwd = toTwd(
      Math.abs(transaction.amount),
      transaction.currency,
    );
    if (transactionAmountTwd <= 0) return [];
    const candidates = holdings
      .filter(
        (holding) =>
          holding.currency === "USD" &&
          Boolean(holding.symbol) &&
          holding.quantity != null &&
          holding.costPerShare != null &&
          holding.quantity > 0 &&
          holding.costPerShare > 0,
      )
      .map((holding) => {
        const costTwd = toTwd(
          holding.quantity! * holding.costPerShare!,
          holding.currency,
        );
        return {
          holding,
          difference:
            costTwd > 0
              ? Math.abs(transactionAmountTwd - costTwd) /
                Math.max(transactionAmountTwd, costTwd)
              : Number.POSITIVE_INFINITY,
        };
      })
      .filter(({ difference }) => difference <= 0.08)
      .sort((left, right) => left.difference - right.difference);
    return candidates.length === 1 ? [candidates[0]!.holding] : [];
  }
  function investmentDetailTitle(
    transaction: BankTransactionRow,
    trades: InvestmentTransactionRow[],
    manualHoldings: InvestmentRow[],
  ) {
    const matches = investmentTradeMatches(transaction, trades);
    const grouped = new Map<string, string[]>();
    for (const trade of matches) {
      const direction = investmentDirection(transaction, trade);
      const security = trade.symbol ?? trade.name ?? "標的待同步";
      const securities = grouped.get(direction) ?? [];
      if (!securities.includes(security)) securities.push(security);
      grouped.set(direction, securities);
    }
    if (grouped.size > 0) {
      return [...grouped.entries()]
        .map(
          ([direction, securities]) => `${direction} ${securities.join("、")}`,
        )
        .join("／");
    }
    const manualMatches = manualUsHoldingMatches(transaction, manualHoldings);
    if (manualMatches.length === 1 && manualMatches[0]?.symbol)
      return `${investmentDirection(transaction)} ${manualMatches[0].symbol}`;
    if (transaction.amount < 0 && isGenericUsStockBankTransaction(transaction))
      return "買進（待確認美股標的）";
    const bankSecurity = investmentBankSecurityLabel(transaction);
    if (bankSecurity)
      return `${investmentDirection(transaction)} ${bankSecurity}`;
    return `${investmentDirection(transaction)}（標的待同步）`;
  }
  function investmentSpendingDetailsFor(
    transactions: BankTransactionRow[],
    trades: InvestmentTransactionRow[],
    flow: "invested" | "returned",
    manualHoldings: InvestmentRow[],
  ) {
    return transactions
      .filter(
        (transaction) =>
          (flow === "invested"
            ? transaction.amount < 0
            : transaction.amount > 0) &&
          isLikelyInvestmentCashFlow(
            {
              ...transaction,
              categoryId: transaction.classification?.categoryId,
            },
            trades,
          ),
      )
      .map((transaction): SpendingDetail => {
        const matches = investmentTradeMatches(transaction, trades);
        const tradeNames = [
          ...new Set(matches.map((trade) => trade.name).filter(Boolean)),
        ];
        const title = investmentDetailTitle(
          transaction,
          trades,
          manualHoldings,
        );
        const manualCandidates =
          matches.length === 0
            ? manualUsHoldingCandidates(transaction, manualHoldings)
            : [];
        return {
          id: transaction.id,
          key: spendingDetailKey(title),
          date: transaction.postedDate ?? transaction.authorizedAt,
          title,
          subtitle: [
            tradeNames.join("、"),
            manualCandidates.length > 0
              ? `美股持倉供核對：${manualCandidates.join("、")}`
              : undefined,
            transaction.sourceSummary,
            transaction.accountName,
          ]
            .filter(Boolean)
            .join(" · "),
          amount: toTwd(Math.abs(transaction.amount), transaction.currency),
          count: 1,
        };
      });
  }
  const investmentSpendingDetails = $derived(
    investmentSpendingDetailsFor(
      periodBankData.transactions,
      periodInvestmentTrades,
      "invested",
      manualInvestmentHoldings,
    ),
  );
  const previousInvestmentSpendingDetails = $derived(
    investmentSpendingDetailsFor(
      previousBankData.transactions,
      previousInvestmentTrades,
      "invested",
      manualInvestmentHoldings,
    ),
  );
  const investmentReturnDetails = $derived(
    investmentSpendingDetailsFor(
      periodBankData.transactions,
      periodInvestmentTrades,
      "returned",
      manualInvestmentHoldings,
    ),
  );
  const previousInvestmentReturnDetails = $derived(
    investmentSpendingDetailsFor(
      previousBankData.transactions,
      previousInvestmentTrades,
      "returned",
      manualInvestmentHoldings,
    ),
  );
  function activitySpendingDetailsFor(category: string, items: ActivityItem[]) {
    const details: SpendingDetail[] = [];
    for (const item of items) {
      if (activityCashFlow(item) !== "expense") continue;
      if (item.categoryParts?.length) {
        if (item.excludedFromCalculation) continue;
        for (const part of item.categoryParts) {
          if (part.behavior !== "normal" || part.category !== category)
            continue;
          const title = part.description ?? item.title;
          details.push({
            id: `${item.id}-${part.itemId ?? part.categoryId}`,
            key: spendingDetailKey(title),
            date: item.date,
            title,
            subtitle: part.description
              ? [item.title, item.subtitle].filter(Boolean).join(" · ")
              : item.subtitle,
            amount: part.amount,
            count: 1,
          });
        }
        continue;
      }
      if (item.category !== category) continue;
      const amount = activityDisplayAmount(item);
      if (amount == null) continue;
      const title = item.title;
      details.push({
        id: item.id,
        key: spendingDetailKey(title),
        date: item.date,
        title,
        subtitle: item.subtitle,
        amount: toTwd(Math.abs(amount), item.currency),
        count: 1,
      });
    }
    return details;
  }
  function aggregateSpendingDetails(details: SpendingDetail[]) {
    const grouped = new Map<string, SpendingDetail>();
    for (const detail of details) {
      const existing = grouped.get(detail.key);
      if (!existing) {
        grouped.set(detail.key, { ...detail });
        continue;
      }
      existing.amount += detail.amount;
      existing.count += detail.count;
      if (detail.date && (!existing.date || detail.date > existing.date))
        existing.date = detail.date;
      if (existing.subtitle !== detail.subtitle) existing.subtitle = "多個來源";
    }
    return [...grouped.values()].sort(
      (left, right) => right.amount - left.amount,
    );
  }
  const spendingDetails = $derived.by(() => {
    if (!expandedSpendingCategory) return [];
    const details =
      expandedSpendingCategory === "投資投入"
        ? investmentSpendingDetails
        : expandedSpendingCategory === "投資收入"
          ? investmentReturnDetails
          : activitySpendingDetailsFor(
              expandedSpendingCategory,
              overviewActivityItems,
            );
    return aggregateSpendingDetails(details);
  });
  const previousSpendingDetails = $derived.by(() => {
    if (!expandedSpendingCategory) return [];
    const details =
      expandedSpendingCategory === "投資投入"
        ? previousInvestmentSpendingDetails
        : expandedSpendingCategory === "投資收入"
          ? previousInvestmentReturnDetails
          : activitySpendingDetailsFor(
              expandedSpendingCategory,
              previousOverviewActivityItems,
            );
    return aggregateSpendingDetails(details);
  });
  const filteredSpendingDetails = $derived.by(() => {
    const query = spendingDetailSearch.trim().toLocaleLowerCase("zh-TW");
    const filter = (details: SpendingDetail[]) =>
      query
        ? details.filter((item) =>
            `${item.title} ${item.subtitle}`
              .toLocaleLowerCase("zh-TW")
              .includes(query),
          )
        : details;
    return {
      current: filter(spendingDetails),
      previous: filter(previousSpendingDetails),
    };
  });
  const spendingComparisonRows = $derived.by(() => {
    const rows = new Map<string, SpendingComparisonRow>();
    for (const detail of filteredSpendingDetails.current) {
      rows.set(detail.key, { key: detail.key, current: detail });
    }
    for (const detail of filteredSpendingDetails.previous) {
      const row = rows.get(detail.key);
      if (row) row.previous = detail;
      else rows.set(detail.key, { key: detail.key, previous: detail });
    }
    return [...rows.values()].sort(
      (left, right) =>
        Math.max(right.current?.amount ?? 0, right.previous?.amount ?? 0) -
        Math.max(left.current?.amount ?? 0, left.previous?.amount ?? 0),
    );
  });
  function detailStatus(
    current: SpendingDetail | undefined,
    previous: SpendingDetail | undefined,
  ) {
    if (!current) return "本期沒有";
    if (!previous) return "新增";
    const delta = current.amount - previous.amount;
    return delta === 0
      ? "相同"
      : `${delta > 0 ? "高" : "低"} ${formatCurrency(Math.abs(delta))}`;
  }
  function toggleSpendingCategory(category: string) {
    expandedSpendingCategory =
      expandedSpendingCategory === category ? null : category;
    spendingDetailSearch = "";
  }
  function isInvestmentCategory(category: string) {
    return category === "投資投入" || category === "投資收入";
  }
  const spendingSectionName = $derived(
    overviewPeriod === "salary" ? "本期" : "本月已入帳",
  );
  const comparisonPeriodName = $derived(
    overviewPeriod === "salary" ? "前期" : "上月",
  );
  const periodName = $derived(
    overviewPeriod === "salary" ? "本期" : "本月已入帳",
  );
  const periodLabel = $derived(
    overviewPeriod === "salary"
      ? `${periodDateRange.from} 至 ${periodDateRange.to}`
      : `${overviewNow.getFullYear()} 年 ${overviewNow.getMonth() + 1} 月`,
  );
  const syncJobsReady = $derived($jobs.isSuccess);
  const syncJobRows = $derived($jobs.data ?? []);
  const unhealthy = $derived(getActionableSyncJobs(syncJobRows));
  const pendingSyncJobs = $derived(getPendingSyncJobs(syncJobRows));
  const configuredSyncJobs = $derived(getConfiguredSyncJobs(syncJobRows));
  const healthySyncJobs = $derived(getHealthySyncJobs(syncJobRows));
  const staleJobs = $derived(
    syncJobsReady
      ? configuredSyncJobs.filter(
          (job) =>
            job.enabled &&
            !job.running &&
            !unhealthy.some((unhealthyJob) => unhealthyJob.id === job.id) &&
            Boolean(job.lastSuccessAt) &&
            Date.now() - new Date(job.lastSuccessAt!).getTime() >
              48 * 60 * 60 * 1000,
        )
      : [],
  );
  const sourceCount = $derived(configuredSyncJobs.length);
  const healthyCount = $derived(healthySyncJobs.length);
  const insights = $derived.by(() => {
    const items: OverviewInsight[] = [];

    if (!syncJobsReady) {
      items.push({
        id: "sync-status-unavailable",
        title: $jobs.isError ? "無法載入同步狀態" : "正在載入同步狀態",
        detail: $jobs.isError
          ? "目前無法確認資料來源狀態，請稍後再試"
          : "正在讀取資料來源狀態",
        tone: $jobs.isError ? "coral" : "steel",
        icon: "sync",
        view: "data-sources",
      });
    } else if (sourceCount === 0) {
      items.push({
        id: "sync-unconfigured",
        title: "尚未設定資料來源",
        detail: "前往資料來源設定連接器後即可開始同步",
        tone: "steel",
        icon: "sync",
        view: "data-sources",
      });
    } else if (unhealthy.length > 0) {
      items.push({
        id: "sync",
        title: `${unhealthy.length} 個資料來源需要處理`,
        detail: pendingSyncJobs.length
          ? `目前 ${healthyCount} 個來源正常，${pendingSyncJobs.length} 個等待首次同步`
          : `目前 ${healthyCount} / ${sourceCount} 個來源正常`,
        tone: "amber",
        icon: "sync",
        view: "data-sources",
        connectorId: unhealthy[0]?.connectorId,
      });
    } else if (pendingSyncJobs.length > 0) {
      items.push({
        id: "sync-pending",
        title: `${pendingSyncJobs.length} 個資料來源等待首次同步`,
        detail: `目前 ${healthyCount} / ${sourceCount} 個來源正常`,
        tone: "amber",
        icon: "sync",
        view: "data-sources",
        connectorId: pendingSyncJobs[0]?.connectorId,
      });
    }

    if (staleJobs.length > 0) {
      items.push({
        id: "stale-sync",
        title: `${staleJobs.length} 個資料來源超過 48 小時未更新`,
        detail: "重新同步以取得最新的資產與活動資料",
        tone: "steel",
        icon: "sync",
        view: "data-sources",
        connectorId: staleJobs[0]?.connectorId,
      });
    }

    if (monthlyNet < 0) {
      items.push({
        id: "negative-cashflow",
        title: `${periodName}支出高於收入 ${formatCurrency(Math.abs(monthlyNet))}`,
        detail: "查看活動分類，確認主要支出來源",
        tone: "coral",
        icon: "cashflow",
        view: "activity",
      });
    }

    const highCardDebt =
      cardDebt > 0 &&
      (monthlyIncome > 0
        ? cardDebt > monthlyIncome * 0.5
        : depositTotal > 0 && cardDebt > depositTotal * 0.2);

    if (highCardDebt) {
      items.push({
        id: "high-card-debt",
        title: `信用卡負債已達 ${formatCurrency(cardDebt)}`,
        detail:
          monthlyIncome >= cardDebt * 0.1
            ? `約為${periodName}收入的 ${Math.round((cardDebt / monthlyIncome) * 100)}%`
            : `${periodName}收入紀錄較少，請核對負債與收入資料`,
        tone: "coral",
        icon: "card",
        view: "assets",
      });
    }

    return items.slice(0, 2);
  });
  const missingRates = $derived(
    $rates.isSuccess
      ? missingExchangeRateCurrencies(
          [
            ...deposits.map((account) => ({
              currency: account.currency,
              amount: account.balance ?? 0,
            })),
            ...cards.map((account) => ({
              currency: account.currency,
              amount: Math.abs(account.balance ?? 0),
            })),
            ...($investments.data ?? []).map((item) => ({
              currency: item.currency,
              amount: (item.marketValue ?? 0) + (item.cashBalance ?? 0),
            })),
            ...($manualAssets.data ?? []).map((item) => ({
              currency: item.currency,
              amount: item.value ?? 0,
            })),
          ],
          rateValues,
        )
      : [],
  );
  const loading = $derived(
    $monthlyBank.isPending ||
      $monthlyInvoices.isPending ||
      $invoiceMappings.isPending ||
      $invoicePaymentAccountRules.isPending ||
      $invoicePaymentAccounts.isPending ||
      $investments.isPending ||
      $monthlyInvestmentTrades.isPending ||
      $manualAssets.isPending ||
      $cashWallet.isPending,
  );
  const failed = $derived(
    $monthlyBank.isError ||
      $monthlyInvoices.isError ||
      $invoiceMappings.isError ||
      $invoicePaymentAccountRules.isError ||
      $invoicePaymentAccounts.isError ||
      $investments.isError ||
      $monthlyInvestmentTrades.isError ||
      $manualAssets.isError ||
      $cashWallet.isError,
  );
</script>

{#snippet cashFlowDetailsPanel(
  label: string,
  currentAmount: number,
  previousAmount: number,
)}
  <div class="ml-6 mt-1 rounded-lg border border-ink/10 bg-ink/2 p-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-xs font-semibold text-subtle">{label}明細</span>
      <input
        class="h-8 min-w-32 flex-1 rounded-md border border-ink/10 bg-paper px-2 text-xs outline-none placeholder:text-subtle focus:border-steel/50 md:max-w-48"
        type="search"
        placeholder="搜尋商家／品項"
        aria-label={`搜尋${label}明細`}
        bind:value={spendingDetailSearch}
      />
    </div>
    <div class="mt-2">
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="rounded-md bg-paper/70 px-2 py-1.5">
          <span class="font-semibold">{spendingSectionName}</span>
          <span class="ml-2 text-subtle"
            >{filteredSpendingDetails.current.length} 項 · {formatCurrency(
              currentAmount,
            )}</span
          >
        </div>
        <div class="rounded-md bg-paper/70 px-2 py-1.5">
          <span class="font-semibold">{comparisonPeriodName}</span>
          <span class="ml-2 text-subtle"
            >{filteredSpendingDetails.previous.length} 項 · {formatCurrency(
              previousAmount,
            )}</span
          >
        </div>
      </div>
      {#if spendingComparisonRows.length === 0}
        <p class="px-1 py-3 text-xs text-subtle">沒有符合的明細。</p>
      {:else}
        <div class="mt-1 max-h-72 overflow-y-auto">
          {#each spendingComparisonRows as row (row.key)}
            <div class="grid grid-cols-2 gap-2 border-t border-ink/8 text-xs">
              <div class="min-w-0 px-2 py-2">
                {#if row.current}
                  <div class="flex min-w-0 items-center gap-1.5">
                    <p class="truncate font-medium">{row.current.title}</p>
                    {#if !row.previous}
                      <span
                        class="shrink-0 rounded bg-coral/10 px-1 text-[10px] text-coral"
                        >新增</span
                      >
                    {/if}
                  </div>
                  <p class="mt-0.5 truncate text-subtle">
                    {formatDate(row.current.date)}{row.current.subtitle
                      ? ` · ${row.current.subtitle}`
                      : ""}{row.current.count > 1
                      ? ` · ${row.current.count} 筆`
                      : ""}
                  </p>
                  <div class="mt-1 flex items-baseline justify-between gap-2">
                    <strong class="tabular-nums"
                      >{formatCurrency(row.current.amount)}</strong
                    >
                    <span
                      class={`text-[10px] ${detailStatus(row.current, row.previous) === "新增" || detailStatus(row.current, row.previous).startsWith("高") ? "text-coral" : "text-moss"}`}
                      >{detailStatus(row.current, row.previous)}</span
                    >
                  </div>
                {:else}
                  <span class="text-subtle">本期沒有此品項</span>
                {/if}
              </div>
              <div class="min-w-0 px-2 py-2">
                {#if row.previous}
                  <div class="flex min-w-0 items-center gap-1.5">
                    <p class="truncate font-medium">{row.previous.title}</p>
                    {#if !row.current}
                      <span
                        class="shrink-0 rounded bg-ink/8 px-1 text-[10px] text-subtle"
                        >本期沒有</span
                      >
                    {/if}
                  </div>
                  <p class="mt-0.5 truncate text-subtle">
                    {formatDate(row.previous.date)}{row.previous.subtitle
                      ? ` · ${row.previous.subtitle}`
                      : ""}{row.previous.count > 1
                      ? ` · ${row.previous.count} 筆`
                      : ""}
                  </p>
                  <div class="mt-1 flex items-baseline justify-between gap-2">
                    <strong class="tabular-nums"
                      >{formatCurrency(row.previous.amount)}</strong
                    >
                    <span class="text-[10px]"
                      >{row.current ? "相同品項" : "本期沒有"}</span
                    >
                  </div>
                {:else}
                  <span class="text-subtle">前期沒有此品項</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

{#if loading}
  <EmptyState title="載入總覽中" body="正在載入。" />
{:else if failed}
  <EmptyState
    alert
    title="無法載入總覽"
    body="請稍後再試，或確認 Worker API 是否可用。"
  />
{:else}
  <div class="grid min-w-0 gap-3 md:gap-4">
    {#if missingRates.length}
      <div
        class="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        <span
          >資產含外幣（{missingRates.join("、")}）尚未設定匯率，TWD
          總額可能不準確。</span
        >
        <button
          class="shrink-0 font-semibold underline underline-offset-2"
          onclick={() => navigate("settings")}>前往設定</button
        >
      </div>
    {/if}

    <section class="min-w-0 pt-1" aria-label="資金概況">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <h2 class="text-base font-semibold">資金概況</h2>
        </div>
        <p class="text-caption text-subtle">
          {new Intl.DateTimeFormat("zh-TW", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }).format(new Date())}
        </p>
      </div>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
        <TabsList aria-label="首頁現金流期間">
          <TabsTrigger
            active={overviewPeriod === "calendar"}
            onclick={() => (overviewPeriod = "calendar")}
            >本月已入帳</TabsTrigger
          >
          <TabsTrigger
            active={overviewPeriod === "salary"}
            onclick={() => (overviewPeriod = "salary")}>薪資週期</TabsTrigger
          >
        </TabsList>
        <div class="flex flex-wrap items-center gap-2 text-caption text-subtle">
          <span
            >{overviewPeriod === "salary"
              ? "資金週期"
              : "日曆月份"}：{periodLabel}</span
          >
          {#if overviewPeriod === "salary"}
            <details class="relative">
              <summary class="cursor-pointer font-semibold text-steel">
                發薪日：{salaryDayLabel(Number(salaryDay))}
              </summary>
              <div
                class="absolute right-0 z-10 mt-2 grid w-48 gap-2 rounded-xl border border-ink/10 bg-paper p-3 shadow-lg"
              >
                <label
                  class="grid gap-1 text-caption text-subtle"
                  for="overview-salary-day"
                >
                  每月入帳日
                  <Select
                    id="overview-salary-day"
                    class="h-9"
                    bind:value={salaryDay}
                    onchange={() => persistSalaryDay(Number(salaryDay))}
                  >
                    {#each Array.from({ length: 31 }, (_, index) => index + 1) as day}
                      <option value={String(day)}
                        >{day === 31 ? "月底" : `${day} 日`}</option
                      >
                    {/each}
                  </Select>
                </label>
                <p class="text-xs leading-5 text-subtle">
                  31 日會自動套用各月份最後一天。
                </p>
              </div>
            </details>
          {/if}
        </div>
      </div>
      <div class="mt-4 grid grid-cols-3 gap-3 md:gap-5">
        <div class="min-w-0">
          <p class="text-caption text-subtle">
            {overviewPeriod === "salary" ? "本期收入" : "本月收入（已入帳）"}
          </p>
          <p
            class="mt-1 whitespace-nowrap text-lg font-semibold tracking-tight text-moss tabular-nums md:text-2xl"
          >
            +{formatCurrency(monthlyIncome)}
          </p>
          <p class="mt-1 text-[11px] text-subtle">
            一般 {formatCurrency(monthlyOrdinaryIncome)} · 投資收入 {formatCurrency(
              monthlyTotals.investmentIncome,
            )}
          </p>
        </div>
        <div class="min-w-0">
          <p class="text-caption text-subtle">
            {overviewPeriod === "salary" ? "本期支出" : "本月支出（已入帳）"}
          </p>
          <p
            class="mt-1 whitespace-nowrap text-lg font-semibold tracking-tight text-coral tabular-nums md:text-2xl"
          >
            −{formatCurrency(monthlyExpense)}
          </p>
          <p class="mt-1 text-[11px] text-subtle">
            一般 {formatCurrency(monthlyOrdinaryExpense)} · 投資投入 {formatCurrency(
              monthlyTotals.investmentExpense,
            )}
          </p>
        </div>
        <div class="min-w-0">
          <p class="text-caption text-subtle">
            {overviewPeriod === "salary" ? "本期淨流入" : "本月淨流入"}
          </p>
          <p
            class={`mt-1 whitespace-nowrap text-lg font-semibold tracking-tight tabular-nums md:text-2xl ${monthlyNet >= 0 ? "text-moss" : "text-coral"}`}
          >
            {formatCurrency(monthlyNet)}
          </p>
        </div>
      </div>
      <div
        class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink/10 pt-3 text-caption"
      >
        <span class="text-subtle">淨資產</span>
        <strong class="tabular-nums">{formatCurrency(netWorth)}</strong>
        <span class="text-subtle">已扣除信用卡 {formatCurrency(cardDebt)}</span>
        <Button variant="ghost" size="sm" onclick={() => navigate("assets")}
          >查看資產 →</Button
        >
      </div>
    </section>

    <section
      class="min-w-0 border-t border-ink/10 pt-4"
      aria-label="本期分類與投資"
    >
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold">{spendingSectionName}分類</h2>
        </div>
        <Button variant="ghost" size="sm" onclick={() => navigate("activity")}
          >查看全部 →</Button
        >
      </div>
      {#if displaySpendingCategories.length === 0}
        <p class="mt-3 rounded-xl bg-ink/3 px-4 py-3 text-sm text-subtle">
          這個期間目前沒有可辨識的支出分類。
        </p>
      {:else}
        <div class="mt-3 grid min-w-0 gap-x-6 gap-y-2 md:grid-cols-2">
          {#each displaySpendingCategories as item, index (item.category)}
            {#if index === 0 && !isInvestmentCategory(item.category)}
              <div class="md:col-span-2 px-2 pb-1">
                <p class="text-sm font-semibold">一般消費支出</p>
                <p class="mt-0.5 text-xs text-subtle">
                  只包含日常消費與帳務支出。
                </p>
              </div>
            {/if}
            {#if isInvestmentCategory(item.category) && (index === 0 || !isInvestmentCategory(displaySpendingCategories[index - 1]?.category ?? ""))}
              <div class="md:col-span-2 border-t border-ink/10 px-2 pt-3">
                <p class="text-sm font-semibold">本期投資相關</p>
                <p class="mt-0.5 text-xs text-subtle">
                  投入計入支出、收回計入收入，但與一般消費分開列示。
                </p>
              </div>
            {/if}
            <div
              class={`min-w-0 ${isInvestmentCategory(item.category) || expandedSpendingCategory === item.category ? "md:col-span-2" : ""}`}
            >
              <button
                class="group w-full rounded-lg px-2 py-2 text-left transition hover:bg-ink/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel/40"
                aria-expanded={expandedSpendingCategory === item.category}
                onclick={() => toggleSpendingCategory(item.category)}
              >
                <div class="flex items-center justify-between gap-3 text-sm">
                  <span class="flex min-w-0 items-center gap-2">
                    <ChevronRight
                      class={`size-4 shrink-0 text-subtle transition ${expandedSpendingCategory === item.category ? "rotate-90" : ""}`}
                    />
                    <span class="truncate font-medium">{item.category}</span>
                  </span>
                  <strong class="shrink-0 tabular-nums"
                    >{formatCurrency(item.amount)}</strong
                  >
                </div>
                {#if !isInvestmentCategory(item.category)}
                  <div
                    class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/8"
                  >
                    <div
                      class="h-full rounded-full bg-steel"
                      style={`width: ${Math.max(8, (item.amount / largestSpendingCategory) * 100)}%`}
                    ></div>
                  </div>
                {/if}
                <div
                  class="mt-1 flex justify-between gap-2 pl-6 text-xs text-subtle"
                >
                  <span
                    >{comparisonPeriodName}
                    {formatCurrency(item.previousAmount)}</span
                  >
                  <span
                    class={item.amount > item.previousAmount
                      ? "text-coral"
                      : item.amount < item.previousAmount
                        ? "text-moss"
                        : ""}
                    >{item.amount === item.previousAmount
                      ? "相同"
                      : `${item.amount > item.previousAmount ? "高" : "低"} ${formatCurrency(Math.abs(item.amount - item.previousAmount))}`}</span
                  >
                </div>
              </button>
              {#if expandedSpendingCategory === item.category}
                {@render cashFlowDetailsPanel(
                  item.category,
                  item.amount,
                  item.previousAmount,
                )}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    {#if insights.length > 0}
      <section
        class="min-w-0 border-t border-ink/10 pt-4"
        aria-label="待處理事項"
      >
        <h2 class="text-base font-semibold">待處理事項</h2>
        <div class="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
          {#each insights as insight (insight.id)}
            <button
              class="group flex min-h-16 min-w-0 items-center gap-3 rounded-xl border border-ink/10 px-4 py-3 text-left transition hover:border-steel/40 hover:bg-ink/3"
              onclick={() => navigate(insight.view, insight.connectorId)}
            >
              {#if insight.icon === "sync"}
                <RefreshCw
                  class={`size-5 shrink-0 ${insight.tone === "amber" ? "text-amber-600" : "text-steel"}`}
                />
              {:else if insight.icon === "card"}
                <CreditCard class="size-5 shrink-0 text-coral" />
              {:else}
                <ChartNoAxesCombined
                  class={`size-5 shrink-0 ${insight.tone === "moss" ? "text-moss" : "text-coral"}`}
                />
              {/if}
              <span class="min-w-0 flex-1"
                ><span class="block text-sm font-semibold">{insight.title}</span
                ><span class="mt-1 block text-caption text-subtle"
                  >{insight.detail}</span
                ></span
              ><ChevronRight
                class="size-4 shrink-0 text-subtle transition group-hover:translate-x-0.5"
              /></button
            >
          {/each}
        </div>
      </section>
    {/if}

    <section class="min-w-0 border-t border-ink/10 pt-4" aria-label="資產快照">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold">資產快照</h2>
        </div>
        <Button variant="ghost" size="sm" onclick={() => navigate("assets")}
          >管理資產 →</Button
        >
      </div>
      <div class="mt-3 grid grid-cols-3 gap-3 md:gap-5">
        {#each allocation as item (item.label)}
          <div class="min-w-0">
            <p class="text-caption text-subtle">{item.label}</p>
            <p
              class="mt-1 truncate text-lg font-semibold tabular-nums md:text-xl"
            >
              {formatCompactTwd(item.value)}
            </p>
            <p class="mt-1 truncate text-caption text-subtle">{item.detail}</p>
          </div>
        {/each}
      </div>
    </section>
  </div>
{/if}
