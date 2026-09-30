<script lang="ts">
  import { toStore } from "svelte/store";
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import Input from "@/shared/ui/Input.svelte";
  import TabsList from "@/shared/ui/TabsList.svelte";
  import TabsTrigger from "@/shared/ui/TabsTrigger.svelte";
  import {
    exchangeRatesQuery,
    netWorthHistoryQuery,
  } from "@/data/assets/queries";
  import {
    investmentsQuery,
    investmentTransactionsRangeQuery,
  } from "@/data/investments/queries";
  import type { InvestmentRow } from "@/data/investments/types";
  import type { ApiClient } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import { recentMonthRange, type MonthRange } from "@/shared/date-range";
  import {
    formatCurrency,
    formatDate,
    rateMap,
  } from "@/shared/format/financial";
  import {
    calculateInvestmentReturns,
    classifyInvestmentTransactions,
    investmentTransactionLabel,
  } from "./model";
  import {
    buildMonthlyInvestmentPerformance,
    summarizeMonthlyInvestmentPerformance,
  } from "./monthly-performance";

  let { api }: { api: ApiClient } = $props();
  type InvestmentSection = "overview" | "holdings" | "transactions";
  type ReturnRange = "3months" | "6months" | "12months" | "all" | "custom";
  let investmentSection = $state<InvestmentSection>("overview");
  let returnRange = $state<ReturnRange>("12months");
  let returnFrom = $state("");
  let returnTo = $state("");
  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  const selectedTradeRange = $derived.by((): MonthRange => {
    if (returnRange === "3months") return recentMonthRange(3);
    if (returnRange === "6months") return recentMonthRange(6);
    if (returnRange === "12months") return recentMonthRange(12);
    if (returnRange === "custom" && returnFrom && returnTo) {
      return {
        from: returnFrom <= returnTo ? returnFrom : returnTo,
        to: returnFrom <= returnTo ? returnTo : returnFrom,
      };
    }
    if (returnRange === "custom") return recentMonthRange(12);
    return { from: "2000-01", to: currentMonthKey() };
  });
  const qc = useQueryClient();
  const positions = createQuery(investmentsQuery(() => api));
  const rates = createQuery(exchangeRatesQuery(() => api));
  const history = createQuery(netWorthHistoryQuery(() => api));
  const trades = createQuery(
    toStore(() =>
      investmentTransactionsRangeQuery(() => api, selectedTradeRange),
    ),
  );
  const rateValues = $derived(rateMap($rates.data));
  const toTwd = (value: number, currency: string) =>
    currency === "TWD" ? value : value * (rateValues[currency] ?? 0);
  const knownPositions = $derived(
    ($positions.data ?? []).filter(
      (position) => position.costBasis != null && position.marketValue != null,
    ),
  );
  const unknownCostPositions = $derived(
    ($positions.data ?? []).filter(
      (position) => position.costBasis == null || position.marketValue == null,
    ),
  );
  const classifiedTrades = $derived(
    classifyInvestmentTransactions($trades.data ?? []),
  );
  const investmentTrades = $derived(
    classifiedTrades.filter(({ kind }) => kind !== "other"),
  );
  let selectedTradeKind = $state<
    "all" | "buy" | "sell" | "redemption" | "income"
  >("all");
  let tradeLimit = $state(12);
  let editingAmountId = $state<string | null>(null);
  let amountDraft = $state("");
  let amountError = $state("");
  const saveAmount = createMutation({
    mutationFn: ({
      transactionId,
      amount,
    }: {
      transactionId: string;
      amount: number;
    }) =>
      api.put(
        `/api/investment-transactions/${encodeURIComponent(transactionId)}/amount`,
        { amount },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.investmentTransactions });
      editingAmountId = null;
      amountDraft = "";
      amountError = "";
    },
    onError: (error) => {
      amountError =
        error instanceof Error ? error.message : "成交金額儲存失敗。";
    },
  });
  const clearAmount = createMutation({
    mutationFn: (transactionId: string) =>
      api.delete(
        `/api/investment-transactions/${encodeURIComponent(transactionId)}/amount`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.investmentTransactions });
      editingAmountId = null;
      amountDraft = "";
      amountError = "";
    },
    onError: (error) => {
      amountError =
        error instanceof Error ? error.message : "原始成交金額還原失敗。";
    },
  });
  const filteredInvestmentTrades = $derived(
    investmentTrades.filter(
      ({ kind }) => selectedTradeKind === "all" || kind === selectedTradeKind,
    ),
  );
  const holdingTotals = $derived(
    knownPositions.reduce(
      (totals, position) => {
        totals.cost += toTwd(position.costBasis ?? 0, position.currency);
        totals.value += toTwd(position.marketValue ?? 0, position.currency);
        return totals;
      },
      { cost: 0, value: 0 },
    ),
  );
  const holdingTotalReturnRate = $derived(
    holdingTotals.cost > 0
      ? ((holdingTotals.value - holdingTotals.cost) / holdingTotals.cost) * 100
      : 0,
  );
  const visibleInvestmentTrades = $derived(
    filteredInvestmentTrades.slice(0, tradeLimit),
  );
  const missingEventTradeCount = $derived(
    investmentTrades.filter(({ transaction }) => transaction.amount == null)
      .length,
  );
  const incomeTrades = $derived(
    classifiedTrades.filter(({ kind }) => kind === "income"),
  );
  const summary = $derived(
    calculateInvestmentReturns(
      $positions.data ?? [],
      $trades.data ?? [],
      toTwd,
    ),
  );
  type TrendMetric = "rate" | "value";
  let trendMetric = $state<TrendMetric>("rate");
  const monthlyPerformance = $derived(
    buildMonthlyInvestmentPerformance(
      $history.data ?? [],
      $trades.data ?? [],
      toTwd,
    ),
  );
  const visibleMonthlyPerformance = $derived.by(() => {
    if (returnRange === "3months") return monthlyPerformance.slice(-3);
    if (returnRange === "6months") return monthlyPerformance.slice(-6);
    if (returnRange === "12months") return monthlyPerformance.slice(-12);
    if (returnRange === "custom" && returnFrom && returnTo) {
      const from = returnFrom <= returnTo ? returnFrom : returnTo;
      const to = returnFrom <= returnTo ? returnTo : returnFrom;
      return monthlyPerformance.filter(
        (point) => point.month >= from && point.month <= to,
      );
    }
    return monthlyPerformance;
  });
  const periodPerformance = $derived(
    summarizeMonthlyInvestmentPerformance(visibleMonthlyPerformance),
  );
  const chartPoints = $derived.by(() => {
    const values = visibleMonthlyPerformance
      .map((point) =>
        trendMetric === "rate" ? point.adjustedChangeRate : point.marketValue,
      )
      .filter((value): value is number => value != null);
    if (values.length === 0) return [];
    const min =
      trendMetric === "rate" ? Math.min(0, ...values) : Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return visibleMonthlyPerformance.map((point, index) => ({
      ...point,
      chartValue:
        trendMetric === "rate" ? point.adjustedChangeRate : point.marketValue,
      x:
        visibleMonthlyPerformance.length < 2
          ? 300
          : 24 + (index / (visibleMonthlyPerformance.length - 1)) * 552,
      y:
        (trendMetric === "rate"
          ? point.adjustedChangeRate
          : point.marketValue) == null
          ? null
          : 12 +
            ((max -
              (trendMetric === "rate"
                ? (point.adjustedChangeRate ?? 0)
                : point.marketValue)) /
              span) *
              126,
      zeroY: trendMetric === "rate" ? 12 + (max / span) * 126 : null,
    }));
  });
  const ratePolyline = $derived(
    chartPoints
      .filter((point) => point.y != null)
      .map((point) => `${point.x},${point.y}`)
      .join(" "),
  );
  const latestMonthlyPoint = $derived(
    visibleMonthlyPerformance[visibleMonthlyPerformance.length - 1],
  );

  function returnRangeLabel() {
    if (returnRange === "3months") return "近 3 個月";
    if (returnRange === "6months") return "近 6 個月";
    if (returnRange === "12months") return "近 12 個月";
    if (returnRange === "custom" && returnFrom && returnTo) {
      return `${returnFrom}～${returnTo}`;
    }
    return "全部期間";
  }

  const formatQuantity = (value: number) =>
    new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 4 }).format(value);

  function positionReturn(position: InvestmentRow) {
    return (position.marketValue ?? 0) - (position.costBasis ?? 0);
  }

  function positionReturnRate(position: InvestmentRow) {
    return position.costBasis
      ? (positionReturn(position) / position.costBasis) * 100
      : 0;
  }

  function formatPositionPrice(
    value: number | null | undefined,
    currency: string,
  ) {
    return value == null ? "—" : formatCurrency(value, currency);
  }

  function transactionAmountLabel(
    amount: number | undefined,
    currency: string,
  ) {
    return amount == null
      ? "待補成交額"
      : formatCurrency(Math.abs(amount), currency);
  }

  function transactionKindClass(kind: string) {
    if (kind === "buy") return "bg-coral/10 text-coral";
    if (kind === "sell" || kind === "redemption") {
      return "bg-moss/10 text-moss";
    }
    if (kind === "income") return "bg-blue-100 text-blue-800";
    return "bg-ink/[0.06] text-subtle";
  }

  function brokerLabel(position: InvestmentRow) {
    const account = position.sourceId?.split(":");
    if (!account || account.length < 3) return "";
    const broker =
      account[0] === "9627"
        ? "富邦"
        : account[0] === "9316"
          ? "華南"
          : account[0];
    return `${broker} ${account[1]}`;
  }

  function selectTradeKind(kind: typeof selectedTradeKind) {
    selectedTradeKind = kind;
    tradeLimit = 12;
  }

  function startAmountEdit(transactionId: string, amount?: number) {
    editingAmountId = transactionId;
    amountDraft = amount == null ? "" : String(Math.abs(amount));
    amountError = "";
  }

  function cancelAmountEdit() {
    editingAmountId = null;
    amountDraft = "";
    amountError = "";
  }

  function submitAmount(transactionId: string) {
    const amount = Number(amountDraft.replaceAll(",", "").trim());
    if (!Number.isInteger(amount) || amount <= 0) {
      amountError = "請輸入大於 0 的整數成交總額。";
      return;
    }
    $saveAmount.mutate({ transactionId, amount });
  }

  function selectReturnRange(next: ReturnRange) {
    returnRange = next;
    if (next === "3months" || next === "6months" || next === "12months") {
      returnFrom = "";
      returnTo = "";
    }
  }

  function handleReturnRangeChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (
      value === "3months" ||
      value === "6months" ||
      value === "12months" ||
      value === "all" ||
      value === "custom"
    ) {
      selectReturnRange(value);
    }
  }
