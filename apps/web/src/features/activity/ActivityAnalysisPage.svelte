<script lang="ts">
  import { buildActivityItems, type ActivityItem } from "@taiwan-fin-hub/core";
  import { toStore } from "svelte/store";
  import { createQuery } from "@tanstack/svelte-query";
  import { ChevronDown } from "@lucide/svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import type { ApiClient } from "@/shared/api/client";
  import { exchangeRatesQuery } from "@/data/assets/queries";
  import { bankRangeQuery } from "@/data/bank/queries";
  import type { BankTransactionRow } from "@/data/bank/types";
  import {
    investmentsQuery,
    investmentTransactionsRangeQuery,
  } from "@/data/investments/queries";
  import {
    invoicePaymentAccountRulesQuery,
    invoicePaymentAccountsQuery,
    invoiceTransactionMappingsQuery,
    invoicesRangeQuery,
  } from "@/data/invoices/queries";
  import {
    deduplicateBankTransactions,
    matchInvoicesToTransactions,
  } from "@/data/activity/matching";
  import { activityAmountTwd } from "./model/chart";
  import {
    analyzeRecurringExpenses,
    type ExpenseCategoryTotal,
    type RecurringExpense,
    type RecurringExpenseAnalysis,
  } from "./model/recurring-expenses";
  import { recentMonthKeys, recentMonthRange } from "@/shared/date-range";
  import {
    formatCurrency,
    formatDate,
    rateMap,
  } from "@/shared/format/financial";

  let { api }: { api: ApiClient } = $props();

  type AnalysisMonths = 1 | 3 | 6 | 12;
  let analysisMonths = $state<AnalysisMonths>(6);
  let expandedExpenseKey = $state<string | null>(null);
  let expandedExtraCategory = $state<string | null>(null);
  const analysisRange = $derived(recentMonthRange(analysisMonths));
  const analysisMonthKeys = $derived(recentMonthKeys(analysisMonths));

  const bank = createQuery(
    toStore(() => bankRangeQuery(() => api, analysisRange)),
  );
  const invoices = createQuery(
    toStore(() => invoicesRangeQuery(() => api, analysisRange)),
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
    toStore(() => investmentTransactionsRangeQuery(() => api, analysisRange)),
  );
  const investments = createQuery(investmentsQuery(() => api));
  const rates = createQuery(exchangeRatesQuery(() => api));

  const bankAccounts = $derived(
    new Map(
      ($bank.data?.accounts ?? []).map((account) => [account.id, account]),
    ),
  );
  const activityBankTransactions = $derived(
    deduplicateBankTransactions(
      (($bank.data?.transactions ?? []) as BankTransactionRow[]).map(
        (transaction) => ({
          ...transaction,
          accountType:
            transaction.accountType ??
            bankAccounts.get(transaction.accountId)?.accountType,
        }),
      ),
    ),
  );
  const invoiceMatches = $derived(
    matchInvoicesToTransactions(
      activityBankTransactions,
      $invoices.data ?? [],
      $invoiceMappings.data ?? [],
      $invoicePaymentAccountRules.data ?? [],
      $invoicePaymentAccounts.data ?? [],
    ),
  );
  const activityItems = $derived(
    buildActivityItems(
      activityBankTransactions,
      $invoices.data ?? [],
      $trades.data ?? [],
      bankAccounts,
      invoiceMatches,
    ),
  );
  const rateValues = $derived(rateMap($rates.data));
  const holdingsSummary = $derived.by(() => {
    const positions = $investments.data ?? [];
    const knownPositions = positions.filter(
      (position) => position.costBasis != null && position.marketValue != null,
    );
    const toTwd = (amount: number, currency: string) =>
      currency === "TWD" ? amount : amount * (rateValues[currency] ?? 0);
    const marketValue = positions.reduce(
      (sum, position) =>
        sum + toTwd(position.marketValue ?? 0, position.currency),
      0,
    );
    const knownCost = knownPositions.reduce(
      (sum, position) =>
        sum + toTwd(position.costBasis ?? 0, position.currency),
      0,
    );
    const knownMarketValue = knownPositions.reduce(
      (sum, position) =>
        sum + toTwd(position.marketValue ?? 0, position.currency),
      0,
    );
    const asOfDate = positions
      .map((position) => position.asOfDate.slice(0, 10))
      .sort()
      .at(-1);
    return {
      count: positions.length,
      asOfDate,
      marketValue,
      knownCost,
      knownReturn: knownMarketValue - knownCost,
    };
  });
  const cashSummary = $derived.by(() => {
    const accounts = ($bank.data?.accounts ?? []).filter(
      (account) =>
        account.accountType !== "credit" &&
        /富邦|華南/u.test(account.institutionName ?? ""),
    );
    const toTwd = (amount: number, currency: string) =>
      currency === "TWD" ? amount : amount * (rateValues[currency] ?? 0);
    const asOfDate = accounts
      .map((account) => account.asOfAt?.slice(0, 10))
      .filter((date): date is string => date != null)
      .sort()
      .at(-1);
    return {
      count: accounts.length,
      asOfDate,
      amount: accounts.reduce(
        (sum, account) => sum + toTwd(account.balance ?? 0, account.currency),
        0,
      ),
    };
  });
  function expenseAmount(item: ActivityItem) {
    if (item.categoryParts) {
      return item.categoryParts
        .filter((part) => part.behavior === "normal")
        .reduce((sum, part) => sum + Math.max(0, part.amount), 0);
    }
    const amount = activityAmountTwd(item, rateValues);
    return amount == null ? undefined : Math.abs(amount);
  }

  function salaryAmount(item: ActivityItem) {
    const isSalaryCategory = (category: string) =>
      category === "薪資" || category.includes("薪資");
    if (item.categoryParts) {
      const salaryParts = item.categoryParts.filter(
        (part) =>
          part.behavior === "normal" &&
          (part.categoryId === "salary" || isSalaryCategory(part.category)),
      );
      if (salaryParts.length === 0) return undefined;
      return salaryParts.reduce(
        (sum, part) => sum + Math.max(0, part.amount),
        0,
      );
    }
    if (item.categoryId !== "salary" && !isSalaryCategory(item.category))
      return undefined;
    const amount = activityAmountTwd(item, rateValues);
    return amount == null ? undefined : Math.abs(amount);
  }
  const analysis = $derived<RecurringExpenseAnalysis>(
    analyzeRecurringExpenses(
      activityItems,
      analysisMonthKeys,
      expenseAmount,
      salaryAmount,
    ),
  );
  const fixedExpenseGroups = $derived([
    {
      key: "ordinary",
      title: "一般固定支出",
      expenses: analysis.recurringExpenses,
      empty: "尚未辨識一般固定支出。",
    },
    {
      key: "investment",
      title: "固定投資投入",
      expenses: [...analysis.fixedInvestmentExpenses].sort(
        (left, right) => right.averageAmount - left.averageAmount,
      ),
      empty: "尚未辨識固定投資投入。",
    },
  ]);
  const monthsDescending = $derived([...analysis.monthly].reverse());
  const latestMonth = $derived(analysis.monthly.at(-1));
  const maxExtraCategoryAmount = $derived(
    Math.max(1, ...analysis.extraCategories.map((item) => item.amount)),
  );
  const queryError = $derived(
    $bank.isError || $invoices.isError || $trades.isError,
  );

  function handleAnalysisMonthsChange(event: Event) {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    if (value === 1 || value === 3 || value === 6 || value === 12)
      analysisMonths = value;
  }

  function monthLabel(month: string) {
    return `${month.slice(0, 4)}/${Number(month.slice(5))}`;
  }

  function toggleExpense(key: string) {
    expandedExpenseKey = expandedExpenseKey === key ? null : key;
  }

  function expenseRowKey(expense: RecurringExpense) {
    return `${expense.scope}:${expense.key}`;
  }

  function toggleExtraCategory(category: string) {
    expandedExtraCategory =
      expandedExtraCategory === category ? null : category;
  }

  function visibleExpenseDetails(expense: RecurringExpense) {
    return [...expense.details]
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 20);
  }

  function visibleExtraDetails(category: ExpenseCategoryTotal) {
    return [...category.details]
      .sort(
        (left, right) =>
          right.amount - left.amount || right.date.localeCompare(left.date),
      )
      .slice(0, 20);
  }
