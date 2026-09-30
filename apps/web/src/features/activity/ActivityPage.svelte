<script lang="ts">
  import { buildActivityItems } from "@taiwan-fin-hub/core";
  import { onMount, tick } from "svelte";
  import { toStore } from "svelte/store";
  import {
    createMutation,
    createInfiniteQuery,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import {
    Search,
    ArrowDown,
    Check,
    Link2,
    Unlink2,
    ArrowLeft,
    ChevronRight,
    CreditCard,
    X,
  } from "@lucide/svelte";
  import Button from "@/shared/ui/Button.svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import Badge from "@/shared/ui/Badge.svelte";
  import Input from "@/shared/ui/Input.svelte";
  import Select from "@/shared/ui/Select.svelte";
  import TabsList from "@/shared/ui/TabsList.svelte";
  import TabsTrigger from "@/shared/ui/TabsTrigger.svelte";
  import { activitySearchQuery } from "@/data/activity/queries";
  import ActivitySearchFilters from "./components/ActivitySearchFilters.svelte";
  import SearchHighlight from "./components/SearchHighlight.svelte";
  import ActivityAmount from "./components/ActivityAmount.svelte";
  import CategoryUpdateDialog from "./components/CategoryUpdateDialog.svelte";
  import type { ApiClient } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import { exchangeRatesQuery } from "@/data/assets/queries";
  import { bankRangeQuery } from "@/data/bank/queries";
  import type { BankTransactionRow } from "@/data/bank/types";
  import { classificationCategoriesQuery } from "@/data/classification/queries";
  import { classificationMerchantsQuery } from "@/data/classification/queries";
  import type { ClassificationMerchantRow } from "@/data/classification/types";
  import { investmentTransactionsRangeQuery } from "@/data/investments/queries";
  import {
    invoiceDetailQuery,
    invoicePaymentAccountsQuery,
    invoicePaymentAccountRulesQuery,
    invoiceTransactionMappingsQuery,
    invoicesRangeQuery,
  } from "@/data/invoices/queries";
  import type {
    InvoiceSummaryRow,
    InvoiceLineItemRow,
    InvoicePaymentAccountRule,
    InvoicePaymentAccountAssignment,
    InvoiceTransactionPreference,
  } from "@/data/invoices/types";
  import type { ActivityItem, PendingCategoryUpdate } from "./model/types";
  import { compileRulePattern } from "@/shared/classification-rule-pattern";
  import {
    activityDateKey,
    activityStatusLabel,
    currentActivityMonthKey,
    formatActivityDate,
    formatActivityDateGroup,
    formatActivityTime,
    groupActivitiesByDate,
  } from "./model/list";
  import {
    filterActivities,
    type ActivityCategoryFilter,
    type ActivityFlowFilter,
    type ActivitySourceFilter,
  } from "./model/filter";
  import {
    buildActivityCategorySlices,
    activityCashAmountTwd,
    activityCashFlow,
    activityCashFlowType,
    activityDisplayAmount,
    activityAmountTwd,
    isInvestmentCashFlow,
  } from "./model/chart";
  import {
    deduplicateBankTransactions,
    invoiceTransactionDayDifference,
    invoiceTransactionCandidates,
    matchInvoicesToTransactions,
  } from "@/data/activity/matching";
  import { getActivityDataStatus } from "./model/load-status";
  import {
    formatCompactTwd,
    formatCurrency,
    formatDate,
    formatNumber,
    rateMap,
  } from "@/shared/format/financial";
  import {
    monthRangeCoveringDates,
    persistSalaryDay,
    previousSalaryCycleDateRange,
    readSalaryDay,
    recentMonthRange,
    recentMonthKeys,
    salaryCycleDateRange,
    salaryDayLabel,
    type MonthRange,
  } from "@/shared/date-range";
  import { swipeBack } from "@/shared/actions/swipe-back";
  let { api }: { api: ApiClient } = $props();
  const initialSelectedMonth = currentActivityMonthKey();
  // Keep API ranges and month options anchored to the same Taipei month key.
  const activityMonthAnchor = new Date(
    `${initialSelectedMonth}-15T12:00:00+08:00`,
  );
  type TimelinePreset = "current" | "3months" | "6months" | "salary" | "custom";
  type CashFlowSection = "income" | "expense";
  type CashFlowBreakdownKey =
    | "ordinaryIncome"
    | "investmentIncome"
    | "ordinaryExpense"
    | "investmentExpense";
  interface CashFlowDetail {
    key: string;
    date?: string;
    title: string;
    subtitle: string;
    amount: number;
    count: number;
  }
  interface CashFlowComparisonRow {
    key: string;
    current?: CashFlowDetail;
    previous?: CashFlowDetail;
  }
  let timelinePreset = $state<TimelinePreset>("current");
  let timelineFrom = $state(initialSelectedMonth);
  let timelineTo = $state(initialSelectedMonth);
  let salaryDay = $state(String(readSalaryDay()));
  let selectedMonth = $state(initialSelectedMonth);
  const minimumActivityRange = recentMonthRange(6, activityMonthAnchor);
  function monthEnd(month: string) {
    const [year, monthNumber] = month.split("-").map(Number);
    return `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}`;
  }
  function shiftMonthKey(month: string, offset: number) {
    const [year, monthNumber] = month.split("-").map(Number);
    const date = new Date(year, monthNumber - 1 + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  function monthCount(range: MonthRange) {
    const [fromYear, fromMonth] = range.from.split("-").map(Number);
    const [toYear, toMonth] = range.to.split("-").map(Number);
    return Math.max(1, (toYear - fromYear) * 12 + toMonth - fromMonth + 1);
  }
  function monthKeysBetween(range: MonthRange) {
    const [fromYear, fromMonth] = range.from.split("-").map(Number);
    const [toYear, toMonth] = range.to.split("-").map(Number);
    const count = Math.max(
      1,
      (toYear - fromYear) * 12 + toMonth - fromMonth + 1,
    );
    return recentMonthKeys(count, new Date(toYear, toMonth - 1, 15));
  }
  const monthTimelineRange = $derived.by(() => {
    if (timelinePreset === "3months")
      return recentMonthRange(3, activityMonthAnchor);
    if (timelinePreset === "6months")
      return recentMonthRange(6, activityMonthAnchor);
    if (timelinePreset === "custom") {
      return timelineFrom <= timelineTo
        ? { from: timelineFrom, to: timelineTo }
        : { from: timelineTo, to: timelineFrom };
    }
    return { from: initialSelectedMonth, to: initialSelectedMonth };
  });
  const timelineDateRange = $derived.by(() => {
    if (timelinePreset === "salary")
      return salaryCycleDateRange(new Date(), Number(salaryDay));
    return {
      from: `${monthTimelineRange.from}-01`,
      to: monthEnd(monthTimelineRange.to),
    };
  });
  const timelineRange = $derived(
    timelinePreset === "salary"
      ? monthRangeCoveringDates(timelineDateRange)
      : monthTimelineRange,
  );
  const previousTimelineDateRange = $derived.by(() => {
    if (timelinePreset === "salary")
      return previousSalaryCycleDateRange(new Date(), Number(salaryDay));
    const offset = monthCount(timelineRange);
    const from = shiftMonthKey(timelineRange.from, -offset);
    const to = shiftMonthKey(timelineRange.to, -offset);
    return {
      from: `${from}-01`,
      to: monthEnd(to),
    };
  });
  const activityRange = $derived.by(() => ({
    from:
      previousTimelineDateRange.from.slice(0, 7) < minimumActivityRange.from
        ? previousTimelineDateRange.from.slice(0, 7)
        : timelineRange.from < minimumActivityRange.from
          ? timelineRange.from
          : minimumActivityRange.from,
    to:
      previousTimelineDateRange.to.slice(0, 7) > minimumActivityRange.to
        ? previousTimelineDateRange.to.slice(0, 7)
        : timelineRange.to > minimumActivityRange.to
          ? timelineRange.to
          : minimumActivityRange.to,
  }));
  const bank = createQuery(
    toStore(() => bankRangeQuery(() => api, activityRange)),
  );
  const invoices = createQuery(
    toStore(() => invoicesRangeQuery(() => api, activityRange)),
  );
  const invoiceMappings = createQuery(
    invoiceTransactionMappingsQuery(() => api),
  );
  const invoicePaymentAccountRules = createQuery(
    invoicePaymentAccountRulesQuery(() => api),
  );
  const invoicePaymentAccounts = createQuery(
    invoicePaymentAccountsQuery(() => api),
  );
  const trades = createQuery(
    toStore(() => investmentTransactionsRangeQuery(() => api, activityRange)),
  );
  const rates = createQuery(exchangeRatesQuery(() => api));
  const categoryRows = createQuery(classificationCategoriesQuery(() => api));
  const classificationMerchants = createQuery(
    classificationMerchantsQuery(() => api),
  );
  const qc = useQueryClient();
  let flow = $state<ActivityFlowFilter>("all");
  let source = $state<ActivitySourceFilter>("all");
  let search = $state("");
  let monthlySearch = $state("");
  let submittedSearch = $state("");
  let searchTime = $state("all");
  let searchFrom = $state("");
  let searchTo = $state("");
  let searchCategory = $state("");
  const searching = $derived(Boolean(submittedSearch));
  const searchDates = $derived.by(() => {
    if (searchTime === "custom") return { from: searchFrom, to: searchTo };
    if (searchTime === "year")
      return {
        from: `${initialSelectedMonth.slice(0, 4)}-01-01`,
        to: `${initialSelectedMonth.slice(0, 4)}-12-31`,
      };
    if (searchTime === "12months") {
      const date = new Date(activityMonthAnchor);
      date.setMonth(date.getMonth() - 11);
      return {
        from: `${currentActivityMonthKey(date)}-01`,
        to: activityDateKey({
          date: new Date().toISOString(),
          dateHasTime: true,
          source: "bank",
        }),
      };
    }
    return { from: "", to: "" };
  });
  const invalidSearchDates = $derived(
    Boolean(
      searchDates.from && searchDates.to && searchDates.from > searchDates.to,
    ),
  );
  const searchResults = createInfiniteQuery(
    toStore(() =>
      activitySearchQuery(
        () => api,
        submittedSearch,
        searchDates.from,
        searchDates.to,
        source,
        flow,
        searchCategory,
      ),
    ),
  );
  // Adjacent result pages can share a day and therefore repeat matching context.
  function uniqueRows<T extends { id: string }>(rows: T[]): T[] {
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  }
  const bankData = $derived(
    searching
      ? {
          accounts: $searchResults.data?.pages[0]?.bank.accounts ?? [],
          transactions: uniqueRows(
            $searchResults.data?.pages.flatMap(
              (page) => page.bank.transactions,
            ) ?? [],
          ),
        }
      : $bank.data,
  );
  const invoiceData = $derived(
    searching
      ? uniqueRows(
          $searchResults.data?.pages.flatMap((page) => page.invoices) ?? [],
        )
      : $invoices.data,
  );
  const tradeData = $derived(
    searching
      ? uniqueRows(
          $searchResults.data?.pages.flatMap((page) => page.trades) ?? [],
        )
      : $trades.data,
  );
  let savedMonthly: {
    flow: ActivityFlowFilter;
    source: ActivitySourceFilter;
    category: ActivityCategoryFilter | null;
    scroll: number;
    rootScroll: number;
  } | null = null;
  function saveMonthly() {
    savedMonthly = {
      flow,
      source,
      category: selectedCategory,
      scroll: window.scrollY,
      rootScroll: document.getElementById("root")?.scrollTop ?? 0,
    };
    flow = "all";
    source = "all";
    selectedCategory = null;
    searchTime = "all";
    searchFrom = "";
    searchTo = "";
    searchCategory = "";
  }
  function restoreMonthly() {
    search = "";
    submittedSearch = "";
    detailKey = null;
    if (savedMonthly) {
      const saved = savedMonthly;
      savedMonthly = null;
      flow = saved.flow;
      source = saved.source;
      selectedCategory = saved.category;
      void tick().then(() => {
        window.scrollTo({ top: saved.scroll, behavior: "instant" });
        document
          .getElementById("root")
          ?.scrollTo({ top: saved.rootScroll, behavior: "instant" });
      });
    }
  }
  function submitSearch() {
    const query = search.trim();
    if (!query) {
      clearSearch();
      return;
    }
    if (!searching) {
      saveMonthly();
      window.history.pushState(
        { ...window.history.state, activitySearch: { query } },
        "",
      );
    } else
      window.history.replaceState(
        { ...window.history.state, activitySearch: { query } },
        "",
      );
    submittedSearch = query;
  }
  function clearSearch() {
    if (!searching) {
      search = "";
      return;
    }
    if (searching && window.history.state?.activitySearch)
      window.history.go(detailKey ? -2 : -1);
    restoreMonthly();
  }
  function changeSearch(event: Event) {
    search = (event.currentTarget as HTMLInputElement).value;
    if (!search.trim()) {
      clearSearch();
      return;
    }
  }
  function closeDetail() {
    if (window.history.state?.activityDetail) window.history.back();
    else detailKey = null;
  }
  $effect(() => {
    if (searching && window.history.state?.activitySearch) {
      window.history.replaceState(
        {
          ...window.history.state,
          activitySearch: {
            query: submittedSearch,
            flow,
            source,
            category: searchCategory,
            time: searchTime,
            from: searchFrom,
            to: searchTo,
          },
        },
        "",
      );
    }
  });
  onMount(() => {
    const restoreHistory = () => {
      if (window.location.hash !== "#/activity") return;
      const state = window.history.state;
      if (state?.activitySearch?.query) {
        if (!searching && !savedMonthly) saveMonthly();
        flow = state.activitySearch.flow ?? "all";
        source = state.activitySearch.source ?? "all";
        searchCategory = state.activitySearch.category ?? "";
        searchTime = state.activitySearch.time ?? "all";
        searchFrom = state.activitySearch.from ?? "";
        searchTo = state.activitySearch.to ?? "";
        search = state.activitySearch.query;
        submittedSearch = search;
        detailKey = state.activityDetail ?? null;
      } else {
        restoreMonthly();
        detailKey = state?.activityDetail ?? null;
      }
    };
    restoreHistory();
    window.addEventListener("popstate", restoreHistory);
    return () => {
      window.removeEventListener("popstate", restoreHistory);
    };
  });
  let selectedCategory = $state<ActivityCategoryFilter | null>(null);
  let pending = $state<PendingCategoryUpdate | null>(null);
  let newInvoiceMerchantName = $state("");
  let mappingDialog = $state<{
    invoice: InvoiceSummaryRow;
    step: "candidates" | "confirm" | "actions";
    transactionId?: string;
    paymentAccountId?: string;
    paymentMethod?: "cash";
  } | null>(null);
  let mappingNotice = $state("");
  let detailKey = $state<string | null>(null);
  const fallbackCategories = [
    { id: "salary", label: "薪資" },
    { id: "transfer", label: "轉帳", behavior: "asset_transfer" as const },
    { id: "food", label: "餐飲" },
    { id: "transport", label: "交通" },
    { id: "shopping", label: "購物" },
    { id: "housing", label: "居住" },
    { id: "health", label: "醫療" },
    { id: "education", label: "教育" },
    { id: "entertainment", label: "娛樂" },
    { id: "investment", label: "投資", behavior: "asset_transfer" as const },
    { id: "insurance", label: "保險" },
    { id: "fee", label: "手續費", behavior: "excluded" as const },
    { id: "tax", label: "稅務" },
    { id: "software", label: "軟體服務" },
    { id: "utilities", label: "生活繳費" },
    { id: "other-income", label: "其他收入" },
    { id: "other", label: "未分類" },
    { id: "cash-withdrawal", label: "提款至現金", behavior: "cash_withdrawal" },
    { id: "excluded", label: "不列入統計", behavior: "excluded" },
  ];
  const categoryOptions = $derived(
    $categoryRows.data?.length ? $categoryRows.data : fallbackCategories,
  );
  const activityDataStatus = $derived(
    getActivityDataStatus(
      searching
        ? [
            { label: "搜尋結果", isError: $searchResults.isError },
            { label: "發票配對", isError: $invoiceMappings.isError },
            {
              label: "支付卡片規則",
              isError: $invoicePaymentAccountRules.isError,
            },
            { label: "發票支付卡片", isError: $invoicePaymentAccounts.isError },
          ]
        : [
            {
              label: "銀行與信用卡",
              isError: $bank.isError,
            },
            {
              label: "發票",
              isError: $invoices.isError,
            },
            {
              label: "發票配對",
              isError: $invoiceMappings.isError,
            },
            {
              label: "支付卡片規則",
              isError: $invoicePaymentAccountRules.isError,
            },
            { label: "發票支付卡片", isError: $invoicePaymentAccounts.isError },
            {
              label: "投資活動",
              isError: $trades.isError,
            },
          ],
    ),
  );
  const activitySummaryIncomplete = $derived(activityDataStatus.hasFailure);
  const activityRetryPending = $derived(
    $searchResults.isFetching ||
      $bank.isFetching ||
      $invoices.isFetching ||
      $invoiceMappings.isFetching ||
      $invoicePaymentAccountRules.isFetching ||
      $invoicePaymentAccounts.isFetching ||
      $trades.isFetching,
  );
  const categories = $derived(
    Object.fromEntries(
      categoryOptions.map((category) => [category.id, category.label]),
    ),
  );
  const rateValues = $derived(rateMap($rates.data));
  const bankAccounts = $derived(
    new Map((bankData?.accounts ?? []).map((account) => [account.id, account])),
  );
  const creditCardAccounts = $derived(
    (bankData?.accounts ?? []).filter(
      (account) => account.accountType === "credit",
    ),
  );
  const activityBankTransactions = $derived(
    deduplicateBankTransactions(
      (bankData?.transactions ?? []).map((transaction) => ({
        ...transaction,
        accountType:
          transaction.accountType ??
          bankAccounts.get(transaction.accountId)?.accountType,
      })),
    ),
  );
  const invoiceMatches = $derived(
    matchInvoicesToTransactions(
      activityBankTransactions,
      invoiceData ?? [],
      $invoiceMappings.data ?? [],
      $invoicePaymentAccountRules.data ?? [],
      $invoicePaymentAccounts.data ?? [],
    ),
  );
  const rawItems = $derived(
    searching
      ? ($searchResults.data?.pages.flatMap((page) => page.items) ?? [])
      : buildActivityItems(
          activityBankTransactions,
          invoiceData ?? [],
          tradeData ?? [],
          bankAccounts,
          invoiceMatches,
        ),
  );
  const detailItem = $derived(
    rawItems.find((item) => activityKey(item) === detailKey),
  );
  const detailInvoiceId = $derived(detailItem?.invoiceId ?? null);
  const detailInvoice = createQuery(
    toStore(() => invoiceDetailQuery(() => api, detailInvoiceId)),
  );
  const cashFlowMonths = $derived(monthKeysBetween(activityRange));
  const timelineDates = $derived({
    from: timelineDateRange.from,
    to: timelineDateRange.to,
  });
  const monthlyCalculatedItems = $derived(
    rawItems.filter(
      (item) =>
        activityDateKey(item) >= timelineDates.from &&
        activityDateKey(item) <= timelineDates.to &&
        (item.source === "bank" ||
          item.source === "card" ||
          item.source === "invoice"),
    ),
  );
  const previousMonthlyCalculatedItems = $derived(
    rawItems.filter(
      (item) =>
        activityDateKey(item) >= previousTimelineDateRange.from &&
        activityDateKey(item) <= previousTimelineDateRange.to &&
        (item.source === "bank" ||
          item.source === "card" ||
          item.source === "invoice"),
    ),
  );
  const missingMonthlyRates = $derived([
    ...new Set(
      monthlyCalculatedItems
        .filter(
          (item) =>
            !item.excludedFromCalculation &&
            item.amount != null &&
            ["bank", "card", "invoice"].includes(item.source) &&
            activityCashFlow(item) != null &&
            activityAmountTwd(item, rateValues) == null,
        )
        .map((item) => item.currency),
    ),
  ]);
  const incomeSlices = $derived(
    buildActivityCategorySlices(monthlyCalculatedItems, "income", rateValues),
  );
  const expenseSlices = $derived(
    buildActivityCategorySlices(monthlyCalculatedItems, "expense", rateValues),
  );
  const investmentIncomeSlices = $derived(
    buildActivityCategorySlices(
      monthlyCalculatedItems,
      "income",
      rateValues,
      "investment",
    ),
  );
  const investmentExpenseSlices = $derived(
    buildActivityCategorySlices(
      monthlyCalculatedItems,
      "expense",
      rateValues,
      "investment",
    ),
  );
  const ordinaryIncomeTotal = $derived(
    incomeSlices.reduce((sum, slice) => sum + slice.amount, 0),
  );
  const ordinaryExpenseTotal = $derived(
    expenseSlices.reduce((sum, slice) => sum + slice.amount, 0),
  );
  const investmentIncomeTotal = $derived(
    investmentIncomeSlices.reduce((sum, slice) => sum + slice.amount, 0),
  );
  const investmentExpenseTotal = $derived(
    investmentExpenseSlices.reduce((sum, slice) => sum + slice.amount, 0),
  );
  const incomeTotal = $derived(ordinaryIncomeTotal + investmentIncomeTotal);
  const expenseTotal = $derived(ordinaryExpenseTotal + investmentExpenseTotal);
  const previousIncomeSlices = $derived(
    buildActivityCategorySlices(
      previousMonthlyCalculatedItems,
      "income",
      rateValues,
    ),
  );
  const previousExpenseSlices = $derived(
    buildActivityCategorySlices(
      previousMonthlyCalculatedItems,
      "expense",
      rateValues,
    ),
  );
  function mergeCategorySlices(
    current: typeof incomeSlices,
    previous: typeof incomeSlices,
  ) {
    const currentByCategory = new Map(
      current.map((slice) => [slice.category, slice]),
    );
    const previousByCategory = new Map(
      previous.map((slice) => [slice.category, slice]),
    );
    return [
      ...new Set([...currentByCategory.keys(), ...previousByCategory.keys()]),
    ]
      .map((category) => {
        const currentSlice = currentByCategory.get(category);
        const previousSlice = previousByCategory.get(category);
        return {
          category,
          amount: currentSlice?.amount ?? 0,
          previousAmount: previousSlice?.amount ?? 0,
          color: currentSlice?.color ?? previousSlice?.color ?? "#68747b",
        };
      })
      .filter((row) => row.amount > 0 || row.previousAmount > 0)
      .sort(
        (left, right) =>
          right.amount - left.amount ||
          right.previousAmount - left.previousAmount,
      );
  }
  const incomeSummaryRows = $derived(
    mergeCategorySlices(incomeSlices, previousIncomeSlices),
  );
  const expenseSummaryRows = $derived(
    mergeCategorySlices(expenseSlices, previousExpenseSlices),
  );
  function investmentSummaryRows(items: ActivityItem[]) {
    const summary = new Map<string, number>();
    for (const item of items) {
      const cashFlowType = activityCashFlowType(item);
      if (
        (cashFlowType !== "investment_expense" &&
          cashFlowType !== "investment_income") ||
        item.amount == null
      )
        continue;
      const amount = activityDisplayAmount(item);
      if (amount == null || amount === 0) continue;
      const category =
        cashFlowType === "investment_expense" ? "投資投入" : "投資收入";
      summary.set(category, (summary.get(category) ?? 0) + Math.abs(amount));
    }
    return summary;
  }
  const investmentSummary = $derived(
    investmentSummaryRows(monthlyCalculatedItems),
  );
  const previousInvestmentSummary = $derived(
    investmentSummaryRows(previousMonthlyCalculatedItems),
  );
  const investmentRows = $derived(
    ["投資投入", "投資收入"]
      .map((category, index) => ({
        category,
        amount: investmentSummary.get(category) ?? 0,
        previousAmount: previousInvestmentSummary.get(category) ?? 0,
        color: index === 0 ? "#7665a8" : "#388d82",
      }))
      .filter((row) => row.amount > 0 || row.previousAmount > 0),
  );
  const incomeBreakdowns = $derived(
    [
      {
        key: "ordinaryIncome" as const,
        label: "一般收入",
        amount: ordinaryIncomeTotal,
        previousAmount: previousIncomeSlices.reduce(
          (sum, slice) => sum + slice.amount,
          0,
        ),
      },
      {
        key: "investmentIncome" as const,
        label: "投資收入",
        amount: investmentIncomeTotal,
        previousAmount: previousInvestmentSummary.get("投資收入") ?? 0,
      },
    ].filter((row) => row.amount > 0 || row.previousAmount > 0),
  );
  const expenseBreakdowns = $derived(
    [
      {
        key: "ordinaryExpense" as const,
        label: "一般支出",
        amount: ordinaryExpenseTotal,
        previousAmount: previousExpenseSlices.reduce(
          (sum, slice) => sum + slice.amount,
          0,
        ),
      },
      {
        key: "investmentExpense" as const,
        label: "投資投入",
        amount: investmentExpenseTotal,
        previousAmount: previousInvestmentSummary.get("投資投入") ?? 0,
      },
    ].filter((row) => row.amount > 0 || row.previousAmount > 0),
  );
  let expandedCashFlowSection = $state<CashFlowSection | null>(null);
  let expandedCashFlowBreakdown = $state<CashFlowBreakdownKey | null>(null);
  let cashFlowDetailSearch = $state("");
  function cashFlowDetailKey(title: string) {
    return title.trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-TW");
  }
  function cashFlowDetailsFor(
    key: CashFlowBreakdownKey,
    items: ActivityItem[],
  ) {
    const flow = key.endsWith("Income") ? "income" : "expense";
    const investment = key.startsWith("investment");
    const details: CashFlowDetail[] = [];
    for (const item of items) {
      if (
        item.excludedFromCalculation ||
        activityCashFlow(item) !== flow ||
        isInvestmentCashFlow(item) !== investment
      )
        continue;
      if (item.categoryParts?.length) {
        for (const part of item.categoryParts) {
          if (part.behavior !== "normal") continue;
          const title = part.description ?? item.title;
          details.push({
            key: cashFlowDetailKey(title),
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
      const amount = activityAmountTwd(item, rateValues);
      if (amount == null || amount === 0) continue;
      details.push({
        key: cashFlowDetailKey(item.title),
        date: item.date,
        title: item.title,
        subtitle: item.subtitle,
        amount: Math.abs(amount),
        count: 1,
      });
    }
    return details;
  }
  function aggregateCashFlowDetails(details: CashFlowDetail[]) {
    const grouped = new Map<string, CashFlowDetail>();
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
  const currentCashFlowDetails = $derived.by(() =>
    expandedCashFlowBreakdown
      ? aggregateCashFlowDetails(
          cashFlowDetailsFor(expandedCashFlowBreakdown, monthlyCalculatedItems),
        )
      : [],
  );
  const previousCashFlowDetails = $derived.by(() =>
    expandedCashFlowBreakdown
      ? aggregateCashFlowDetails(
          cashFlowDetailsFor(
            expandedCashFlowBreakdown,
            previousMonthlyCalculatedItems,
          ),
        )
      : [],
  );
  const filteredCashFlowDetails = $derived.by(() => {
    const query = cashFlowDetailSearch.trim().toLocaleLowerCase("zh-TW");
    const filter = (details: CashFlowDetail[]) =>
      query
        ? details.filter((detail) =>
            `${detail.title} ${detail.subtitle}`
              .toLocaleLowerCase("zh-TW")
              .includes(query),
          )
        : details;
    return {
      current: filter(currentCashFlowDetails),
      previous: filter(previousCashFlowDetails),
    };
  });
  const cashFlowComparisonRows = $derived.by(() => {
    const rows = new Map<string, CashFlowComparisonRow>();
    for (const detail of filteredCashFlowDetails.current)
      rows.set(detail.key, { key: detail.key, current: detail });
    for (const detail of filteredCashFlowDetails.previous) {
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
  function cashFlowDetailStatus(
    current: CashFlowDetail | undefined,
    previous: CashFlowDetail | undefined,
  ) {
    if (!current) return "本期沒有";
    if (!previous) return "新增";
    const delta = current.amount - previous.amount;
    return delta === 0
      ? "相同"
      : `${delta > 0 ? "高" : "低"} ${formatCurrency(Math.abs(delta))}`;
  }
  function toggleCashFlowSection(section: CashFlowSection) {
    expandedCashFlowBreakdown = null;
    expandedCashFlowSection =
      expandedCashFlowSection === section ? null : section;
    cashFlowDetailSearch = "";
  }
  function toggleCashFlowBreakdown(key: CashFlowBreakdownKey) {
    expandedCashFlowBreakdown = expandedCashFlowBreakdown === key ? null : key;
    cashFlowDetailSearch = "";
  }
  const largestExpenseSummary = $derived(
    Math.max(...expenseSummaryRows.map((row) => row.amount), 1),
  );
  const comparisonLabel = $derived(
    timelinePreset === "salary"
      ? "前期"
      : timelinePreset === "current"
        ? "上月"
        : "前一段期間",
  );
  const currentMonth = currentActivityMonthKey();
  const timelineLabel = $derived.by(() => {
    if (timelinePreset === "salary")
      return `${timelineDateRange.from} 至 ${timelineDateRange.to}`;
    if (timelineRange.from === timelineRange.to)
      return `${timelineRange.from.slice(0, 4)} 年 ${Number(timelineRange.from.slice(5))} 月`;
    return `${timelineRange.from} 至 ${timelineRange.to}`;
  });
  const cashFlow = $derived(
    cashFlowMonths.map((month) => {
      const items = rawItems.filter(
        (item) =>
          activityDateKey(item).startsWith(month) &&
          (item.source === "bank" ||
            item.source === "card" ||
            item.source === "invoice"),
      );
      return {
        month,
        income: items.reduce(
          (sum, item) =>
            sum + Math.max(activityCashAmountTwd(item, rateValues), 0),
          0,
        ),
        expense: Math.abs(
          items.reduce(
            (sum, item) =>
              sum + Math.min(activityCashAmountTwd(item, rateValues), 0),
            0,
          ),
        ),
      };
    }),
  );
  const maxCashFlow = $derived(
    Math.max(...cashFlow.flatMap((point) => [point.income, point.expense]), 1),
  );
  const filtered = $derived(
    filterActivities(rawItems, {
      month: "",
      from: searching ? searchDates.from : timelineDates.from,
      to: searching ? searchDates.to : timelineDates.to,
      categoryId: searching ? searchCategory : undefined,
      flow,
      source,
      search: searching ? submittedSearch : monthlySearch,
      category: selectedCategory,
    }),
  );
  const fillingSearchBatch = $derived(
    searching && !invalidSearchDates && $searchResults.isFetching,
  );
  let searchSentinel = $state<HTMLDivElement>();
  $effect(() => {
    if (
      !searchSentinel ||
      !searching ||
      invalidSearchDates ||
      !$searchResults.hasNextPage ||
      $searchResults.isFetching ||
      $searchResults.isError
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void $searchResults.fetchNextPage();
      },
      { rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(searchSentinel);
    return () => observer.disconnect();
  });
  const filteredGroups = $derived(groupActivitiesByDate(filtered));
  const mappingCandidates = $derived.by(() => {
    if (!mappingDialog) return [];
    const unavailableTransactionIds = new Set(
      Array.from(invoiceMatches.transactionToInvoice.entries())
        .filter(([, invoice]) => invoice.id !== mappingDialog!.invoice.id)
        .map(([transactionId]) => transactionId),
    );
    return invoiceTransactionCandidates(
      activityBankTransactions,
      mappingDialog.invoice,
      unavailableTransactionIds,
      invoiceMatches.learnedAccountByInvoice.get(mappingDialog.invoice.id),
    );
  });
  const categoryMutation = createMutation({
    mutationFn: async (payload: {
      targetType: "bank_transaction" | "invoice_item";
      targetId: string;
      categoryId: string;
      addRule: boolean;
      pattern: string;
      operator: PendingCategoryUpdate["operator"];
    }) => {
      await api.put(
        `/api/classification/overrides/${payload.targetType}/${encodeURIComponent(payload.targetId)}`,
        { categoryId: payload.categoryId },
      );
      if (payload.addRule) {
        const compiled = compileRulePattern(payload.operator, payload.pattern);
        if (!compiled) throw new Error("分類規則格式有誤。");
        await api.post("/api/classification/rules", {
          categoryId: payload.categoryId,
          targetType: payload.targetType,
          field:
            payload.targetType === "invoice_item" ? "description" : "any_text",
          ...compiled,
          priority: 200,
          description: "由活動頁建立",
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.bank });
      qc.invalidateQueries({ queryKey: queryKeys.invoices });
      qc.invalidateQueries({ queryKey: queryKeys.classificationRules });
      pending = null;
    },
  });
  const invoiceMerchantMutation = createMutation({
    mutationFn: (payload: { invoiceId: string; merchantId: string | null }) =>
      payload.merchantId
        ? api.put(
            `/api/invoices/${encodeURIComponent(payload.invoiceId)}/merchant`,
            { merchantId: payload.merchantId },
          )
        : api.delete(
            `/api/invoices/${encodeURIComponent(payload.invoiceId)}/merchant`,
          ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.invoiceDetail(detailInvoiceId ?? ""),
      });
      qc.invalidateQueries({ queryKey: queryKeys.invoices });
      newInvoiceMerchantName = "";
    },
  });
  const createInvoiceMerchantMutation = createMutation({
    mutationFn: async (payload: { invoiceId: string; name: string }) => {
      const merchant = await api.post<ClassificationMerchantRow>(
        "/api/classification/merchants",
        { name: payload.name },
      );
      await api.put(
        `/api/invoices/${encodeURIComponent(payload.invoiceId)}/merchant`,
        { merchantId: merchant.id },
      );
      return merchant;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.classificationMerchants });
      qc.invalidateQueries({
        queryKey: queryKeys.invoiceDetail(detailInvoiceId ?? ""),
      });
      qc.invalidateQueries({ queryKey: queryKeys.invoices });
      newInvoiceMerchantName = "";
    },
  });
  const mappingMutation = createMutation({
    mutationFn: (payload: { invoiceId: string; transactionId: string }) =>
      api.put<InvoiceTransactionPreference>(
        `/api/activity/invoice-mappings/${encodeURIComponent(payload.invoiceId)}`,
        { transactionId: payload.transactionId },
      ),
    onSuccess: (preference) => {
      updateMappingPreference(preference);
      mappingDialog = null;
      closeDetail();
      showMappingNotice("已完成配對，活動只顯示一筆");
    },
  });
  const paymentAccountMutation = createMutation({
    mutationFn: (payload: { invoiceId: string; accountId: string }) =>
      api.put<InvoicePaymentAccountAssignment & { matchKey: string }>(
        `/api/activity/invoice-mappings/${encodeURIComponent(payload.invoiceId)}`,
        { paymentAccountId: payload.accountId },
      ),
    onSuccess: (selection) => {
      qc.setQueryData<InvoicePaymentAccountAssignment[]>(
        queryKeys.invoicePaymentAccounts,
        (current = []) => [
          selection,
          ...current.filter((row) => row.invoiceId !== selection.invoiceId),
        ],
      );
      qc.setQueryData<InvoicePaymentAccountRule[]>(
        queryKeys.invoicePaymentAccountRules,
        (current = []) =>
          selection.matchKey
            ? [
                selection,
                ...current.filter((row) => row.matchKey !== selection.matchKey),
              ]
            : current,
      );
      qc.setQueryData<InvoiceTransactionPreference[]>(
        queryKeys.invoiceTransactionMappings,
        (current = []) =>
          current.filter(
            (row) =>
              row.invoiceId !== selection.invoiceId ||
              row.decision === "linked",
          ),
      );
      qc.invalidateQueries({ queryKey: queryKeys.invoicePaymentAccounts });
      qc.invalidateQueries({ queryKey: queryKeys.invoicePaymentAccountRules });
      qc.invalidateQueries({ queryKey: queryKeys.invoiceTransactionMappings });
      qc.invalidateQueries({ queryKey: queryKeys.cashWallet });
      qc.invalidateQueries({ queryKey: queryKeys.bank });
      mappingDialog = null;
      closeDetail();
      showMappingNotice(
        "已設定這張發票的信用卡；相同品項（無明細時為同商家）下次會預選",
      );
    },
  });
  const cashPaymentMutation = createMutation({
    mutationFn: (invoiceId: string) =>
      api.put<InvoiceTransactionPreference>(
        `/api/activity/invoice-mappings/${encodeURIComponent(invoiceId)}`,
        { paymentMethod: "cash" },
      ),
    onSuccess: (preference) => {
      updateMappingPreference(preference);
      qc.setQueryData<InvoicePaymentAccountAssignment[]>(
        queryKeys.invoicePaymentAccounts,
        (current = []) =>
          current.filter((row) => row.invoiceId !== preference.invoiceId),
      );
      qc.invalidateQueries({ queryKey: queryKeys.invoicePaymentAccounts });
      mappingDialog = null;
      closeDetail();
      showMappingNotice("已標記為現金支付，現金餘額會扣除這筆發票");
    },
  });
  const separationMutation = createMutation({
    mutationFn: (invoiceId: string) =>
      api.delete<InvoiceTransactionPreference>(
        `/api/activity/invoice-mappings/${encodeURIComponent(invoiceId)}`,
      ),
    onSuccess: (preference) => {
      updateMappingPreference(preference);
      mappingDialog = null;
      closeDetail();
      showMappingNotice("已解除配對，兩筆活動將保持分開");
    },
  });
  function openCategory(item: ActivityItem, categoryId: string) {
    if (item.transactionId && categoryId !== item.categoryId)
      pending = {
        item,
        targetType: "bank_transaction",
        targetId: item.transactionId,
        categoryId,
        addRule: false,
        pattern: item.classificationPattern ?? item.title,
        operator: "keywords",
      };
  }
  function openInvoiceItemCategory(
    line: InvoiceLineItemRow,
    categoryId: string,
  ) {
    if (categoryId === (line.classification?.categoryId ?? "other")) return;
    pending = {
      item: {
        id: line.id,
        source: "invoice",
        date: detailItem?.date ?? "",
        title: line.description,
        subtitle: "發票品項",
        amount: line.amount,
        currency: "TWD",
        category: line.classification?.label ?? "未分類",
        categoryId: line.classification?.categoryId ?? "other",
        status: "已開立",
      },
      targetType: "invoice_item",
      targetId: line.id,
      categoryId,
      addRule: false,
      pattern: line.description,
      operator: "keywords",
    };
  }
  function setInvoiceMerchant(invoiceId: string, merchantId: string) {
    $invoiceMerchantMutation.mutate({
      invoiceId,
      merchantId: merchantId || null,
    });
  }
  function createAndSetInvoiceMerchant(event: SubmitEvent, invoiceId: string) {
    event.preventDefault();
    const name = newInvoiceMerchantName.trim();
    if (!name) return;
    $createInvoiceMerchantMutation.mutate({ invoiceId, name });
  }
  function chooseCategory(flow: "income" | "expense", category: string) {
    if (
      selectedCategory?.flow === flow &&
      selectedCategory.category === category
    ) {
      clearCategoryFilter();
      return;
    }
    selectedCategory = { flow, category };
    chooseFlow(flow, false);
    void tick().then(() => {
      document
        .getElementById("activity-list")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function clearCategoryFilter() {
    chooseFlow("all");
  }
  function chooseFlow(nextFlow: ActivityFlowFilter, clearCategory = true) {
    flow = nextFlow;
    if (clearCategory) selectedCategory = null;
  }
  function chooseChartFlow(nextFlow: Exclude<ActivityFlowFilter, "all">) {
    chooseFlow(flow === nextFlow && !selectedCategory ? "all" : nextFlow);
  }
  function setTimelinePreset(next: TimelinePreset) {
    timelinePreset = next;
    if (next === "current") {
      timelineFrom = initialSelectedMonth;
      timelineTo = initialSelectedMonth;
    } else if (next === "3months") {
      const range = recentMonthRange(3, activityMonthAnchor);
      timelineFrom = range.from;
      timelineTo = range.to;
    } else if (next === "6months") {
      const range = recentMonthRange(6, activityMonthAnchor);
      timelineFrom = range.from;
      timelineTo = range.to;
    }
    selectedCategory = null;
  }
  function handleTimelinePresetChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (
      value === "current" ||
      value === "3months" ||
      value === "6months" ||
      value === "salary" ||
      value === "custom"
    ) {
      setTimelinePreset(value);
    }
  }
  function chooseMonth(month: string) {
    selectedMonth = month;
    timelinePreset = "custom";
    timelineFrom = month;
    timelineTo = month;
    selectedCategory = null;
  }
  function retryActivityData() {
    if (searching && $searchResults.isError) void $searchResults.refetch();
    if ($bank.isError) void $bank.refetch();
    if ($invoices.isError) void $invoices.refetch();
    if ($invoiceMappings.isError) void $invoiceMappings.refetch();
    if ($invoicePaymentAccountRules.isError)
      void $invoicePaymentAccountRules.refetch();
    if ($invoicePaymentAccounts.isError) void $invoicePaymentAccounts.refetch();
    if ($trades.isError) void $trades.refetch();
  }
  function sourceLabel(item: ActivityItem) {
    const label = {
      bank: "銀行",
      card: "信用卡",
      investment: "投資",
      invoice: "發票",
    }[item.source];
    return item.source !== "invoice" && item.invoiceId
      ? `${label}＋發票`
      : label;
  }
  function activityKey(item: ActivityItem) {
    return `${item.source}-${item.id}`;
  }
  function openDetail(item: ActivityItem) {
    detailKey = activityKey(item);
    window.history.pushState(
      { ...window.history.state, activityDetail: detailKey },
      "",
    );
  }
  function transactionForItem(item: ActivityItem) {
    return activityBankTransactions.find(
      (transaction) => transaction.id === item.transactionId,
    );
  }
  function updateMappingPreference(preference: InvoiceTransactionPreference) {
    qc.setQueryData<InvoiceTransactionPreference[]>(
      queryKeys.invoiceTransactionMappings,
      (current = []) => [
        preference,
        ...current.filter((row) => row.invoiceId !== preference.invoiceId),
      ],
    );
    qc.invalidateQueries({ queryKey: queryKeys.invoiceTransactionMappings });
    qc.invalidateQueries({ queryKey: queryKeys.invoicePaymentAccounts });
    qc.invalidateQueries({ queryKey: queryKeys.invoicePaymentAccountRules });
    qc.invalidateQueries({ queryKey: queryKeys.bank });
    qc.invalidateQueries({ queryKey: queryKeys.cashWallet });
  }
  function showMappingNotice(message: string) {
    mappingNotice = message;
    window.setTimeout(() => {
      if (mappingNotice === message) mappingNotice = "";
    }, 3500);
  }
  function invoiceForItem(item: ActivityItem) {
    return (invoiceData ?? []).find((invoice) => invoice.id === item.invoiceId);
  }
  function openMapping(item: ActivityItem) {
    const invoice = invoiceForItem(item);
    if (!invoice) return;
    mappingDialog = {
      invoice,
      step:
        item.invoicePaymentMethod === "cash" || item.transactionId
          ? "actions"
          : "candidates",
      transactionId: item.transactionId,
      paymentAccountId: item.invoiceId
        ? invoiceMatches.learnedAccountByInvoice.get(item.invoiceId)
        : undefined,
      paymentMethod: item.invoicePaymentMethod === "cash" ? "cash" : undefined,
    };
  }
  function paymentAccountLabel(account: {
    institutionName?: string;
    accountName?: string;
    accountLast4?: string;
  }) {
    return [
      account.institutionName ?? "信用卡",
      account.accountName,
      account.accountLast4 ? `末四碼 ${account.accountLast4}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  function chooseMappingTransaction(transactionId: string) {
    if (!mappingDialog) return;
    mappingDialog.transactionId = transactionId;
  }
  function selectedMappingTransaction(): BankTransactionRow | undefined {
    if (!mappingDialog?.transactionId) return undefined;
    return activityBankTransactions.find(
      (transaction) => transaction.id === mappingDialog?.transactionId,
    );
  }
  function mappingMerchant(transaction: BankTransactionRow) {
    return transaction.counterparty ?? transaction.description ?? "銀行交易";
  }
  function mappingAccount(transaction: BankTransactionRow) {
    return (
      transaction.institutionName ??
      transaction.accountName ??
      bankAccounts.get(transaction.accountId)?.institutionName ??
      "銀行／信用卡"
    );
  }
  function mappingDifference(
    invoice: InvoiceSummaryRow,
    transaction: BankTransactionRow,
  ) {
    return Math.abs(invoice.amount - Math.abs(transaction.amount));
  }
  function itemMappingDifference(item: ActivityItem) {
    if (item.invoiceAmount == null || item.amount == null) return 0;
    return Math.abs(item.invoiceAmount - Math.abs(item.amount));
  }
  function cashTransferLabel(item: ActivityItem) {
    const cashFlowType = activityCashFlowType(item);
    if (cashFlowType === "investment_expense") return "投資投入 · 計入支出";
    if (cashFlowType === "investment_income") return "投資收入 · 計入收入";
    return item.cashTransferType === "cash_withdrawal"
      ? "提款至現金 · 不列入收支"
      : "資產移轉 · 不列入收支";
  }
  function hasCashFlowLabel(item: ActivityItem) {
    const cashFlowType = activityCashFlowType(item);
    return (
      cashFlowType === "investment_expense" ||
      cashFlowType === "investment_income" ||
      cashFlowType === "asset_transfer"
    );
  }
  function countMatches(update: {
    pattern: string;
    operator: PendingCategoryUpdate["operator"];
    targetType: "bank_transaction" | "invoice_item";
  }) {
    const compiled = compileRulePattern(update.operator, update.pattern);
    if (!compiled) return 0;
    const pattern = compiled.pattern.toLowerCase();
    const candidates =
      update.targetType === "invoice_item"
        ? (invoiceData ?? [])
            .flatMap((row) => row.items ?? [])
            .map((line) => line.description)
        : activityBankTransactions.map(
            (t) =>
              `${t.description ?? ""} ${t.counterparty ?? ""} ${t.sourceId}`,
          );
    return candidates.filter((text) =>
      compiled.operator === "equals"
        ? text.trim().toLowerCase() === pattern
        : compiled.operator === "regex"
          ? new RegExp(compiled.pattern, "i").test(text)
          : compiled.operator === "starts_with"
            ? text.toLowerCase().startsWith(pattern)
            : text.toLowerCase().includes(pattern),
    ).length;
  }
</script>

{#snippet cashFlowDetailsPanel(
  label: string,
  currentAmount: number,
  previousAmount: number,
)}
  <div class="mt-2 rounded-lg border border-ink/10 bg-ink/2 p-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-xs font-semibold text-subtle">{label}明細</span>
      <input
        class="h-8 min-w-32 flex-1 rounded-md border border-ink/10 bg-paper px-2 text-xs outline-none placeholder:text-subtle focus:border-steel/50 md:max-w-48"
        type="search"
        placeholder="搜尋商家／品項"
        aria-label={`搜尋${label}明細`}
        bind:value={cashFlowDetailSearch}
      />
    </div>
    <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
      <div class="rounded-md bg-paper/70 px-2 py-1.5">
        <span class="font-semibold">目前期間</span>
        <span class="ml-2 text-subtle"
          >{filteredCashFlowDetails.current.length} 項 · {formatCurrency(
            currentAmount,
          )}</span
        >
      </div>
      <div class="rounded-md bg-paper/70 px-2 py-1.5">
        <span class="font-semibold">{comparisonLabel}</span>
        <span class="ml-2 text-subtle"
          >{filteredCashFlowDetails.previous.length} 項 · {formatCurrency(
            previousAmount,
          )}</span
        >
      </div>
    </div>
    {#if cashFlowComparisonRows.length === 0}
      <p class="px-1 py-3 text-xs text-subtle">沒有符合的明細。</p>
    {:else}
      <div class="mt-1 max-h-80 overflow-y-auto">
        {#each cashFlowComparisonRows as row (row.key)}
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
                    class={`text-[10px] ${cashFlowDetailStatus(row.current, row.previous) === "新增" || cashFlowDetailStatus(row.current, row.previous).startsWith("高") ? "text-coral" : "text-moss"}`}
                    >{cashFlowDetailStatus(row.current, row.previous)}</span
                  >
                </div>
              {:else}
                <span class="text-subtle">本期沒有此項目</span>
              {/if}
            </div>
            <div class="min-w-0 px-2 py-2">
              {#if row.previous}
                <p class="truncate font-medium">{row.previous.title}</p>
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
                  <span class="text-[10px] text-subtle"
                    >{row.current ? "相同項目" : "本期沒有"}</span
                  >
                </div>
              {:else}
                <span class="text-subtle">前期沒有此項目</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#if !searching && ($bank.isPending || $invoices.isPending || $invoiceMappings.isPending || $trades.isPending)}
  <EmptyState title="載入活動中" body="正在整理銀行、投資與發票資料。" />
{:else}
  <div class="grid min-w-0 max-w-full gap-4 overflow-x-clip pt-1">
    <form
      class="flex min-w-0 gap-2"
      role="search"
      onsubmit={(event) => {
        event.preventDefault();
        submitSearch();
      }}
    >
      <div class="relative min-w-0 flex-1">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-subtle"
        />
        <Input
          type="search"
          aria-label="搜尋所有活動"
          placeholder="搜尋所有活動"
          class="h-12 pl-10 pr-12 [&::-webkit-search-cancel-button]:appearance-none"
          value={search}
          oninput={changeSearch}
          oncompositionend={changeSearch}
          maxlength={200}
        />
        {#if search}<button
            type="button"
            aria-label="清空搜尋，返回月報"
            class="absolute right-0 top-0 flex size-12 items-center justify-center text-subtle"
            onclick={clearSearch}><X class="size-5" /></button
          >{/if}
      </div>
      <Button type="submit" class="h-12">搜尋</Button>
    </form>
    {#if searching}
      <section class="grid min-w-0 gap-3" aria-label="全歷史搜尋">
        <h2 class="break-words text-xl font-semibold">
          搜尋「{submittedSearch}」
        </h2>
        <p class="text-caption text-subtle">所有已同步紀錄 · 日期由新到舊</p>
        <ActivitySearchFilters
          bind:time={searchTime}
          bind:from={searchFrom}
          bind:to={searchTo}
          bind:source
          bind:flow
          bind:category={searchCategory}
          categories={categoryOptions}
        />
        {#if invalidSearchDates}<p role="alert" class="text-sm text-coral">
            開始日期不得晚於結束日期。
          </p>{/if}
        {#if fillingSearchBatch}<p role="status" class="text-sm text-subtle">
            搜尋活動中…
          </p>{/if}
      </section>
    {/if}
    {#if missingMonthlyRates.length > 0}
      <p role="status" class="text-sm text-coral">
        缺少 {missingMonthlyRates.join("、")} 匯率，月份總額與分類圖表尚未包含這些外幣交易。
        <button type="button" class="underline" onclick={() => $rates.refetch()}
          >重試匯率</button
        >
      </p>
    {/if}
    {#if activityDataStatus.hasFailure}
      <div
        class="flex flex-col gap-3 rounded-xl border border-coral/25 bg-coral/5 px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between"
        role="alert"
      >
        <div class="min-w-0">
          <p class="font-semibold text-coral">部分資料載入失敗</p>
          <p class="mt-1 text-caption text-subtle">
            {activityDataStatus.failedLabels.join(
              "、",
            )}目前無法取得；以下仍顯示已成功載入的資料。
          </p>
        </div>
        <Button
          class="h-11 shrink-0"
          variant="outline"
          disabled={activityRetryPending}
          onclick={retryActivityData}
          >{activityRetryPending ? "重試中…" : "重試活動資料"}</Button
        >
      </div>
    {/if}
    {#if !searching}
      <section class="min-w-0" aria-label={`${timelineLabel}收支`}>
        <div
          class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="min-w-0">
            <h2 class="text-base font-semibold">{timelineLabel}收支</h2>
            <p class="sr-only">
              {activitySummaryIncomplete
                ? "資料尚未完整載入"
                : "銀行與信用卡活動，含未配對發票，不計入已排除活動"}
            </p>
          </div>
          <label
            class="flex shrink-0 items-center gap-2 text-caption text-subtle"
          >
            <span>期間</span>
            <select
              class="h-9 rounded-lg border border-ink/15 bg-paper px-2.5 text-sm font-medium text-ink outline-none focus:border-steel focus:ring-2 focus:ring-steel/20"
              aria-label="活動時間範圍"
              value={timelinePreset}
              onchange={handleTimelinePresetChange}
            >
              <option value="current">本月</option>
              <option value="3months">近 3 個月</option>
              <option value="6months">近 6 個月</option>
              <option value="salary">薪資週期</option>
              <option value="custom">自訂期間</option>
            </select>
          </label>
        </div>
        {#if timelinePreset === "salary"}
          <div
            class="mt-1 flex flex-wrap items-center gap-2 text-caption text-subtle"
          >
            <span>資金週期：{timelineLabel}</span>
            <details class="relative">
              <summary class="cursor-pointer font-semibold text-steel">
                發薪日：{salaryDayLabel(Number(salaryDay))}
              </summary>
              <div
                class="absolute left-0 z-10 mt-2 grid w-48 gap-2 rounded-xl border border-ink/10 bg-paper p-3 shadow-lg"
              >
                <label
                  class="grid gap-1 text-caption text-subtle"
                  for="activity-salary-day"
                >
                  每月入帳日
                  <Select
                    id="activity-salary-day"
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
          </div>
        {/if}
        {#if timelinePreset === "custom"}
          <div class="mt-1 grid grid-cols-2 gap-2 sm:max-w-md">
            <label class="grid gap-1 text-caption text-subtle">
              開始月份
              <Input type="month" bind:value={timelineFrom} class="h-10" />
            </label>
            <label class="grid gap-1 text-caption text-subtle">
              結束月份
              <Input type="month" bind:value={timelineTo} class="h-10" />
            </label>
          </div>
        {/if}
        <div class="mt-2 grid grid-cols-3 gap-2 md:gap-4">
          <div class="min-w-0">
            <button
              class="w-full rounded-lg px-1 py-1 text-left transition hover:bg-ink/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel/40 disabled:cursor-default disabled:hover:bg-transparent"
              aria-expanded={expandedCashFlowSection === "income"}
              disabled={activitySummaryIncomplete}
              onclick={() => toggleCashFlowSection("income")}
            >
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-medium text-ink">收入</p>
                <ChevronRight
                  class={`size-4 text-subtle transition ${expandedCashFlowSection === "income" ? "rotate-90" : ""}`}
                />
              </div>
              <p
                class="mt-1 whitespace-nowrap text-sm font-semibold tracking-tight text-moss tabular-nums sm:text-lg md:text-2xl"
              >
                {activitySummaryIncomplete
                  ? "—"
                  : `+${formatCurrency(incomeTotal)}`}
              </p>
              <p class="mt-1 text-[11px] text-subtle">
                一般 {formatCurrency(ordinaryIncomeTotal)} · 投資收入 {formatCurrency(
                  investmentIncomeTotal,
                )}
              </p>
            </button>
          </div>
          <div class="min-w-0">
            <button
              class="w-full rounded-lg px-1 py-1 text-left transition hover:bg-ink/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel/40 disabled:cursor-default disabled:hover:bg-transparent"
              aria-expanded={expandedCashFlowSection === "expense"}
              disabled={activitySummaryIncomplete}
              onclick={() => toggleCashFlowSection("expense")}
            >
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-medium text-ink">支出</p>
                <ChevronRight
                  class={`size-4 text-subtle transition ${expandedCashFlowSection === "expense" ? "rotate-90" : ""}`}
                />
              </div>
              <p
                class="mt-1 whitespace-nowrap text-sm font-semibold tracking-tight text-coral tabular-nums sm:text-lg md:text-2xl"
              >
                {activitySummaryIncomplete
                  ? "—"
                  : `−${formatCurrency(expenseTotal)}`}
              </p>
              <p class="mt-1 text-[11px] text-subtle">
                一般 {formatCurrency(ordinaryExpenseTotal)} · 投資投入 {formatCurrency(
                  investmentExpenseTotal,
                )}
              </p>
            </button>
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink">淨流入</p>
            <p
              class={`mt-1 whitespace-nowrap text-sm font-semibold tracking-tight tabular-nums sm:text-lg md:text-2xl ${incomeTotal >= expenseTotal ? "text-moss" : "text-coral"}`}
            >
              {activitySummaryIncomplete
                ? "—"
                : formatCurrency(incomeTotal - expenseTotal)}
            </p>
          </div>
        </div>
        {#if expandedCashFlowSection && !activitySummaryIncomplete}
          <div class="mt-3 rounded-lg border border-ink/10 bg-ink/2 p-2">
            <div class="grid gap-1 sm:grid-cols-2">
              {#each expandedCashFlowSection === "income" ? incomeBreakdowns : expenseBreakdowns as breakdown (breakdown.key)}
                <button
                  class="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs transition hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel/40"
                  aria-expanded={expandedCashFlowBreakdown === breakdown.key}
                  onclick={() => toggleCashFlowBreakdown(breakdown.key)}
                >
                  <span class="flex min-w-0 items-center gap-1.5">
                    <ChevronRight
                      class={`size-3.5 shrink-0 text-subtle transition ${expandedCashFlowBreakdown === breakdown.key ? "rotate-90" : ""}`}
                    />
                    <span class="truncate">{breakdown.label}</span>
                  </span>
                  <strong class="shrink-0 tabular-nums"
                    >{formatCurrency(breakdown.amount)}</strong
                  >
                </button>
              {/each}
            </div>
            {#if expandedCashFlowBreakdown}
              {@render cashFlowDetailsPanel(
                expandedCashFlowBreakdown === "ordinaryIncome"
                  ? "一般收入"
                  : expandedCashFlowBreakdown === "investmentIncome"
                    ? "投資收入"
                    : expandedCashFlowBreakdown === "ordinaryExpense"
                      ? "一般支出"
                      : "投資投入",
                (expandedCashFlowBreakdown === "ordinaryIncome" ||
                expandedCashFlowBreakdown === "investmentIncome"
                  ? incomeBreakdowns
                  : expenseBreakdowns
                ).find((row) => row.key === expandedCashFlowBreakdown)
                  ?.amount ?? 0,
                (expandedCashFlowBreakdown === "ordinaryIncome" ||
                expandedCashFlowBreakdown === "investmentIncome"
                  ? incomeBreakdowns
                  : expenseBreakdowns
                ).find((row) => row.key === expandedCashFlowBreakdown)
                  ?.previousAmount ?? 0,
              )}
            {/if}
          </div>
        {/if}
      </section>

      <section
        class="min-w-0 border-t border-ink/10 pt-4"
        aria-label="分類摘要"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-base font-semibold">{timelineLabel}分類</h2>
            <p class="mt-1 text-caption text-subtle">點選分類查看明細。</p>
          </div>
          <span class="shrink-0 text-caption text-subtle">
            對比{comparisonLabel}
          </span>
        </div>
        {#if activitySummaryIncomplete}
          <p
            class="mt-3 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-900"
          >
            活動資料尚未完整載入，分類摘要暫不計算。
          </p>
        {:else}
          <div class="mt-4 grid min-w-0 gap-5">
            <section class="min-w-0" aria-label="收入分類">
              <div class="flex items-baseline justify-between gap-3">
                <h3 class="text-sm font-semibold text-moss">收入分類</h3>
                <strong class="text-sm tabular-nums text-moss"
                  >+{formatCurrency(ordinaryIncomeTotal)}</strong
                >
              </div>
              {#if incomeSummaryRows.length === 0}
                <p
                  class="mt-2 rounded-lg bg-ink/3 px-3 py-3 text-sm text-subtle"
                >
                  此期間沒有收入。
                </p>
              {:else}
                <div class="mt-2 divide-y divide-ink/8">
                  {#each incomeSummaryRows as row (row.category)}
                    <button
                      class={`w-full rounded-md px-2 py-2.5 text-left transition hover:bg-ink/4 ${selectedCategory?.flow === "income" && selectedCategory.category === row.category ? "bg-ink/5 shadow-[inset_3px_0_0_var(--color-moss)]" : ""}`}
                      aria-pressed={selectedCategory?.flow === "income" &&
                        selectedCategory.category === row.category}
                      onclick={() => chooseCategory("income", row.category)}
                    >
                      <div
                        class="flex items-center justify-between gap-3 text-sm"
                      >
                        <span class="flex min-w-0 items-center gap-2">
                          <span
                            class="size-2.5 shrink-0 rounded-full"
                            style={`background-color:${row.color}`}
                          ></span>
                          <span class="truncate font-medium"
                            >{row.category}</span
                          >
                        </span>
                        <strong class="shrink-0 tabular-nums"
                          >{formatCurrency(row.amount)}</strong
                        >
                      </div>
                      <div
                        class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/8"
                      >
                        <div
                          class="h-full rounded-full bg-moss"
                          style={`width: ${Math.max(8, (row.amount / Math.max(...incomeSummaryRows.map((item) => item.amount), 1)) * 100)}%`}
                        ></div>
                      </div>
                      <div
                        class="mt-1 flex justify-between gap-2 pl-4 text-xs text-subtle"
                      >
                        <span
                          >{comparisonLabel}
                          {formatCurrency(row.previousAmount)}</span
                        >
                        <span
                          class={row.amount > row.previousAmount
                            ? "text-moss"
                            : row.amount < row.previousAmount
                              ? "text-coral"
                              : ""}
                        >
                          {row.amount === row.previousAmount
                            ? "相同"
                            : `${row.amount > row.previousAmount ? "高" : "低"} ${formatCurrency(Math.abs(row.amount - row.previousAmount))}`}
                        </span>
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
            </section>

            <section class="min-w-0" aria-label="一般支出分類">
              <div class="flex items-baseline justify-between gap-3">
                <h3 class="text-sm font-semibold text-coral">一般支出分類</h3>
                <strong class="text-sm tabular-nums text-coral"
                  >−{formatCurrency(ordinaryExpenseTotal)}</strong
                >
              </div>
              {#if expenseSummaryRows.length === 0}
                <p
                  class="mt-2 rounded-lg bg-ink/3 px-3 py-3 text-sm text-subtle"
                >
                  此期間沒有一般支出。
                </p>
              {:else}
                <div class="mt-2 divide-y divide-ink/8">
                  {#each expenseSummaryRows as row (row.category)}
                    <button
                      class={`w-full rounded-md px-2 py-2.5 text-left transition hover:bg-ink/4 ${selectedCategory?.flow === "expense" && selectedCategory.category === row.category ? "bg-ink/5 shadow-[inset_3px_0_0_var(--color-coral)]" : ""}`}
                      aria-pressed={selectedCategory?.flow === "expense" &&
                        selectedCategory.category === row.category}
                      onclick={() => chooseCategory("expense", row.category)}
                    >
                      <div
                        class="flex items-center justify-between gap-3 text-sm"
                      >
                        <span class="flex min-w-0 items-center gap-2">
                          <span
                            class="size-2.5 shrink-0 rounded-full"
                            style={`background-color:${row.color}`}
                          ></span>
                          <span class="truncate font-medium"
                            >{row.category}</span
                          >
                        </span>
                        <strong class="shrink-0 tabular-nums"
                          >{formatCurrency(row.amount)}</strong
                        >
                      </div>
                      <div
                        class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/8"
                      >
                        <div
                          class="h-full rounded-full bg-coral"
                          style={`width: ${Math.max(8, (row.amount / largestExpenseSummary) * 100)}%`}
                        ></div>
                      </div>
                      <div
                        class="mt-1 flex justify-between gap-2 pl-4 text-xs text-subtle"
                      >
                        <span
                          >{comparisonLabel}
                          {formatCurrency(row.previousAmount)}</span
                        >
                        <span
                          class={row.amount > row.previousAmount
                            ? "text-coral"
                            : row.amount < row.previousAmount
                              ? "text-moss"
                              : ""}
                        >
                          {row.amount === row.previousAmount
                            ? "相同"
                            : `${row.amount > row.previousAmount ? "高" : "低"} ${formatCurrency(Math.abs(row.amount - row.previousAmount))}`}
                        </span>
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
            </section>
          </div>
          {#if investmentRows.length > 0 && !selectedCategory}
            <section
              class="mt-5 border-t border-ink/10 pt-4"
              aria-label="投資相關"
            >
              <div class="flex items-baseline justify-between gap-3">
                <h3 class="text-sm font-semibold text-steel">投資現金流</h3>
                <span class="text-xs text-subtle"
                  >投入計入支出 · 收入計入收入</span
                >
              </div>
              <div class="mt-2 grid gap-1.5 sm:grid-cols-2">
                {#each investmentRows as row (row.category)}
                  <div
                    class="flex items-center justify-between gap-3 rounded-md bg-steel/5 px-3 py-2.5"
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      <span
                        class="size-2.5 shrink-0 rounded-full"
                        style={`background-color:${row.color}`}
                      ></span>
                      <span class="truncate text-sm font-medium"
                        >{row.category}</span
                      >
                    </span>
                    <span class="shrink-0 text-right">
                      <strong class="block text-sm tabular-nums"
                        >{formatCurrency(row.amount)}</strong
                      >
                      <span class="block text-xs text-subtle"
                        >{comparisonLabel}
                        {formatCurrency(row.previousAmount)}</span
                      >
                    </span>
                  </div>
                {/each}
              </div>
            </section>
          {/if}
        {/if}
      </section>

      <details class="order-2 mt-4 min-w-0 border-t border-ink/10 pt-1">
        <summary
          class="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-steel"
        >
          查看現金流趨勢
        </summary>
        <section class="hidden min-w-0 border-t border-ink/10 pt-5 md:block">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-base font-semibold">現金流趨勢</h2>
            <span class="text-caption text-subtle">6 個月　收入／支出</span>
          </div>
          <div class="pt-5">
            {#if activitySummaryIncomplete}
              <div
                class="rounded-xl border border-amber-200/80 bg-amber-50 p-6 text-center text-sm text-amber-900"
              >
                活動資料尚未完整載入，現金流趨勢暫不計算。
              </div>
            {:else}
              <div class="grid grid-cols-6 gap-3">
                {#each cashFlow as point (point.month)}
                  <button
                    aria-pressed={selectedMonth === point.month}
                    class={`grid min-w-0 justify-items-center px-1 pb-2 pt-3 text-center transition ${selectedMonth === point.month ? "bg-ink/4 shadow-[inset_0_-2px_0_var(--color-steel)]" : "hover:bg-ink/3"}`}
                    onclick={() => chooseMonth(point.month)}
                  >
                    <div
                      class="flex h-28 w-full items-end justify-center gap-2"
                    >
                      <span
                        class="w-1/3 rounded-t-sm bg-emerald-700"
                        style={`height:${Math.max(8, (point.income / maxCashFlow) * 100)}%`}
                      ></span><span
                        class="w-1/3 rounded-t-sm bg-coral"
                        style={`height:${Math.max(8, (point.expense / maxCashFlow) * 100)}%`}
                      ></span>
                    </div>
                    <span class="mt-2 w-full text-caption font-semibold"
                      >{Number(point.month.slice(5))} 月</span
                    ><span
                      class="mt-1 w-full truncate text-caption font-medium tabular-nums text-moss"
                      >+{formatCompactTwd(point.income)}</span
                    ><span
                      class="w-full truncate text-caption font-medium tabular-nums text-coral"
                      >−{formatCompactTwd(point.expense)}</span
                    >
                  </button>
                {/each}
              </div>
              <div
                class="mt-3 flex items-center justify-between text-caption text-subtle"
              >
                <span
                  ><span class="text-emerald-700">■</span> 收入　<span
                    class="text-coral">■</span
                  > 支出</span
                ><button
                  class="font-semibold text-steel"
                  onclick={() => chooseMonth(currentMonth)}>回到本月</button
                >
              </div>
            {/if}
          </div>
        </section>
      </details>
    {/if}
    <details
      id="activity-list"
      class="order-1 min-w-0 max-w-full scroll-mt-4 overflow-hidden border-t border-ink/10 pt-4"
      open={searching || Boolean(selectedCategory)}
    >
      <summary
        class="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-steel"
      >
        <span>
          {searching
            ? `搜尋結果 · 已載入 ${filtered.length} 筆`
            : selectedCategory
              ? `${timelineLabel} · ${selectedCategory.category}`
              : `${timelineLabel}完整交易時間線`}
        </span>
        <span class="shrink-0 text-xs font-normal text-subtle"
          >{filtered.length} 筆</span
        >
      </summary>
      <section
        class="min-w-0 max-w-full overflow-hidden pt-3"
        aria-label="活動列表"
      >
        <header class="grid min-w-0 gap-3 pb-4">
          <div
            class="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between"
          >
            <div class="min-w-0">
              <h2 class="truncate text-base font-semibold">
                {searching
                  ? `已載入 ${filtered.length} 筆`
                  : selectedCategory
                    ? `${timelineLabel} · ${selectedCategory.flow === "income" ? "收入" : "支出"} · ${selectedCategory.category}`
                    : flow === "income"
                      ? `${timelineLabel} · 收入`
                      : flow === "expense"
                        ? `${timelineLabel} · 支出`
                        : "所有活動"}
              </h2>
            </div>
          </div>
          {#if selectedCategory}<div
              class="flex items-center justify-between border-y border-ink/8 py-2 text-sm"
            >
              <span
                ><strong>{selectedCategory.category}</strong> · {selectedCategory.flow ===
                "income"
                  ? "收入"
                  : "支出"}</span
              ><button
                class="min-h-8 px-2 text-caption font-semibold text-steel"
                onclick={clearCategoryFilter}>清除分類</button
              >
            </div>{/if}
          {#if !searching}
            <details class="rounded-lg border border-ink/10 px-3">
              <summary
                class="flex min-h-10 cursor-pointer items-center text-sm font-medium text-steel"
              >
                篩選來源與搜尋本月{source !== "all"
                  ? ` · ${{ bank: "銀行", card: "信用卡", invoice: "發票" }[source]}`
                  : ""}
              </summary>
              <div class="grid gap-2 pb-3">
                <Input
                  type="search"
                  aria-label="搜尋該月活動"
                  placeholder="搜尋該月活動"
                  class="h-11"
                  bind:value={monthlySearch}
                />
                <div class="grid min-w-0 gap-1.5">
                  <span class="text-caption font-semibold text-subtle"
                    >來源</span
                  >
                  <TabsList
                    aria-label="活動來源"
                    class="grid h-auto w-full grid-cols-4"
                    >{#each [{ key: "all", label: "全部" }, { key: "bank", label: "銀行" }, { key: "card", label: "信用卡" }, { key: "invoice", label: "發票" }] as filter (filter.key)}<TabsTrigger
                        class="min-h-9 min-w-0 px-1 text-caption md:text-sm"
                        active={source === filter.key}
                        onclick={() =>
                          (source = filter.key as ActivitySourceFilter)}
                        >{filter.label}</TabsTrigger
                      >{/each}</TabsList
                  >
                </div>
              </div>
            </details>
          {/if}
        </header>
        <div class="min-w-0">
          <div class="min-w-0 md:hidden">
            {#if filteredGroups.length === 0}<p
                class="p-8 text-center text-sm text-subtle"
              >
                {searching && invalidSearchDates
                  ? "請調整搜尋日期。"
                  : fillingSearchBatch
                    ? "搜尋活動中…"
                    : activityDataStatus.hasFailure
                      ? "部分資料目前無法顯示，請重試後再查看。"
                      : "沒有符合條件的活動。"}
              </p>{:else}
              {#each filteredGroups as group (group.dateKey)}<div
                  class="flex items-center justify-between border-t border-ink/8 py-2.5 text-caption"
                >
                  <span class="font-medium text-subtle"
                    >{searching
                      ? `${group.dateKey.slice(0, 4)} 年 `
                      : ""}{formatActivityDateGroup(group.dateKey)}</span
                  ><span class="text-subtle">{group.items.length} 筆</span>
                </div>
                <div class="divide-y divide-ink/8">
                  {#each group.items as item (item.source + "-" + item.id)}{@const amount =
                      activityDisplayAmount(item)}{@const time =
                      formatActivityTime(item)}
                    <button
                      aria-label={`查看 ${item.title} 活動詳情`}
                      class={`flex w-full min-w-0 items-center gap-3 py-3.5 text-left transition hover:bg-ink/3 ${item.excludedFromCalculation ? "bg-ink/[0.025]" : ""}`}
                      onclick={() => openDetail(item)}
                    >
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-semibold">
                          <SearchHighlight
                            text={item.title}
                            query={submittedSearch}
                          />
                        </p>
                        {#if searching && item.searchText
                            ?.toLowerCase()
                            .includes(submittedSearch.toLowerCase()) && !item.title
                            .toLowerCase()
                            .includes(submittedSearch.toLowerCase())}
                          <p class="mt-1 truncate text-caption text-subtle">
                            <SearchHighlight
                              text={item.searchText}
                              query={submittedSearch}
                            />
                          </p>
                        {/if}
                        {#if time}<p
                            class="mt-0.5 text-xs font-medium tabular-nums text-subtle"
                          >
                            {time}
                          </p>{/if}
                        {#if item.sourceSummary}<p
                            class="mt-0.5 truncate text-xs font-medium text-steel"
                          >
                            {item.sourceSummary}
                          </p>{/if}
                        <p
                          class="mt-0.5 truncate text-caption font-medium text-subtle"
                        >
                          {item.institutionName ?? sourceLabel(item)}
                        </p>
                        <p class="mt-0.5 truncate text-xs text-subtle">
                          {[item.accountName, item.category]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {#if hasCashFlowLabel(item)}<Badge
                            variant="secondary"
                            class="mt-1 bg-steel/10 text-steel"
                            >{cashTransferLabel(item)}</Badge
                          >{/if}
                      </div>
                      <div class="flex shrink-0 items-center gap-1.5">
                        <div class="max-w-[40vw] text-right">
                          <p
                            class={`truncate text-sm font-semibold tabular-nums ${item.excludedFromCalculation ? "text-subtle line-through" : (amount ?? 0) < 0 ? "text-coral" : item.source !== "invoice" ? "text-moss" : ""}`}
                          >
                            <ActivityAmount
                              {item}
                              rates={rateValues}
                              exchangeRates={$rates.data}
                            />
                          </p>
                          <p class="mt-1 text-xs text-subtle">
                            {activityStatusLabel(item)}
                          </p>
                        </div>
                        <ChevronRight class="size-4 text-subtle" />
                      </div>
                    </button>{/each}
                </div>{/each}{/if}
          </div>
          <div class="hidden overflow-x-auto md:block">
            {#if filteredGroups.length === 0}<p
                class="p-8 text-center text-sm text-subtle"
              >
                {searching && invalidSearchDates
                  ? "請調整搜尋日期。"
                  : fillingSearchBatch
                    ? "搜尋活動中…"
                    : activityDataStatus.hasFailure
                      ? "部分資料目前無法顯示，請重試後再查看。"
                      : "沒有符合條件的活動。"}
              </p>{:else}<table
                class="w-full min-w-[760px] table-fixed text-left text-sm"
              >
                <colgroup
                  ><col /><col class="w-56" /><col class="w-36" /><col
                    class="w-44"
                  /></colgroup
                >
                <thead
                  class="border-b border-ink/8 text-caption font-semibold text-subtle"
                  ><tr
                    ><th class="py-2.5 pr-4">商家／說明</th><th
                      class="px-4 py-2.5">銀行／帳戶</th
                    ><th class="px-4 py-2.5">分類</th><th
                      class="py-2.5 pl-4 text-right">金額</th
                    ></tr
                  ></thead
                >
              </table>
              {#each filteredGroups as group (group.dateKey)}<div
                  class="flex min-w-[760px] items-center justify-between border-t border-ink/8 py-2.5 text-caption"
                >
                  <span class="font-medium text-subtle"
                    >{searching
                      ? `${group.dateKey.slice(0, 4)} 年 `
                      : ""}{formatActivityDateGroup(group.dateKey)}</span
                  ><span class="text-subtle">{group.items.length} 筆</span>
                </div>
                <table
                  class="w-full min-w-[760px] table-fixed text-left text-sm"
                >
                  <colgroup
                    ><col /><col class="w-56" /><col class="w-36" /><col
                      class="w-44"
                    /></colgroup
                  >
                  <tbody class="divide-y divide-ink/8"
                    >{#each group.items as item (item.source + "-" + item.id)}{@const amount =
                        activityDisplayAmount(item)}{@const time =
                        formatActivityTime(item)}<tr
                        aria-label={`查看 ${item.title} 活動詳情`}
                        class={`cursor-pointer transition hover:bg-ink/3 focus-visible:outline-2 focus-visible:outline-steel ${item.excludedFromCalculation ? "bg-ink/[0.025]" : ""}`}
                        onclick={() => openDetail(item)}
                        onkeydown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openDetail(item);
                          }
                        }}
                        role="button"
                        tabindex="0"
                        ><td class="min-w-0 py-3.5 pr-4"
                          ><p class="truncate font-semibold">
                            <SearchHighlight
                              text={item.title}
                              query={submittedSearch}
                            />
                          </p>
                          {#if searching && item.searchText
                              ?.toLowerCase()
                              .includes(submittedSearch.toLowerCase()) && !item.title
                              .toLowerCase()
                              .includes(submittedSearch.toLowerCase())}
                            <p class="mt-1 truncate text-caption text-subtle">
                              <SearchHighlight
                                text={item.searchText}
                                query={submittedSearch}
                              />
                            </p>
                          {/if}
                          {#if time}<p
                              class="mt-1 text-caption font-medium tabular-nums text-subtle"
                            >
                              {time}
                            </p>{/if}
                          {#if item.sourceSummary}<p
                              class="mt-1 truncate text-caption font-medium text-steel"
                            >
                              {item.sourceSummary}
                            </p>{/if}
                          {#if item.transactionId && item.invoiceId && itemMappingDifference(item) > 0}<Badge
                              variant="secondary"
                              class="mt-1 bg-amber-50 text-amber-800"
                              >點數折抵 {formatCurrency(
                                itemMappingDifference(item),
                              )}</Badge
                            >{/if}</td
                        ><td class="px-4 py-3.5"
                          ><p class="truncate font-medium text-subtle">
                            {item.institutionName ?? sourceLabel(item)}
                          </p>
                          {#if item.accountName}<p
                              class="mt-1 truncate text-caption text-subtle"
                            >
                              {item.accountName}
                            </p>{/if}</td
                        ><td class="px-4 py-3.5"
                          ><div class="flex flex-wrap gap-1.5">
                            <Badge variant="secondary">{item.category}</Badge>
                            {#if hasCashFlowLabel(item)}<Badge
                                variant="secondary"
                                class="bg-steel/10 text-steel"
                                >{cashTransferLabel(item)}</Badge
                              >{/if}
                          </div></td
                        ><td class="py-3.5 pl-4"
                          ><div class="flex items-center justify-end gap-2">
                            <div class="min-w-0 text-right">
                              <p
                                class={`truncate whitespace-nowrap font-semibold tabular-nums ${item.excludedFromCalculation ? "text-subtle line-through" : (amount ?? 0) < 0 ? "text-coral" : item.source !== "invoice" ? "text-moss" : ""}`}
                              >
                                <ActivityAmount
                                  {item}
                                  rates={rateValues}
                                  exchangeRates={$rates.data}
                                />
                              </p>
                              <p class="mt-1 text-caption text-subtle">
                                {activityStatusLabel(item)}
                              </p>
                            </div>
                            <ChevronRight class="size-4 shrink-0 text-subtle" />
                          </div></td
                        ></tr
                      >{/each}</tbody
                  >
                </table>{/each}{/if}
          </div>
        </div>
      </section>
    </details>
    {#if searching && $searchResults.hasNextPage && !invalidSearchDates}
      <div
        bind:this={searchSentinel}
        data-testid="search-load-more"
        class="flex min-h-11 justify-center items-center"
      >
        {#if $searchResults.isError}
          <Button
            variant="outline"
            class="h-11"
            disabled={$searchResults.isFetching}
            onclick={() => $searchResults.fetchNextPage()}>重試載入更多</Button
          >
        {:else}
          <p role="status" class="text-sm text-subtle">
            {$searchResults.isFetching ? "載入中…" : "往下捲動載入更多"}
          </p>
        {/if}
      </div>
    {/if}
    {#if detailItem}
      {@const amount = activityDisplayAmount(detailItem)}
      {@const transaction = transactionForItem(detailItem)}
      {@const invoice = invoiceForItem(detailItem)}
      <div class="fixed inset-0 z-[60] bg-ink/40 md:flex md:justify-end">
        <button
          aria-label="關閉活動明細"
          class="absolute inset-0 hidden md:block"
          onclick={closeDetail}
        ></button>
        <div
          aria-labelledby="activity-detail-title"
          aria-modal="true"
          class="relative flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl md:max-w-[32rem]"
          role="dialog"
          use:swipeBack={{
            enabled:
              document.documentElement.classList.contains("is-standalone"),
            onBack: closeDetail,
          }}
        >
          <header
            class="flex shrink-0 items-center justify-between border-b border-ink/10 px-4 py-3 md:px-6"
          >
            <div class="flex min-w-0 items-center gap-2">
              <button
                aria-label="返回活動列表"
                class="flex size-11 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-paper"
                onclick={closeDetail}
                ><ArrowLeft class="size-5 md:hidden" /><X
                  class="hidden size-5 md:block"
                /></button
              >
              <h2
                class="truncate text-lg font-semibold"
                id="activity-detail-title"
              >
                活動明細
              </h2>
            </div>
            <span class="text-caption font-medium text-subtle"
              >{sourceLabel(detailItem)}</span
            >
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-7 md:py-6">
            <section class="border-b border-ink/10 pb-5">
              <div
                class="flex flex-col items-start justify-between gap-4 sm:flex-row"
              >
                <div class="min-w-0">
                  <h3 class="break-words text-xl font-semibold leading-snug">
                    {detailItem.title}
                  </h3>
                  <p class="mt-1 text-sm text-subtle">
                    {formatActivityDate(detailItem)}{#if transaction}
                      · {mappingAccount(transaction)}
                    {/if}
                  </p>
                </div>
                <p
                  class={`shrink-0 pt-1 text-lg font-bold tabular-nums ${detailItem.excludedFromCalculation ? "text-subtle line-through" : (amount ?? 0) < 0 ? "text-coral" : detailItem.source !== "invoice" ? "text-moss" : ""}`}
                >
                  <ActivityAmount
                    item={detailItem}
                    rates={rateValues}
                    exchangeRates={$rates.data}
                    detail
                  />
                </p>
              </div>
              <Badge variant="secondary" class="mt-3"
                >{detailItem.category}</Badge
              >
              {#if hasCashFlowLabel(detailItem)}<Badge
                  variant="secondary"
                  class="ml-2 mt-3 bg-steel/10 text-steel"
                  >{cashTransferLabel(detailItem)}</Badge
                >{/if}
              {#if detailItem.invoicePaymentMethod === "cash"}<Badge
                  variant="secondary"
                  class="ml-2 mt-3 bg-amber-50 text-amber-800"
                  >現金支付 · 會扣除現金餘額</Badge
                >{/if}
              {#if detailItem.invoicePaymentMethod === "card"}<Badge
                  variant="secondary"
                  class="ml-2 mt-3 bg-steel/10 text-steel"
                  >{detailItem.invoicePaymentAccountSource === "selected"
                    ? "已指定信用卡 · 待交易核對"
                    : "依商家推定信用卡 · 待確認"}</Badge
                >{/if}
              {#if detailItem.excludedFromCalculation}<Badge
                  variant="secondary"
                  class="ml-2 mt-3">已排除計算</Badge
                >{/if}
              {#if transaction && invoice && itemMappingDifference(detailItem) > 0}<Badge
                  variant="secondary"
                  class="ml-2 mt-3 bg-amber-50 text-amber-800"
                  >點數折抵 {formatCurrency(
                    itemMappingDifference(detailItem),
                  )}</Badge
                >{/if}
            </section>

            <section class="border-b border-ink/10 py-5">
              <h3 class="text-base font-semibold">來源名稱</h3>
              <div class="mt-3 grid gap-3">
                {#if transaction}<div class="rounded-xl bg-steel/10 p-4">
                    <p class="text-caption font-semibold text-steel">
                      銀行／信用卡原始名稱
                    </p>
                    <p class="mt-1 break-words font-semibold">
                      {mappingMerchant(transaction)}
                    </p>
                    {#if transaction.description && transaction.description !== mappingMerchant(transaction)}<p
                        class="mt-1 break-words text-caption text-subtle"
                      >
                        {transaction.description}
                      </p>{/if}
                    <p class="mt-1 text-caption text-subtle">
                      {mappingAccount(transaction)} · 實付 {formatCurrency(
                        Math.abs(transaction.amount),
                        transaction.currency,
                      )}
                    </p>
                    {#if transaction.sourceSummary}<p
                        class="mt-2 text-caption font-medium text-steel"
                      >
                        原始交易類型：{transaction.sourceSummary}
                      </p>{/if}
                  </div>{/if}
                {#if invoice}<div class="rounded-xl bg-coral/10 p-4">
                    <p class="text-caption font-semibold text-coral">
                      發票商家名稱
                    </p>
                    <p class="mt-1 break-words font-semibold">
                      {invoice.sellerName ?? "電子發票"}
                    </p>
                    <div class="mt-4 border-t border-coral/15 pt-3">
                      <label class="grid gap-1 text-caption font-semibold">
                        分類使用的商家
                        <Select
                          class="h-10 bg-white text-sm"
                          value={$detailInvoice.data?.classificationMerchant
                            ?.id ?? ""}
                          disabled={$invoiceMerchantMutation.isPending ||
                            $createInvoiceMerchantMutation.isPending}
                          onchange={(event: Event) =>
                            setInvoiceMerchant(
                              invoice.id,
                              (event.currentTarget as HTMLSelectElement).value,
                            )}
                        >
                          <option value="">使用發票原始名稱</option>
                          {#each $classificationMerchants.data?.merchants ?? [] as merchant (merchant.id)}
                            <option value={merchant.id}>{merchant.name}</option>
                          {/each}
                        </Select>
                      </label>
                      <p class="mt-1 text-caption text-subtle">
                        指定後，這張發票的所有品項會套用該商家的產品分類規則。
                      </p>
                      <form
                        class="mt-2 flex gap-2"
                        onsubmit={(event) =>
                          createAndSetInvoiceMerchant(event, invoice.id)}
                      >
                        <Input
                          class="min-w-0 flex-1 bg-white text-sm"
                          aria-label="新增並指定發票商家"
                          placeholder="找不到商家？直接新增"
                          bind:value={newInvoiceMerchantName}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={!newInvoiceMerchantName.trim() ||
                            $createInvoiceMerchantMutation.isPending}
                          >新增並指定</Button
                        >
                      </form>
                      {#if $invoiceMerchantMutation.isError || $createInvoiceMerchantMutation.isError}
                        <p class="mt-2 text-caption text-coral" role="alert">
                          商家指定失敗，請重新整理後再試。
                        </p>
                      {/if}
                    </div>
                    <p class="mt-1 text-caption text-subtle">
                      發票 {invoice.invoiceNumber ?? "無發票號碼"} · 總額
                      {formatCurrency(invoice.amount)}
                    </p>
                  </div>{/if}
                {#if !transaction && invoice}<div
                    class="rounded-xl bg-amber-50 p-4 text-amber-900"
                  >
                    <p class="font-semibold">
                      {detailItem.invoicePaymentMethod === "cash"
                        ? "已標記為現金支付"
                        : detailItem.invoicePaymentMethod === "card"
                          ? detailItem.invoicePaymentAccountSource ===
                            "selected"
                            ? "已指定信用卡，尚無可核對交易"
                            : "依先前發票紀錄推定信用卡，尚待確認"
                          : "尚未找到銀行／信用卡交易"}
                    </p>
                    <p class="mt-1 text-caption text-subtle">
                      {detailItem.invoicePaymentMethod === "cash"
                        ? "會列入當月支出，並從現金錢包扣除；不會配對銀行／信用卡。"
                        : detailItem.invoicePaymentMethod === "card"
                          ? `${detailItem.institutionName} · ${detailItem.accountName}。發票先列入支出，找到該卡交易後才會合併；不會配到別張卡。`
                          : "仍會列入當月支出；你可以在下方手動配對或標記為現金支付。"}
                    </p>
                  </div>{/if}
                {#if !transaction && !invoice}<div
                    class="rounded-xl bg-paper p-4"
                  >
                    <p class="text-caption font-semibold text-subtle">
                      來源說明
                    </p>
                    <p class="mt-1 break-words font-semibold">
                      {detailItem.subtitle || detailItem.title}
                    </p>
                  </div>{/if}
              </div>
            </section>

            {#if invoice}<section class="border-b border-ink/10 py-5">
                <h3 class="text-base font-semibold">發票細項</h3>
                {#if $detailInvoice.isPending}<p
                    class="mt-3 rounded-xl bg-paper p-4 text-sm text-subtle"
                  >
                    載入發票細項中。
                  </p>{:else if $detailInvoice.isError}<p
                    class="mt-3 rounded-xl bg-coral/10 p-4 text-sm text-coral"
                  >
                    無法載入發票細項，請稍後再試。
                  </p>{:else if !$detailInvoice.data || $detailInvoice.data.items.length === 0}<p
                    class="mt-3 rounded-xl bg-paper p-4 text-sm text-subtle"
                  >
                    此發票沒有品項明細，暫列「未分類」。
                  </p>{:else}<div class="mt-2 divide-y divide-ink/10">
                    {#each $detailInvoice.data.items as line (line.id)}<div
                        class="flex items-start justify-between gap-4 py-3"
                      >
                        <div class="min-w-0">
                          <p class="break-words font-medium">
                            {line.description}
                          </p>
                          <p class="mt-1 text-caption text-subtle">
                            {line.quantity != null
                              ? `${formatNumber(line.quantity)} 件`
                              : "數量未提供"}{line.unitPrice != null
                              ? ` × ${formatCurrency(line.unitPrice)}`
                              : ""}
                            {#if line.settlement === "redeemed"}
                              · <span class="text-moss">兌換，實付 NT$0</span>
                            {/if}
                          </p>
                          {#if (line.lineType ?? "item") === "item" || (line.lineType ?? "item") === "fee"}
                            <Select
                              aria-label={`設定品項 ${line.description} 分類`}
                              class="mt-2 h-10 max-w-44 text-sm"
                              value={line.classification?.categoryId ?? "other"}
                              onchange={(event: Event) =>
                                openInvoiceItemCategory(
                                  line,
                                  (event.currentTarget as HTMLSelectElement)
                                    .value,
                                )}
                              >{#each categoryOptions.filter((category) => category.behavior !== "cash_withdrawal") as category (category.id)}<option
                                  value={category.id}>{category.label}</option
                                >{/each}</Select
                            >
                          {:else}
                            <Badge variant="secondary" class="mt-2">
                              {(line.lineType ?? "item") === "allowance"
                                ? "折讓／折抵"
                                : "退貨／退款"}
                            </Badge>
                          {/if}
                        </div>
                        <p
                          class={`shrink-0 font-semibold tabular-nums ${(line.lineType ?? "item") === "allowance" || (line.lineType ?? "item") === "refund" ? "text-moss" : ""}`}
                        >
                          {(line.lineType ?? "item") === "allowance" ||
                          (line.lineType ?? "item") === "refund"
                            ? "+"
                            : ""}{formatCurrency(
                            (line.lineType ?? "item") === "allowance" ||
                              (line.lineType ?? "item") === "refund"
                              ? Math.abs(line.amount)
                              : (line.paidAmount ?? line.amount),
                          )}
                        </p>
                      </div>{/each}
                  </div>
                  {#if $detailInvoice.data.items.reduce((sum, line) => sum + (line.paidAmount ?? line.amount), 0) !== invoice.amount}<p
                      class="mt-2 text-caption text-amber-800"
                    >
                      品項合計與發票總額相差 {formatCurrency(
                        Math.abs(
                          $detailInvoice.data.items.reduce(
                            (sum, line) =>
                              sum + (line.paidAmount ?? line.amount),
                            0,
                          ) - invoice.amount,
                        ),
                      )}；分類金額已按實際發票總額分攤。
                    </p>{/if}{/if}
              </section>{/if}

            <section class="py-5">
              <h3 class="text-base font-semibold">活動設定</h3>
              <div class="mt-2 divide-y divide-ink/10">
                <div class="flex items-center justify-between gap-4 py-4">
                  <div>
                    <p class="font-semibold">分類</p>
                    {#if invoice?.items?.length}<p
                        class="mt-1 text-caption text-subtle"
                      >
                        請在上方逐項設定；同張發票可有不同分類。
                      </p>
                    {:else if !detailItem.transactionId}<p
                        class="mt-1 text-caption text-subtle"
                      >
                        {invoice
                          ? "沒有品項明細，暫列未分類"
                          : "此來源目前不支援調整"}
                      </p>{/if}
                  </div>
                  {#if detailItem.transactionId && !invoice?.items?.length}<Select
                      aria-label={`更新 ${detailItem.title} 分類`}
                      class="h-11 w-40 shrink-0 font-medium text-steel"
                      value={detailItem.categoryId}
                      onchange={(event: Event) =>
                        openCategory(
                          detailItem,
                          (event.currentTarget as HTMLSelectElement).value,
                        )}
                      >{#each categoryOptions as category (category.id)}<option
                          value={category.id}>{category.label}</option
                        >{/each}</Select
                    >{:else}<Badge variant="secondary"
                      >{detailItem.category}</Badge
                    >{/if}
                </div>

                {#if invoice}<div
                    class="flex items-center justify-between gap-4 py-4"
                  >
                    <div class="min-w-0">
                      <p class="font-semibold">支付方式</p>
                      <p
                        class={`mt-1 text-caption ${transaction ? "text-moss" : "text-coral"}`}
                      >
                        {detailItem.invoicePaymentMethod === "cash"
                          ? "現金支付，會扣除現金餘額"
                          : detailItem.invoicePaymentMethod === "card"
                            ? `${detailItem.invoicePaymentAccountSource === "selected" ? "已指定" : "依紀錄推定"}：${detailItem.institutionName} · ${detailItem.accountName}（待核對）`
                            : transaction
                              ? "已關聯，可變更或解除"
                              : "尚未設定"}
                      </p>
                    </div>
                    <Button
                      class="h-11 shrink-0 whitespace-nowrap"
                      variant={transaction ||
                      detailItem.invoicePaymentMethod === "cash" ||
                      detailItem.invoicePaymentMethod === "card"
                        ? "outline"
                        : "default"}
                      onclick={() => openMapping(detailItem)}
                      >{transaction ||
                      detailItem.invoicePaymentMethod === "cash" ||
                      detailItem.invoicePaymentMethod === "card"
                        ? "管理支付方式"
                        : "關聯支付方式"}</Button
                    >
                  </div>{/if}
              </div>
            </section>
          </div>
        </div>
      </div>
    {/if}
    {#if pending}
      <CategoryUpdateDialog
        bind:update={pending}
        {categories}
        matchCount={countMatches(pending)}
        submitting={$categoryMutation.isPending}
        failed={$categoryMutation.isError}
        onCancel={() => (pending = null)}
        onSubmit={(input) => $categoryMutation.mutate(input)}
      />
    {/if}
    {#if mappingDialog}<div
        aria-modal="true"
        class="fixed inset-0 z-[75] flex items-end bg-ink/45 md:items-center md:justify-center md:p-6"
        role="dialog"
      >
        <div
          class="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl md:max-w-xl md:rounded-2xl md:p-6"
        >
          <div
            class="mx-auto mb-4 h-1.5 w-14 rounded-full bg-ink/20 md:hidden"
          ></div>
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h2 class="text-xl font-semibold">
                {mappingDialog.step === "actions"
                  ? mappingDialog.paymentMethod === "cash"
                    ? "管理支付方式"
                    : "管理支付方式"
                  : mappingDialog.step === "confirm"
                    ? "確認關聯這筆刷卡交易？"
                    : "選擇支付方式"}
              </h2>
              {#if mappingDialog.step === "candidates"}<p
                  class="mt-1 truncate text-sm text-subtle"
                >
                  發票：{mappingDialog.invoice.sellerName ?? "電子發票"} ·
                  {formatCurrency(mappingDialog.invoice.amount)}
                </p>{:else if mappingDialog.step === "confirm"}<p
                  class="mt-1 text-sm text-subtle"
                >
                  關聯只用來避免同一筆消費重複統計；發票明細與刷卡交易都會保留。
                </p>{/if}
            </div>
            <button
              aria-label="關閉配對視窗"
              class="flex size-11 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-paper"
              onclick={() => (mappingDialog = null)}
              ><X class="size-5" /></button
            >
          </div>

          {#if mappingDialog.step === "actions"}
            {@const transaction = selectedMappingTransaction()}
            {#if transaction}<div
                class="mt-5 rounded-xl border border-steel/30 bg-steel/5 p-4"
              >
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <p class="truncate font-semibold">
                      {mappingDialog.invoice.sellerName ?? "電子發票"}
                    </p>
                    <p class="mt-1 truncate text-caption text-subtle">
                      信用卡＋發票 · {mappingDialog.invoice.invoiceNumber ??
                        "無發票號碼"}
                    </p>
                  </div>
                  <p class="shrink-0 font-semibold text-coral">
                    {formatCurrency(-Math.abs(transaction.amount))}
                  </p>
                </div>
                {#if mappingDifference(mappingDialog.invoice, transaction) > 0}<Badge
                    variant="secondary"
                    class="mt-3 bg-amber-50 text-amber-800"
                    >點數折抵 {formatCurrency(
                      mappingDifference(mappingDialog.invoice, transaction),
                    )}</Badge
                  >{/if}
              </div>{/if}
            <div class="mt-5 grid gap-3">
              <Button
                class="h-12 justify-start gap-3"
                variant="outline"
                onclick={() => (mappingDialog!.step = "candidates")}
                ><Link2 class="size-4 text-steel" />變更刷卡關聯</Button
              >
              {#if !mappingDialog.transactionId}<Button
                  class="h-12 justify-start gap-3"
                  variant="outline"
                  disabled={$cashPaymentMutation.isPending}
                  onclick={() =>
                    $cashPaymentMutation.mutate(mappingDialog!.invoice.id)}
                  >{$cashPaymentMutation.isPending
                    ? "更新中…"
                    : mappingDialog.paymentMethod === "cash"
                      ? "維持現金支付"
                      : "標記為現金支付（不配對銀行／信用卡）"}</Button
                >{:else}<p
                  class="rounded-xl bg-amber-50 p-4 text-sm text-amber-900"
                >
                  這張發票已關聯銀行／信用卡；請先解除關聯並確認原交易的處理方式，再標記為現金支付，避免重複記帳。
                </p>{/if}
              <Button
                class="h-12 justify-start gap-3 text-coral"
                disabled={$separationMutation.isPending}
                variant="outline"
                onclick={() =>
                  $separationMutation.mutate(mappingDialog!.invoice.id)}
                ><Unlink2 class="size-4" />{$separationMutation.isPending
                  ? "解除中…"
                  : mappingDialog.paymentMethod === "cash"
                    ? "取消現金標記"
                    : "解除並保持分開"}</Button
              >
            </div>
          {:else if mappingDialog.step === "candidates"}
            <div class="mt-5 grid max-h-[52vh] gap-3 overflow-y-auto pr-1">
              {#if mappingCandidates.length === 0}<div
                  class="rounded-xl border border-dashed border-ink/15 bg-paper p-6 text-center"
                >
                  <p class="font-semibold">同日沒有可關聯的刷卡交易</p>
                  <p class="mt-1 text-caption text-subtle">
                    沒有同日交易也沒關係，可以先記住這張發票使用的信用卡。
                  </p>
                </div>{:else}{#each mappingCandidates as transaction (transaction.id)}{@const difference =
                    mappingDifference(
                      mappingDialog.invoice,
                      transaction,
                    )}<button
                    aria-pressed={mappingDialog.transactionId ===
                      transaction.id}
                    class={`min-h-24 rounded-xl border p-4 text-left transition ${mappingDialog.transactionId === transaction.id ? "border-steel bg-steel/10 ring-2 ring-steel/15" : "border-ink/10 hover:border-steel/40 hover:bg-paper"}`}
                    onclick={() => chooseMappingTransaction(transaction.id)}
                  >
                    <span class="flex items-start justify-between gap-3">
                      <span class="min-w-0">
                        <span class="block truncate font-semibold"
                          >{mappingMerchant(transaction)}</span
                        >
                        <span
                          class="mt-1 block truncate text-caption text-subtle"
                          >{mappingAccount(transaction)} · {formatDate(
                            transaction.authorizedAt ??
                              transaction.postedDate ??
                              "",
                          )}</span
                        >
                      </span>
                      <span class="shrink-0 font-semibold text-coral"
                        >{formatCurrency(-Math.abs(transaction.amount))}</span
                      >
                    </span>
                    <span class="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" class="bg-moss/10 text-moss"
                        >{invoiceTransactionDayDifference(
                          transaction,
                          mappingDialog.invoice,
                        ) === 0
                          ? "同一天"
                          : `相差 ${
                              invoiceTransactionDayDifference(
                                transaction,
                                mappingDialog.invoice,
                              ) ?? 0
                            } 天`}</Badge
                      >{#if invoiceMatches.learnedAccountByInvoice.get(mappingDialog.invoice.id) === transaction.accountId}<Badge
                          variant="secondary"
                          class="bg-steel/10 text-steel">沿用先前卡片</Badge
                        >{/if}{#if difference > 0}<Badge
                          variant="secondary"
                          class="bg-amber-50 text-amber-800"
                          >差額 {formatCurrency(difference)}</Badge
                        >{/if}
                    </span>
                  </button>{/each}{/if}
            </div>
            <section
              class="mt-4 rounded-xl border border-steel/20 bg-steel/5 p-4"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="font-semibold">記住支付卡片</p>
                  <p class="mt-1 text-caption text-subtle">
                    設定這張發票使用的卡；有品項時沿用相同內容，否則沿用商家。找到該卡交易後才會核對。
                  </p>
                </div>
                <CreditCard class="size-5 shrink-0 text-steel" />
              </div>
              {#if creditCardAccounts.length === 0}
                <p class="mt-3 text-sm text-subtle">
                  目前沒有可用的信用卡帳戶。
                </p>
              {:else}
                <div class="mt-3 grid gap-2">
                  {#each creditCardAccounts as account (account.id)}
                    <button
                      type="button"
                      aria-pressed={mappingDialog.paymentAccountId ===
                        account.id}
                      class={`rounded-lg border px-3 py-3 text-left text-sm transition ${mappingDialog.paymentAccountId === account.id ? "border-steel bg-white ring-2 ring-steel/15" : "border-ink/10 bg-white/60 hover:border-steel/40"}`}
                      onclick={() =>
                        (mappingDialog!.paymentAccountId = account.id)}
                    >
                      <span class="font-medium"
                        >{paymentAccountLabel(account)}</span
                      >
                    </button>
                  {/each}
                </div>
                <Button
                  class="mt-3 h-11 w-full"
                  disabled={!mappingDialog.paymentAccountId ||
                    $paymentAccountMutation.isPending}
                  onclick={() =>
                    mappingDialog?.paymentAccountId &&
                    $paymentAccountMutation.mutate({
                      invoiceId: mappingDialog.invoice.id,
                      accountId: mappingDialog.paymentAccountId,
                    })}
                  >{$paymentAccountMutation.isPending
                    ? "儲存中…"
                    : "記住這張卡"}</Button
                >
              {/if}
            </section>
            <Button
              class="mt-4 h-12 w-full"
              variant="outline"
              disabled={$cashPaymentMutation.isPending}
              onclick={() =>
                $cashPaymentMutation.mutate(mappingDialog!.invoice.id)}
              >{$cashPaymentMutation.isPending
                ? "標記中…"
                : "現金支付（不配對銀行／信用卡）"}</Button
            >
            <p class="mt-4 text-caption text-subtle">
              已指定卡片時，只會自動關聯該卡同日同額交易；信用卡帳單仍須另行核對。
            </p>
            <div class="mt-5 grid grid-cols-[7rem_1fr] gap-3">
              <Button
                class="h-12"
                variant="secondary"
                onclick={() => (mappingDialog = null)}>取消</Button
              ><Button
                class="h-12"
                disabled={!mappingDialog.transactionId}
                onclick={() => (mappingDialog!.step = "confirm")}>下一步</Button
              >
            </div>
          {:else}
            {@const transaction = selectedMappingTransaction()}
            {#if transaction}{@const difference = mappingDifference(
                mappingDialog.invoice,
                transaction,
              )}
              <div class="mt-5 grid gap-3">
                <div class="rounded-xl bg-coral/10 p-4">
                  <p class="text-caption font-semibold text-coral">發票</p>
                  <div class="mt-2 flex items-center justify-between gap-4">
                    <p class="truncate font-semibold">
                      {mappingDialog.invoice.sellerName ?? "電子發票"}
                    </p>
                    <p class="shrink-0 font-semibold">
                      {formatCurrency(mappingDialog.invoice.amount)}
                    </p>
                  </div>
                </div>
                <ArrowDown class="mx-auto size-5 text-steel" />
                <div class="rounded-xl bg-steel/10 p-4">
                  <p class="text-caption font-semibold text-steel">
                    銀行／信用卡
                  </p>
                  <div class="mt-2 flex items-center justify-between gap-4">
                    <p class="truncate font-semibold">
                      {mappingMerchant(transaction)}
                    </p>
                    <p class="shrink-0 font-semibold">
                      {formatCurrency(Math.abs(transaction.amount))}
                    </p>
                  </div>
                </div>
                {#if difference > 0}<div
                    class="rounded-xl bg-amber-50 p-4 text-amber-900"
                  >
                    <p class="font-semibold">
                      差額 {formatCurrency(difference)}
                    </p>
                    <p class="mt-1 text-caption text-subtle">
                      可能來自 LINE Pay 點數或其他折抵
                    </p>
                  </div>{/if}
                <p class="text-caption text-subtle">
                  這只會建立關聯；支出仍以刷卡交易為準，發票明細會保留供分類與對帳。當月支出將計入
                  {formatCurrency(Math.abs(transaction.amount))}。
                </p>
              </div>
              <div class="mt-5 grid grid-cols-[7rem_1fr] gap-3">
                <Button
                  class="h-12"
                  variant="secondary"
                  onclick={() => (mappingDialog!.step = "candidates")}
                  >返回</Button
                ><Button
                  class="h-12"
                  disabled={$mappingMutation.isPending}
                  onclick={() =>
                    $mappingMutation.mutate({
                      invoiceId: mappingDialog!.invoice.id,
                      transactionId: transaction.id,
                    })}
                  >{$mappingMutation.isPending ? "配對中…" : "確認配對"}</Button
                >
              </div>
            {:else}<p class="mt-5 text-sm text-coral">
                找不到選取的交易，請返回重新選擇。
              </p>{/if}
          {/if}

          {#if $mappingMutation.isError || $paymentAccountMutation.isError || $separationMutation.isError || $cashPaymentMutation.isError}<p
              class="mt-4 text-sm font-medium text-coral"
            >
              無法更新配對，資料可能已變更，請重新整理後再試。
            </p>{/if}
        </div>
      </div>{/if}
    {#if mappingNotice}<div
        aria-live="polite"
        class="fixed left-1/2 top-20 z-[85] flex w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-xl"
      >
        <Check class="size-5 shrink-0 text-lime-300" />{mappingNotice}
      </div>{/if}
  </div>
{/if}