</script>

{#if $positions.isPending || $rates.isPending || $trades.isPending || $history.isPending}
  <EmptyState title="載入投資收益中" body="正在計算持倉損益與投資交易紀錄。" />
{:else if $positions.isError || $rates.isError || $trades.isError || $history.isError}
  <EmptyState
    alert
    title="無法載入投資收益"
    body="投資、匯率或交易資料目前無法取得，請稍後再試。"
  />
{:else}
  <div class="grid min-w-0 gap-4 pt-1">
    <section aria-label="投資收益摘要">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-base font-semibold">投資收益</h2>
        <label class="flex items-center gap-2 text-caption text-subtle">
          <span>期間</span>
          <select
            class="h-9 rounded-lg border border-ink/15 bg-paper px-2.5 text-sm font-medium text-ink outline-none focus:border-steel focus:ring-2 focus:ring-steel/20"
            aria-label="投資分析期間"
            value={returnRange}
            onchange={handleReturnRangeChange}
          >
            <option value="3months">近 3 個月</option>
            <option value="6months">近 6 個月</option>
            <option value="12months">近 12 個月</option>
            <option value="all">全部期間</option>
            <option value="custom">自訂期間</option>
          </select>
        </label>
      </div>
      {#if returnRange === "custom"}
        <div class="mt-2 flex flex-wrap items-end justify-end gap-2">
          <label class="grid gap-1 text-caption text-subtle">
            開始月份
            <Input type="month" bind:value={returnFrom} class="h-9" />
          </label>
          <label class="grid gap-1 text-caption text-subtle">
            結束月份
            <Input type="month" bind:value={returnTo} class="h-9" />
          </label>
          {#if !returnFrom || !returnTo}
            <span class="pb-2 text-caption text-subtle">請選擇起訖月份</span>
          {/if}
        </div>
      {/if}
      <div class="mt-4 overflow-x-auto rounded-xl border border-ink/8">
        <table class="w-full min-w-[56rem] text-left text-sm">
          <thead
            class="border-b border-ink/8 bg-ink/[0.025] text-caption text-subtle"
          >
            <tr>
              <th class="px-3 py-2.5">{returnRangeLabel()}</th>
              <th class="px-3 py-2.5 text-right">期間報酬率</th>
              <th class="px-3 py-2.5 text-right">年化報酬率</th>
              <th class="px-3 py-2.5 text-right">持倉累積</th>
              <th class="px-3 py-2.5 text-right">目前市值</th>
              <th class="px-3 py-2.5 text-right">未實現損益</th>
              <th class="px-3 py-2.5 text-right">交易筆數</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="px-3 py-3 font-semibold">投資總覽</td>
              <td
                class={`px-3 py-3 text-right font-semibold tabular-nums ${periodPerformance.returnRate == null || periodPerformance.returnRate >= 0 ? "text-moss" : "text-coral"}`}
              >
                {periodPerformance.returnRate == null
                  ? "—"
                  : `${periodPerformance.returnRate >= 0 ? "+" : ""}${periodPerformance.returnRate.toFixed(2)}%`}
              </td>
              <td
                class={`px-3 py-3 text-right font-semibold tabular-nums ${periodPerformance.annualizedReturnRate == null || periodPerformance.annualizedReturnRate >= 0 ? "text-moss" : "text-coral"}`}
              >
                {periodPerformance.annualizedReturnRate == null
                  ? "—"
                  : `${periodPerformance.annualizedReturnRate >= 0 ? "+" : ""}${periodPerformance.annualizedReturnRate.toFixed(2)}%`}
              </td>
              <td
                class={`px-3 py-3 text-right font-semibold tabular-nums ${summary.overallReturnRate == null || summary.overallReturn >= 0 ? "text-moss" : "text-coral"}`}
              >
                {summary.overallReturnRate == null
                  ? "—"
                  : `${summary.overallReturnRate >= 0 ? "+" : ""}${summary.overallReturnRate.toFixed(2)}%`}
              </td>
              <td class="px-3 py-3 text-right font-semibold tabular-nums">
                {formatCurrency(summary.currentValue)}
              </td>
              <td
                class={`px-3 py-3 text-right font-semibold tabular-nums ${summary.unrealizedReturn >= 0 ? "text-moss" : "text-coral"}`}
              >
                {summary.unrealizedReturn >= 0 ? "+" : "−"}{formatCurrency(
                  Math.abs(summary.unrealizedReturn),
                )}
              </td>
              <td class="px-3 py-3 text-right tabular-nums">
                {summary.transactionCount}
              </td>
            </tr>
          </tbody>
          <tfoot class="border-t border-ink/8 text-caption text-subtle">
            <tr>
              <td class="px-3 py-2">現金流</td>
              <td colspan="2" class="px-3 py-2 text-right">
                投入 {summary.investedAmount > 0
                  ? formatCurrency(summary.investedAmount)
                  : "—"}
              </td>
              <td colspan="2" class="px-3 py-2 text-right">
                收回 {summary.returnedAmount > 0
                  ? `+${formatCurrency(summary.returnedAmount)}`
                  : "—"}
              </td>
              <td colspan="2" class="px-3 py-2 text-right">
                收益 {summary.incomeAmount > 0
                  ? `+${formatCurrency(summary.incomeAmount)}`
                  : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <TabsList
      aria-label="投資收益內容"
      class="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-ink/10 bg-transparent p-0"
    >
      <TabsTrigger
        class={`rounded-none border-b-2 px-3 py-2.5 ${investmentSection === "overview" ? "border-steel bg-transparent text-ink shadow-none" : "border-transparent bg-transparent text-subtle shadow-none hover:bg-transparent"}`}
        active={investmentSection === "overview"}
        onclick={() => (investmentSection = "overview")}>投資概況</TabsTrigger
      >
      <TabsTrigger
        class={`rounded-none border-b-2 px-3 py-2.5 ${investmentSection === "holdings" ? "border-steel bg-transparent text-ink shadow-none" : "border-transparent bg-transparent text-subtle shadow-none hover:bg-transparent"}`}
        active={investmentSection === "holdings"}
        onclick={() => (investmentSection = "holdings")}>持倉損益</TabsTrigger
      >
      <TabsTrigger
        class={`rounded-none border-b-2 px-3 py-2.5 ${investmentSection === "transactions" ? "border-steel bg-transparent text-ink shadow-none" : "border-transparent bg-transparent text-subtle shadow-none hover:bg-transparent"}`}
        active={investmentSection === "transactions"}
        onclick={() => (investmentSection = "transactions")}
        >交易紀錄</TabsTrigger
      >
    </TabsList>

    {#if investmentSection === "overview"}<section
        class="grid min-w-0 gap-3 pt-4"
        aria-label="每月投資資產變動"
      >
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 class="text-base font-semibold">投資報酬趨勢</h2>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded-lg border border-ink/10 px-3 py-2">
            <p class="text-caption text-subtle">本期投資損益</p>
            <p
              class={`mt-0.5 font-semibold tabular-nums ${latestMonthlyPoint?.adjustedChangeAmount == null || latestMonthlyPoint.adjustedChangeAmount >= 0 ? "text-moss" : "text-coral"}`}
            >
              {latestMonthlyPoint?.adjustedChangeAmount == null
                ? "—"
                : `${latestMonthlyPoint.adjustedChangeAmount >= 0 ? "+" : "−"}${formatCurrency(Math.abs(latestMonthlyPoint.adjustedChangeAmount))}`}
            </p>
          </div>
          <div class="rounded-lg border border-ink/10 px-3 py-2">
            <p class="text-caption text-subtle">本期報酬率</p>
            <p
              class={`mt-0.5 font-semibold tabular-nums ${latestMonthlyPoint?.adjustedChangeRate == null || latestMonthlyPoint.adjustedChangeRate >= 0 ? "text-moss" : "text-coral"}`}
            >
              {latestMonthlyPoint?.adjustedChangeRate == null
                ? "—"
                : `${latestMonthlyPoint.adjustedChangeRate >= 0 ? "+" : ""}${latestMonthlyPoint.adjustedChangeRate.toFixed(2)}%`}
            </p>
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <div class="flex gap-1" role="group" aria-label="趨勢圖指標">
            <button
              type="button"
              class={`min-h-9 rounded-lg px-3 text-caption font-semibold ${trendMetric === "rate" ? "bg-steel text-white" : "bg-ink/[0.05] text-ink"}`}
              aria-pressed={trendMetric === "rate"}
              onclick={() => (trendMetric = "rate")}>月報酬率</button
            >
            <button
              type="button"
              class={`min-h-9 rounded-lg px-3 text-caption font-semibold ${trendMetric === "value" ? "bg-steel text-white" : "bg-ink/[0.05] text-ink"}`}
              aria-pressed={trendMetric === "value"}
              onclick={() => (trendMetric = "value")}>投資市值</button
            >
          </div>
        </div>
        {#if visibleMonthlyPerformance.length < 2}
          <p class="py-8 text-center text-sm text-subtle">
            這個期間的歷史持倉快照不足，至少需要兩個月份才能計算月變動。
          </p>
        {:else}
          <div class="rounded-xl bg-ink/[0.025] p-3 sm:p-4">
            <svg
              viewBox="0 0 600 160"
              class="h-44 w-full overflow-visible"
              role="img"
              aria-label={trendMetric === "rate"
                ? "過去每月現金流調整報酬率折線圖"
                : "過去每月投資市值折線圖"}
            >
              {#if chartPoints[0]?.zeroY != null}
                <line
                  x1="24"
                  x2="576"
                  y1={chartPoints[0].zeroY}
                  y2={chartPoints[0].zeroY}
                  stroke="currentColor"
                  stroke-opacity="0.18"
                  stroke-dasharray="4 4"
                />
              {/if}
              {#if ratePolyline}
                <polyline
                  points={ratePolyline}
                  fill="none"
                  stroke="#6574cd"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              {/if}
              {#each chartPoints as point (point.month)}
                {#if point.y != null}
                  <circle cx={point.x} cy={point.y} r="4" fill="#6574cd">
                    <title
                      >{point.month}：{trendMetric === "rate"
                        ? point.adjustedChangeRate == null
                          ? "—"
                          : point.adjustedChangeRate.toFixed(2) + "%"
                        : formatCurrency(point.marketValue)}</title
                    >
                  </circle>
                {/if}
              {/each}
            </svg>
            <div
              class="hidden overflow-x-auto rounded-lg border border-ink/8 md:block"
            >
              <table class="w-full min-w-[42rem] text-left text-sm">
                <thead
                  class="border-b border-ink/8 bg-ink/[0.025] text-caption text-subtle"
                >
                  <tr>
                    <th class="px-3 py-2.5">月份</th>
                    <th class="px-3 py-2.5 text-right">報酬率</th>
                    <th class="px-3 py-2.5 text-right">投資損益</th>
                    <th class="px-3 py-2.5 text-right">期末市值</th>
                    <th class="px-3 py-2.5 text-right">資料註記</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-ink/8">
                  {#each visibleMonthlyPerformance
                    .slice()
                    .reverse() as point (point.month)}
                    <tr class="transition-colors hover:bg-ink/[0.025]">
                      <td class="px-3 py-2.5">
                        <p class="font-semibold tabular-nums">{point.month}</p>
                        <p class="mt-0.5 text-caption text-subtle">
                          {formatDate(point.date)}
                        </p>
                      </td>
                      <td
                        class={`px-3 py-2.5 text-right font-semibold tabular-nums ${point.adjustedChangeRate == null || point.adjustedChangeRate >= 0 ? "text-moss" : "text-coral"}`}
                      >
                        {point.adjustedChangeRate == null
                          ? "—"
                          : `${point.adjustedChangeRate >= 0 ? "+" : ""}${point.adjustedChangeRate.toFixed(2)}%`}
                      </td>
                      <td
                        class={`px-3 py-2.5 text-right font-semibold tabular-nums ${point.adjustedChangeAmount == null || point.adjustedChangeAmount >= 0 ? "text-moss" : "text-coral"}`}
                      >
                        {point.adjustedChangeAmount == null
                          ? "—"
                          : `${point.adjustedChangeAmount >= 0 ? "+" : "−"}${formatCurrency(Math.abs(point.adjustedChangeAmount))}`}
                      </td>
                      <td class="px-3 py-2.5 text-right tabular-nums">
                        {formatCurrency(point.marketValue)}
                      </td>
                      <td
                        class="px-3 py-2.5 text-right text-caption text-subtle"
                      >
                        {point.baselineAddedValue > 0
                          ? `資料新增 ${formatCurrency(point.baselineAddedValue)}`
                          : "—"}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <div
              class="divide-y divide-ink/8 rounded-lg border border-ink/8 md:hidden"
            >
              {#each visibleMonthlyPerformance
                .slice()
                .reverse() as point (point.month)}
                <div
                  class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-3 py-3"
                >
                  <div>
                    <p class="font-semibold tabular-nums">{point.month}</p>
                    <p class="mt-0.5 text-caption text-subtle">
                      {formatDate(point.date)}
                    </p>
                  </div>
                  <div class="text-right">
                    <p
                      class={`font-semibold tabular-nums ${point.adjustedChangeRate == null || point.adjustedChangeRate >= 0 ? "text-moss" : "text-coral"}`}
                    >
                      {point.adjustedChangeRate == null
                        ? "—"
                        : `${point.adjustedChangeRate >= 0 ? "+" : ""}${point.adjustedChangeRate.toFixed(2)}%`}
                    </p>
                    <p
                      class={`mt-0.5 text-caption font-medium tabular-nums ${point.adjustedChangeAmount == null || point.adjustedChangeAmount >= 0 ? "text-moss" : "text-coral"}`}
                    >
                      {point.adjustedChangeAmount == null
                        ? "—"
                        : `${point.adjustedChangeAmount >= 0 ? "+" : "−"}${formatCurrency(Math.abs(point.adjustedChangeAmount))}`}
                    </p>
                  </div>
                  <div
                    class="col-span-2 grid grid-cols-2 gap-2 text-caption text-subtle"
                  >
                    <span>期末市值 {formatCurrency(point.marketValue)}</span>
                    {#if point.baselineAddedValue > 0}
                      <span class="text-right"
                        >資料新增 {formatCurrency(
                          point.baselineAddedValue,
                        )}</span
                      >
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/if}

    {#if investmentSection === "holdings"}<section
        class="grid min-w-0 gap-3 pt-4"
        aria-label="持倉損益"
      >
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 class="text-base font-semibold">目前持倉損益</h2>
            <p class="mt-1 text-caption text-subtle">
              {knownPositions.length} 筆持倉 · 以台幣彙總 · 損益
              <span
                class={holdingTotals.value - holdingTotals.cost >= 0
                  ? "text-moss"
                  : "text-coral"}
              >
                {holdingTotals.value - holdingTotals.cost >= 0
                  ? "+"
                  : "−"}{formatCurrency(
                  Math.abs(holdingTotals.value - holdingTotals.cost),
                )}
              </span>
            </p>
          </div>
        </div>
        {#if knownPositions.length === 0}
          <p class="py-8 text-center text-sm text-subtle">
            目前沒有可計算損益的持倉。
          </p>
        {:else}
          <div
            class="hidden overflow-hidden rounded-xl border border-ink/8 lg:block"
          >
            <table class="w-full table-fixed text-left text-sm">
              <colgroup>
                <col style="width: 27%" />
                <col style="width: 12%" />
                <col style="width: 12%" />
                <col style="width: 13%" />
                <col style="width: 13%" />
                <col style="width: 13%" />
                <col style="width: 10%" />
              </colgroup>
              <thead
                class="border-b border-ink/8 bg-ink/[0.025] text-caption text-subtle"
              >
                <tr class="border-b border-ink/8">
                  <th rowspan="2" class="px-2.5 py-2.5 align-middle xl:px-4">
                    標的／帳戶
                  </th>
                  <th
                    colspan="2"
                    class="border-l border-ink/8 px-2.5 py-2 text-right xl:px-4"
                  >
                    持倉
                  </th>
                  <th
                    colspan="2"
                    class="border-l border-ink/8 px-2.5 py-2 text-right xl:px-4"
                  >
                    資產價值
                  </th>
                  <th
                    colspan="2"
                    class="border-l border-ink/8 px-2.5 py-2 text-right xl:px-4"
                  >
                    績效
                  </th>
                </tr>
                <tr>
                  <th
                    class="border-l border-ink/8 px-2.5 py-2 text-right xl:px-4"
                  >
                    數量
                  </th>
                  <th class="px-2.5 py-2 text-right xl:px-4">均價</th>
                  <th
                    class="border-l border-ink/8 px-2.5 py-2 text-right xl:px-4"
                  >
                    成本
                  </th>
                  <th class="px-2.5 py-2 text-right xl:px-4">市值</th>
                  <th
                    class="border-l border-ink/8 px-2.5 py-2 text-right xl:px-4"
                  >
                    損益
                  </th>
                  <th class="px-2.5 py-2 text-right xl:px-4">報酬率</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-ink/8">
                {#each knownPositions as position (position.id)}
                  {@const gain = positionReturn(position)}
                  {@const gainRate = positionReturnRate(position)}
                  <tr class="transition-colors hover:bg-ink/[0.025]">
                    <td class="px-2.5 py-3 align-top xl:px-4">
                      <p class="font-semibold">
                        {position.symbol || position.name}
                      </p>
                      {#if position.symbol}
                        <p class="mt-0.5 text-caption text-subtle">
                          {position.name}
                        </p>
                      {/if}
                      <p class="mt-1 text-caption text-subtle">
                        {brokerLabel(position) ||
                          (position.isManual ? "手動持倉" : "同步持倉")} ·
                        {position.currency}
                      </p>
                    </td>
                    <td
                      class="border-l border-ink/8 px-2.5 py-3 text-right tabular-nums xl:px-4"
                    >
                      {formatQuantity(position.quantity ?? 0)} 股
                    </td>
                    <td class="px-2.5 py-3 text-right tabular-nums xl:px-4">
                      {formatPositionPrice(
                        position.costPerShare,
                        position.currency,
                      )}
                    </td>
                    <td
                      class="border-l border-ink/8 px-2.5 py-3 text-right tabular-nums xl:px-4"
                    >
                      {formatCurrency(
                        position.costBasis ?? 0,
                        position.currency,
                      )}
                    </td>
                    <td class="px-2.5 py-3 text-right tabular-nums xl:px-4">
                      {formatCurrency(
                        position.marketValue ?? 0,
                        position.currency,
                      )}
                    </td>
                    <td
                      class={`border-l border-ink/8 px-2.5 py-3 text-right font-semibold tabular-nums xl:px-4 ${gain >= 0 ? "text-moss" : "text-coral"}`}
                    >
                      {gain >= 0 ? "+" : "−"}{formatCurrency(
                        Math.abs(gain),
                        position.currency,
                      )}
                    </td>
                    <td
                      class={`px-2.5 py-3 text-right font-semibold tabular-nums xl:px-4 ${gainRate >= 0 ? "text-moss" : "text-coral"}`}
                    >
                      {gainRate >= 0 ? "+" : ""}{gainRate.toFixed(2)}%
                    </td>
                  </tr>
                {/each}
              </tbody>
              <tfoot
                class="border-t border-ink/8 bg-ink/[0.025] text-sm font-semibold"
              >
                <tr>
                  <td class="px-2.5 py-3 xl:px-4">合計</td>
                  <td
                    class="border-l border-ink/8 px-2.5 py-3 text-right xl:px-4"
                    >—</td
                  >
                  <td class="px-2.5 py-3 text-right xl:px-4">—</td>
                  <td
                    class="border-l border-ink/8 px-2.5 py-3 text-right tabular-nums xl:px-4"
                  >
                    {formatCurrency(holdingTotals.cost)}
                  </td>
                  <td class="px-2.5 py-3 text-right tabular-nums xl:px-4">
                    {formatCurrency(holdingTotals.value)}
                  </td>
                  <td
                    class={`border-l border-ink/8 px-2.5 py-3 text-right tabular-nums xl:px-4 ${holdingTotals.value - holdingTotals.cost >= 0 ? "text-moss" : "text-coral"}`}
                  >
                    {holdingTotals.value - holdingTotals.cost >= 0
                      ? "+"
                      : "−"}{formatCurrency(
                      Math.abs(holdingTotals.value - holdingTotals.cost),
                    )}
                  </td>
                  <td
                    class={`px-2.5 py-3 text-right tabular-nums xl:px-4 ${holdingTotalReturnRate >= 0 ? "text-moss" : "text-coral"}`}
                  >
                    {holdingTotalReturnRate >= 0
                      ? "+"
                      : ""}{holdingTotalReturnRate.toFixed(2)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div
            class="rounded-xl border border-ink/8 px-3 divide-y divide-ink/8 lg:hidden"
          >
            {#each knownPositions as position (position.id)}
              {@const gain = positionReturn(position)}
              <div
                class="grid gap-2 border-b border-ink/8 py-3 last:border-b-0"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate font-semibold">
                      {position.symbol || position.name}
                    </p>
                    {#if position.symbol}
                      <p class="mt-0.5 truncate text-caption text-subtle">
                        {position.name}
                      </p>
                    {/if}
                    <p class="mt-1 text-caption text-subtle">
                      {brokerLabel(position) ||
                        (position.isManual ? "手動持倉" : "同步持倉")}
                      · {position.currency}
                    </p>
                  </div>
                  <p
                    class={`shrink-0 font-semibold tabular-nums ${gain >= 0 ? "text-moss" : "text-coral"}`}
                  >
                    {gain >= 0 ? "+" : "−"}{formatCurrency(
                      Math.abs(gain),
                      position.currency,
                    )}
                  </p>
                </div>
                <div class="grid grid-cols-2 gap-2 text-caption">
                  <span class="rounded-md bg-ink/[0.035] px-2 py-1"
                    >持有 {formatQuantity(position.quantity ?? 0)} 股</span
                  >
                  <span class="rounded-md bg-ink/[0.035] px-2 py-1 text-right"
                    >報酬率 {positionReturnRate(position) >= 0
                      ? "+"
                      : ""}{positionReturnRate(position).toFixed(2)}%</span
                  >
                  <span class="rounded-md bg-ink/[0.035] px-2 py-1"
                    >均價 {formatPositionPrice(
                      position.costPerShare,
                      position.currency,
                    )}</span
                  >
                  <span class="rounded-md bg-ink/[0.035] px-2 py-1 text-right"
                    >現價 {formatPositionPrice(
                      position.marketPrice,
                      position.currency,
                    )}</span
                  >
                  <span class="rounded-md bg-ink/[0.035] px-2 py-1"
                    >成本 {formatCurrency(
                      position.costBasis ?? 0,
                      position.currency,
                    )}</span
                  >
                  <span class="rounded-md bg-ink/[0.035] px-2 py-1 text-right"
                    >市值 {formatCurrency(
                      position.marketValue ?? 0,
                      position.currency,
                    )}</span
                  >
                </div>
              </div>
            {/each}
          </div>
        {/if}
        {#if unknownCostPositions.length > 0}
          <p
            class="rounded-xl bg-amber-50 px-4 py-3 text-caption text-amber-900"
          >
            {unknownCostPositions.length} 筆持倉缺少成本資料，未計入損益。
          </p>
        {/if}
      </section>
    {/if}

    {#if investmentSection === "transactions"}<section
        class="grid min-w-0 gap-3 pt-4"
        aria-label="投資交易"
      >
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 class="text-base font-semibold">全部投資交易</h2>
            <p class="mt-1 text-caption text-subtle">
              {filteredInvestmentTrades.length} 筆符合目前篩選
            </p>
          </div>
          {#if missingEventTradeCount > 0}
            <span class="text-caption font-medium text-amber-700">
              {missingEventTradeCount} 筆待補
            </span>
          {/if}
        </div>
        <div
          class="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="投資交易類型"
        >
          {#each [{ kind: "all", label: `全部 ${investmentTrades.length}` }, { kind: "buy", label: `買進 ${summary.buyCount}` }, { kind: "sell", label: `賣出 ${summary.sellCount}` }, { kind: "redemption", label: `贖回 ${summary.redemptionCount}` }, { kind: "income", label: `配息 ${summary.incomeCount}` }] as filter (filter.kind)}
            <button
              type="button"
              class={`min-h-10 rounded-lg px-3 text-sm font-medium ${selectedTradeKind === filter.kind ? "bg-steel text-white" : "bg-ink/[0.05] text-ink"}`}
              aria-pressed={selectedTradeKind === filter.kind}
              onclick={() =>
                selectTradeKind(filter.kind as typeof selectedTradeKind)}
              >{filter.label}</button
            >
          {/each}
        </div>
        {#if filteredInvestmentTrades.length === 0}
          <p class="py-8 text-center text-sm text-subtle">
            尚未找到符合條件的投資交易。
          </p>
        {:else}
          <div
            class="divide-y divide-ink/8 rounded-xl border border-ink/8 px-3 md:hidden"
          >
            {#each visibleInvestmentTrades as classified (classified.transaction.id)}
              {@const trade = classified.transaction}
              <div class="grid gap-2 py-3 text-sm">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex min-w-0 items-start gap-2">
                    <span
                      class={`mt-0.5 shrink-0 rounded-md px-2 py-1 text-caption font-semibold ${transactionKindClass(classified.kind)}`}
                      >{investmentTransactionLabel(classified.kind)}</span
                    >
                    <div class="min-w-0">
                      <p class="truncate font-semibold">
                        {trade.symbol ? `${trade.symbol} ` : ""}{trade.name ??
                          "未命名標的"}
                      </p>
                      <p class="mt-0.5 text-caption text-subtle">
                        {formatDate(classified.date)} · {trade.quantity == null
                          ? "—"
                          : formatQuantity(Math.abs(trade.quantity))} 股
                      </p>
                    </div>
                  </div>
                  <div class="shrink-0 text-right">
                    <p
                      class={trade.amount == null
                        ? "font-medium tabular-nums text-amber-700"
                        : "font-semibold tabular-nums"}
                    >
                      {transactionAmountLabel(trade.amount, trade.currency)}
                    </p>
                  </div>
                </div>
                {#if trade.amount == null || trade.amountSource === "manual" || trade.amountSource === "historical-close"}
                  <button
                    type="button"
                    class="min-h-8 justify-self-start rounded-md border border-ink/15 px-2 text-caption font-medium text-steel"
                    onclick={() => startAmountEdit(trade.id, trade.amount)}
                    >{trade.amount == null
                      ? "補金額"
                      : trade.amountSource === "historical-close"
                        ? "改實際額"
                        : "編輯"}</button
                  >
                {/if}
                {#if editingAmountId === trade.id}
                  <div
                    class="mt-2 basis-full grid gap-2 rounded-lg bg-ink/[0.035] p-2"
                  >
                    <label class="grid gap-1 text-caption text-subtle">
                      成交總額（{trade.currency}）
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        inputmode="numeric"
                        bind:value={amountDraft}
                        class="h-10"
                        placeholder="例如 100000"
                      />
                    </label>
                    {#if amountError}
                      <p class="text-caption text-coral">{amountError}</p>
                    {/if}
                    <div class="flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="min-h-9 rounded-lg bg-steel px-3 text-caption font-semibold text-white disabled:opacity-50"
                        disabled={$saveAmount.isPending}
                        onclick={() => submitAmount(trade.id)}
                        >儲存成交額</button
                      >
                      <button
                        type="button"
                        class="min-h-9 rounded-lg border border-ink/15 px-3 text-caption font-semibold"
                        onclick={cancelAmountEdit}>取消</button
                      >
                      {#if trade.amountSource === "manual" || trade.amountSource === "historical-close"}
                        <button
                          type="button"
                          class="min-h-9 rounded-lg px-3 text-caption font-semibold text-coral disabled:opacity-50"
                          disabled={$clearAmount.isPending}
                          onclick={() => $clearAmount.mutate(trade.id)}
                          >還原原始值</button
                        >
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
          <div
            class="hidden overflow-x-auto rounded-xl border border-ink/8 md:block"
          >
            <table class="w-full min-w-[42rem] text-left text-sm">
              <thead
                class="sticky top-0 border-b border-ink/8 bg-ink/[0.025] text-caption text-subtle"
                ><tr
                  ><th class="px-4 py-3">日期／類型</th><th class="px-4 py-3"
                    >標的</th
                  ><th class="px-4 py-3 text-right">數量</th><th
                    class="px-4 py-3 text-right">成交額</th
                  ><th class="px-4 py-3 text-right">操作</th></tr
                ></thead
              ><tbody class="divide-y divide-ink/8">
                {#each visibleInvestmentTrades as classified (classified.transaction.id)}
                  {@const trade = classified.transaction}
                  <tr class="transition-colors hover:bg-ink/[0.025]"
                    ><td class="px-4 py-3"
                      ><p class="tabular-nums">{formatDate(classified.date)}</p>
                      <span
                        class={`mt-1 inline-flex rounded-md px-2 py-1 text-caption font-semibold ${transactionKindClass(classified.kind)}`}
                        >{investmentTransactionLabel(classified.kind)}</span
                      ></td
                    ><td class="max-w-[16rem] truncate px-4 py-3 font-medium"
                      >{trade.symbol ? `${trade.symbol} ` : ""}{trade.name ??
                        "未命名標的"}</td
                    ><td class="px-4 py-3 text-right tabular-nums"
                      >{trade.quantity == null
                        ? "—"
                        : formatQuantity(Math.abs(trade.quantity))}</td
                    ><td class="px-4 py-3 text-right tabular-nums"
                      ><div class="flex items-center justify-end gap-2">
                        <span
                          class={trade.amount == null
                            ? "font-medium text-amber-700"
                            : "text-subtle"}
                          >{transactionAmountLabel(
                            trade.amount,
                            trade.currency,
                          )}</span
                        >
                      </div></td
                    ><td class="px-4 py-3 text-right text-caption"
                      ><div class="flex flex-col items-end gap-1">
                        {#if trade.amount == null || trade.amountSource === "manual" || trade.amountSource === "historical-close"}
                          <button
                            type="button"
                            class="min-h-8 rounded-md border border-ink/15 px-2 text-caption font-medium text-steel"
                            onclick={() =>
                              startAmountEdit(trade.id, trade.amount)}
                            >{trade.amount == null
                              ? "補金額"
                              : trade.amountSource === "historical-close"
                                ? "改實際額"
                                : "編輯"}</button
                          >
                        {/if}
                      </div></td
                    ></tr
                  >
                  {#if editingAmountId === trade.id}
                    <tr>
                      <td colspan="5" class="bg-ink/[0.025] px-4 py-3">
                        <div class="flex flex-wrap items-end gap-2">
                          <label
                            class="grid min-w-48 gap-1 text-caption text-subtle"
                          >
                            成交總額（{trade.currency}）
                            <Input
                              type="number"
                              min="1"
                              step="1"
                              inputmode="numeric"
                              bind:value={amountDraft}
                              class="h-10"
                              placeholder="例如 100000"
                            />
                          </label>
                          <button
                            type="button"
                            class="min-h-10 rounded-lg bg-steel px-3 text-caption font-semibold text-white disabled:opacity-50"
                            disabled={$saveAmount.isPending}
                            onclick={() => submitAmount(trade.id)}
                            >儲存成交額</button
                          >
                          <button
                            type="button"
                            class="min-h-10 rounded-lg border border-ink/15 px-3 text-caption font-semibold"
                            onclick={cancelAmountEdit}>取消</button
                          >
                          {#if trade.amountSource === "manual" || trade.amountSource === "historical-close"}
                            <button
                              type="button"
                              class="min-h-10 rounded-lg px-3 text-caption font-semibold text-coral disabled:opacity-50"
                              disabled={$clearAmount.isPending}
                              onclick={() => $clearAmount.mutate(trade.id)}
                              >還原原始值</button
                            >
                          {/if}
                          {#if amountError}
                            <p class="basis-full text-caption text-coral">
                              {amountError}
                            </p>
                          {/if}
                        </div>
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
          {#if visibleInvestmentTrades.length < filteredInvestmentTrades.length}
            <button
              type="button"
              class="min-h-11 justify-self-start rounded-lg border border-ink/15 px-4 text-sm font-semibold text-steel"
              onclick={() => (tradeLimit += 12)}
              >顯示更多交易（尚有 {filteredInvestmentTrades.length -
                visibleInvestmentTrades.length} 筆）</button
            >
          {/if}
        {/if}
      </section>

      {#if incomeTrades.length > 0}
        <section
          class="grid min-w-0 gap-3 border-t border-ink/10 pt-5"
          aria-label="投資收益歷史"
        >
          <div>
            <h2 class="text-base font-semibold">配息／投資收益</h2>
          </div>
          <div class="divide-y divide-ink/8">
            {#each incomeTrades as classified (classified.transaction.id)}
              {@const trade = classified.transaction}
              <div class="flex items-center justify-between gap-3 py-3">
                <div class="min-w-0">
                  <p class="truncate font-semibold">
                    {trade.name ?? trade.symbol ?? "投資收益"}
                  </p>
                  <p class="mt-1 text-caption text-subtle">
                    {trade.transactionName ?? trade.transactionCode ?? "收益"} · {formatDate(
                      classified.date,
                    )}
                  </p>
                </div>
                <p class="shrink-0 font-semibold tabular-nums text-moss">
                  {trade.amount == null
                    ? "金額未提供"
                    : `+${formatCurrency(Math.abs(trade.amount), trade.currency)}`}
                </p>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/if}
  </div>
{/if}