</script>

{#if $bank.isPending || $invoices.isPending || $trades.isPending}
  <EmptyState title="載入支出分析中" body="正在整理帳務資料。" />
{:else if queryError}
  <EmptyState title="支出分析載入失敗" body="請重新整理後再試一次。" alert />
{:else}
  <div class="grid min-w-0 gap-4">
    <section class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold tracking-tight">支出分析</h2>
        <p class="mt-1 text-caption text-subtle">固定支出基準與額外支出</p>
      </div>
      <label class="flex items-center gap-2 text-caption text-subtle">
        <span>期間</span>
        <select
          class="h-9 rounded-lg border border-ink/15 bg-paper px-2.5 text-sm font-medium text-ink outline-none focus:border-steel focus:ring-2 focus:ring-steel/20"
          aria-label="支出分析期間"
          value={String(analysisMonths)}
          onchange={handleAnalysisMonthsChange}
        >
          <option value="1">本月</option>
          <option value="3">近 3 個月</option>
          <option value="6">近 6 個月</option>
          <option value="12">近 12 個月</option>
        </select>
      </label>
    </section>

    <section class="grid gap-2 sm:grid-cols-3" aria-label="支出摘要">
      <div class="rounded-xl border border-ink/10 bg-white px-3 py-3">
        <p class="text-xs text-subtle">每月一般固定支出</p>
        <p class="mt-1 text-lg font-semibold tabular-nums">
          {formatCurrency(analysis.baselineAmount)}
        </p>
      </div>
      <div class="rounded-xl border border-ink/10 bg-white px-3 py-3">
        <p class="text-xs text-subtle">每月定期定額</p>
        <p class="mt-1 text-lg font-semibold tabular-nums">
          {formatCurrency(analysis.investmentBaselineAmount)}
        </p>
      </div>
      <div class="rounded-xl border border-ink/10 bg-white px-3 py-3">
        <p class="text-xs text-subtle">本月額外支出</p>
        <p class="mt-1 text-lg font-semibold tabular-nums">
          {formatCurrency(latestMonth?.extraAmount ?? 0)}
        </p>
      </div>
    </section>

    <section
      class="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)]"
    >
      <div class="grid min-w-0 gap-4">
        {#each fixedExpenseGroups as group (group.key)}
          <div class="min-w-0 rounded-xl border border-ink/10 bg-white">
            <div
              class="flex items-center justify-between border-b border-ink/10 px-4 py-3"
            >
              <h3 class="font-semibold">{group.title}</h3>
              <span class="text-xs text-subtle">{analysisMonths} 個月</span>
            </div>
            {#if group.expenses.length === 0}
              <div class="px-4 py-8 text-sm text-subtle">{group.empty}</div>
            {:else}
              <div class="hidden overflow-x-auto md:block">
                <table class="w-full text-left text-sm">
                  <thead class="border-b border-ink/10 text-xs text-subtle">
                    <tr>
                      <th class="px-4 py-2.5 font-medium">項目</th>
                      <th class="px-4 py-2.5 font-medium">分類</th>
                      <th class="px-4 py-2.5 text-right font-medium"
                        >每月基準</th
                      >
                      <th class="px-4 py-2.5 text-right font-medium"
                        >最近金額</th
                      >
                      <th class="px-4 py-2.5 text-right font-medium">月份</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-ink/5">
                    {#each group.expenses as expense (expenseRowKey(expense))}
                      {@const rowKey = expenseRowKey(expense)}
                      <tr>
                        <td class="max-w-[18rem] px-4 py-3 font-medium">
                          <button
                            type="button"
                            class="flex min-w-0 items-center gap-2 text-left hover:text-steel"
                            aria-expanded={expandedExpenseKey === rowKey}
                            onclick={() => toggleExpense(rowKey)}
                          >
                            <ChevronDown
                              class={`size-4 shrink-0 transition-transform ${expandedExpenseKey === rowKey ? "rotate-180" : ""}`}
                            />
                            <span class="truncate">{expense.title}</span>
                          </button>
                        </td>
                        <td class="px-4 py-3 text-subtle">
                          {expense.scope === "category"
                            ? "類別基準"
                            : expense.scope === "investment"
                              ? "投資"
                              : expense.category}
                        </td>
                        <td class="px-4 py-3 text-right tabular-nums"
                          >{formatCurrency(expense.averageAmount)}</td
                        >
                        <td class="px-4 py-3 text-right tabular-nums"
                          >{formatCurrency(expense.latestAmount)}</td
                        >
                        <td
                          class="px-4 py-3 text-right tabular-nums text-subtle"
                          >{expense.occurrences}/{expense.monthCount}</td
                        >
                      </tr>
                      {#if expandedExpenseKey === rowKey}
                        <tr class="bg-ink/[0.025]">
                          <td colspan="5" class="px-4 py-3">
                            <div class="grid gap-2">
                              <div
                                class="flex items-center justify-between gap-3 text-xs text-subtle"
                              >
                                <span>支出明細</span>
                                <span
                                  >最近 {Math.min(expense.details.length, 20)} 筆／共
                                  {expense.details.length} 筆</span
                                >
                              </div>
                              <div
                                class="max-h-64 overflow-y-auto rounded-lg border border-ink/10 bg-paper"
                              >
                                {#each visibleExpenseDetails(expense) as detail}
                                  <div
                                    class="flex items-center justify-between gap-3 border-b border-ink/5 px-3 py-2.5 last:border-0"
                                  >
                                    <div class="min-w-0">
                                      <p class="truncate text-sm font-medium">
                                        {detail.title}
                                      </p>
                                      <p class="truncate text-xs text-subtle">
                                        {formatDate(detail.date)} · {detail.subtitle}
                                      </p>
                                    </div>
                                    <span class="shrink-0 text-sm tabular-nums"
                                      >{formatCurrency(detail.amount)}</span
                                    >
                                  </div>
                                {/each}
                              </div>
                            </div>
                          </td>
                        </tr>
                      {/if}
                    {/each}
                  </tbody>
                </table>
              </div>
              <div class="divide-y divide-ink/5 md:hidden">
                {#each group.expenses as expense (expenseRowKey(expense))}
                  {@const rowKey = expenseRowKey(expense)}
                  <div class="grid gap-2 px-4 py-3">
                    <button
                      type="button"
                      class="flex min-w-0 items-start justify-between gap-3 text-left"
                      aria-expanded={expandedExpenseKey === rowKey}
                      onclick={() => toggleExpense(rowKey)}
                    >
                      <span class="flex min-w-0 items-center gap-2">
                        <ChevronDown
                          class={`mt-0.5 size-4 shrink-0 transition-transform ${expandedExpenseKey === rowKey ? "rotate-180" : ""}`}
                        />
                        <span class="min-w-0 truncate font-medium"
                          >{expense.title}</span
                        >
                      </span>
                      <p class="shrink-0 font-semibold tabular-nums">
                        {formatCurrency(expense.averageAmount)}
                      </p>
                    </button>
                    <div class="flex justify-between text-xs text-subtle">
                      <span
                        >{expense.scope === "category"
                          ? "類別基準"
                          : expense.scope === "investment"
                            ? "投資"
                            : expense.category} · 最近 {formatCurrency(
                          expense.latestAmount,
                        )}</span
                      >
                      <span>{expense.occurrences}/{expense.monthCount} 月</span>
                    </div>
                    {#if expandedExpenseKey === rowKey}
                      <div
                        class="mt-1 max-h-64 overflow-y-auto rounded-lg border border-ink/10 bg-paper"
                      >
                        {#each visibleExpenseDetails(expense) as detail}
                          <div
                            class="flex items-center justify-between gap-3 border-b border-ink/5 px-3 py-2.5 last:border-0"
                          >
                            <div class="min-w-0">
                              <p class="truncate text-sm font-medium">
                                {detail.title}
                              </p>
                              <p class="truncate text-xs text-subtle">
                                {formatDate(detail.date)} · {detail.subtitle}
                              </p>
                            </div>
                            <span class="shrink-0 text-sm tabular-nums"
                              >{formatCurrency(detail.amount)}</span
                            >
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="min-w-0 rounded-xl border border-ink/10 bg-white">
        <div class="border-b border-ink/10 px-4 py-3">
          <h3 class="font-semibold">額外支出類別</h3>
        </div>
        {#if analysis.extraCategories.length === 0}
          <p class="px-4 py-8 text-sm text-subtle">目前沒有額外支出。</p>
        {:else}
          <div class="grid gap-4 px-4 py-4">
            {#each analysis.extraCategories.slice(0, 8) as category (category.category)}
              <div class="grid gap-1.5">
                <button
                  type="button"
                  class="flex items-center justify-between gap-3 text-left text-sm"
                  aria-expanded={expandedExtraCategory === category.category}
                  onclick={() => toggleExtraCategory(category.category)}
                >
                  <span class="flex min-w-0 items-center gap-2">
                    <ChevronDown
                      class={`size-4 shrink-0 transition-transform ${expandedExtraCategory === category.category ? "rotate-180" : ""}`}
                    />
                    <span class="truncate font-medium">{category.category}</span
                    >
                  </span>
                  <span class="shrink-0 tabular-nums"
                    >{formatCurrency(category.amount)}</span
                  >
                </button>
                <div class="h-1.5 overflow-hidden rounded-full bg-ink/8">
                  <div
                    class="h-full rounded-full bg-coral"
                    style={`width: ${(category.amount / maxExtraCategoryAmount) * 100}%`}
                  ></div>
                </div>
                <span class="text-xs text-subtle">{category.count} 筆</span>
                {#if expandedExtraCategory === category.category}
                  <div
                    class="mt-1 max-h-64 overflow-y-auto rounded-lg border border-ink/10 bg-paper"
                  >
                    {#each visibleExtraDetails(category) as detail}
                      <div
                        class="flex items-center justify-between gap-3 border-b border-ink/5 px-3 py-2.5 last:border-0"
                      >
                        <div class="min-w-0">
                          <p class="truncate text-sm font-medium">
                            {detail.title}
                          </p>
                          <p class="truncate text-xs text-subtle">
                            {formatDate(detail.date)} · {detail.subtitle}
                          </p>
                        </div>
                        <span class="shrink-0 text-sm tabular-nums"
                          >{formatCurrency(detail.amount)}</span
                        >
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <section class="min-w-0 rounded-xl border border-ink/10 bg-white">
      <div
        class="flex items-center justify-between gap-3 border-b border-ink/10 px-4 py-3"
      >
        <h3 class="font-semibold">每月支出</h3>
        <span class="text-xs text-subtle">一般支出與投資投入分開</span>
      </div>
      <div class="grid gap-4 p-4">
        <div class="min-w-0 rounded-lg border border-ink/10 bg-paper">
          <div
            class="flex items-center justify-between gap-3 border-b border-ink/10 px-3 py-2.5"
          >
            <h4 class="text-sm font-semibold">一般支出</h4>
            <span class="text-xs text-subtle">以基本薪資估算</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[35rem] text-left text-sm">
              <thead class="border-b border-ink/10 text-xs text-subtle">
                <tr>
                  <th class="px-3 py-2.5 font-medium">月份</th>
                  <th class="px-3 py-2.5 text-right font-medium">薪資基準</th>
                  <th class="px-3 py-2.5 text-right font-medium">固定支出</th>
                  <th class="px-3 py-2.5 text-right font-medium">額外支出</th>
                  <th class="px-3 py-2.5 text-right font-medium">一般支出</th>
                  <th class="px-3 py-2.5 text-right font-medium">餘額</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-ink/5">
                {#each monthsDescending as month (month.month)}
                  {@const generalSurplus =
                    month.salaryBaseAmount > 0
                      ? month.salaryBaseAmount - month.totalAmount
                      : null}
                  <tr>
                    <td class="px-3 py-2.5 font-medium">
                      {monthLabel(month.month)}
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums">
                      {month.salaryBaseAmount > 0
                        ? formatCurrency(month.salaryBaseAmount)
                        : "—"}
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums">
                      {formatCurrency(month.fixedAmount)}
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums text-coral">
                      {formatCurrency(month.extraAmount)}
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums">
                      {formatCurrency(month.totalAmount)}
                    </td>
                    <td
                      class={`px-3 py-2.5 text-right font-medium tabular-nums ${generalSurplus != null && generalSurplus < 0 ? "text-coral" : "text-moss"}`}
                    >
                      {#if generalSurplus == null}
                        —
                      {:else if generalSurplus < 0}
                        超支 {formatCurrency(Math.abs(generalSurplus))}
                      {:else}
                        餘額 {formatCurrency(generalSurplus)}
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>

        <div class="min-w-0 rounded-lg border border-ink/10 bg-paper">
          <div
            class="flex items-center justify-between gap-3 border-b border-ink/10 px-3 py-2.5"
          >
            <h4 class="text-sm font-semibold">投資投入</h4>
            <span class="text-xs text-subtle">以目前投資持倉為基準</span>
          </div>
          <div class="grid gap-2 border-b border-ink/10 p-3 sm:grid-cols-4">
            <div>
              <p class="text-xs text-subtle">目前現金流</p>
              <p class="mt-1 font-semibold tabular-nums">
                {cashSummary.count === 0
                  ? "—"
                  : formatCurrency(cashSummary.amount)}
              </p>
              {#if cashSummary.asOfDate}
                <p class="mt-0.5 text-[11px] text-subtle">
                  富邦＋華南存款 · {formatDate(cashSummary.asOfDate)}
                </p>
              {:else}
                <p class="mt-0.5 text-[11px] text-subtle">富邦＋華南存款</p>
              {/if}
            </div>
            <div>
              <p class="text-xs text-subtle">目前持倉市值</p>
              <p class="mt-1 font-semibold tabular-nums">
                {holdingsSummary.count === 0
                  ? "—"
                  : formatCurrency(holdingsSummary.marketValue)}
              </p>
              {#if holdingsSummary.asOfDate}
                <p class="mt-0.5 text-[11px] text-subtle">
                  {holdingsSummary.count} 筆 · {formatDate(
                    holdingsSummary.asOfDate,
                  )}
                </p>
              {/if}
            </div>
            <div>
              <p class="text-xs text-subtle">已知成本基準</p>
              <p class="mt-1 font-semibold tabular-nums">
                {holdingsSummary.knownCost > 0
                  ? formatCurrency(holdingsSummary.knownCost)
                  : "—"}
              </p>
              <p class="mt-0.5 text-[11px] text-subtle">僅含已提供成本的持倉</p>
            </div>
            <div>
              <p class="text-xs text-subtle">已知未實現損益</p>
              <p
                class={`mt-1 font-semibold tabular-nums ${holdingsSummary.knownReturn >= 0 ? "text-moss" : "text-coral"}`}
              >
                {holdingsSummary.knownCost > 0
                  ? formatCurrency(holdingsSummary.knownReturn)
                  : "—"}
              </p>
              <p class="mt-0.5 text-[11px] text-subtle">以目前持倉市值估算</p>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[42rem] text-left text-sm">
              <thead class="border-b border-ink/10 text-xs text-subtle">
                <tr>
                  <th class="px-3 py-2.5 font-medium">月份</th>
                  <th class="px-3 py-2.5 text-right font-medium">定期定額</th>
                  <th class="px-3 py-2.5 text-right font-medium"
                    >額外投資支出</th
                  >
                  <th class="px-3 py-2.5 text-right font-medium"
                    >贖回／投資收入</th
                  >
                  <th class="px-3 py-2.5 text-right font-medium"
                    >淨投資現金流</th
                  >
                </tr>
              </thead>
              <tbody class="divide-y divide-ink/5">
                {#each monthsDescending as month (month.month)}
                  <tr>
                    <td class="px-3 py-2.5 font-medium">
                      {monthLabel(month.month)}
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums">
                      {formatCurrency(month.recurringInvestmentAmount)}
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums text-coral">
                      {formatCurrency(month.extraInvestmentAmount)}
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums text-moss">
                      {formatCurrency(month.investmentIncomeAmount)}
                    </td>
                    <td
                      class={`px-3 py-2.5 text-right font-medium tabular-nums ${month.netInvestmentAmount > 0 ? "text-coral" : "text-moss"}`}
                    >
                      {formatCurrency(month.netInvestmentAmount)}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  </div>
{/if}
