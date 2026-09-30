<script lang="ts">
  import { toStore } from "svelte/store";
  import { createQuery } from "@tanstack/svelte-query";
  import { Search, X } from "@lucide/svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import Input from "@/shared/ui/Input.svelte";
  import Select from "@/shared/ui/Select.svelte";
  import type { ApiClient } from "@/shared/api/client";
  import { invoicesRangeQuery } from "@/data/invoices/queries";
  import {
    recentMonthKeys,
    recentMonthRange,
    type MonthRange,
  } from "@/shared/date-range";
  import {
    formatCurrency,
    formatDate,
    formatNumber,
  } from "@/shared/format/financial";
  import {
    aggregatePurchaseAdjustments,
    aggregatePurchaseCategories,
    aggregatePurchaseCharges,
    aggregatePurchaseItems,
    flattenPurchaseLines,
    type PurchaseItemSummary,
    type PurchaseLineView,
  } from "./model";

  type PurchasePeriod = "current" | "previous" | "threeMonths" | "year";
  type PurchaseSort = "amount" | "recent" | "frequency" | "name";

  let { api }: { api: ApiClient } = $props();

  const monthKeys = recentMonthKeys(12);
  const currentMonth = monthKeys.at(-1) ?? "";
  const previousMonth = monthKeys.at(-2) ?? currentMonth;
  const previousRange: MonthRange = {
    from: previousMonth,
    to: previousMonth,
  };

  let period = $state<PurchasePeriod>("current");
  let search = $state("");
  let categoryFilter = $state("all");
  let merchantFilter = $state("all");
  let sortMode = $state<PurchaseSort>("amount");
  let expandedCategories = $state<Set<string>>(new Set());
  let selectedItem = $state<PurchaseItemSummary | null>(null);

  const invoiceRange = $derived.by((): MonthRange => {
    if (period === "previous") return previousRange;
    if (period === "threeMonths") return recentMonthRange(3);
    if (period === "year") return recentMonthRange(12);
    return { from: currentMonth, to: currentMonth };
  });

  const invoices = createQuery(
    toStore(() => invoicesRangeQuery(() => api, invoiceRange)),
  );
  const previousInvoices = createQuery(
    toStore(() => invoicesRangeQuery(() => api, previousRange)),
  );

  const allLines = $derived(flattenPurchaseLines($invoices.data ?? []));
  const productLines = $derived(
    allLines.filter(
      (row) =>
        row.kind === "item" &&
        (row.displayAmount > 0 || row.settlement === "redeemed"),
    ),
  );
  const merchantOptions = $derived.by(() => {
    const merchants = new Set(
      productLines
        .map((row) => row.line.merchantName ?? row.invoice.sellerName)
        .filter((value): value is string => Boolean(value)),
    );
    return [...merchants].sort((a, b) => a.localeCompare(b, "zh-TW"));
  });
  const categoryOptions = $derived.by(() => {
    const categories = new Map<string, string>();
    for (const row of productLines) {
      categories.set(
        row.line.classification?.categoryId ?? "other",
        row.line.classification?.label ?? "未分類",
      );
    }
    return [...categories.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], "zh-TW"),
    );
  });

  const filteredProductLines = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase("zh-TW");
    return productLines.filter(({ invoice, line }) => {
      const categoryId = line.classification?.categoryId ?? "other";
      const merchant = line.merchantName ?? invoice.sellerName ?? "";
      if (categoryFilter !== "all" && categoryId !== categoryFilter)
        return false;
      if (merchantFilter !== "all" && merchant !== merchantFilter) return false;
      if (!query) return true;
      return `${line.description} ${invoice.invoiceNumber ?? ""} ${merchant} ${line.classification?.label ?? ""}`
        .toLocaleLowerCase("zh-TW")
        .includes(query);
    });
  });

  const hasActiveFilter = $derived(
    Boolean(search.trim()) ||
      categoryFilter !== "all" ||
      merchantFilter !== "all",
  );
  const visibleInvoiceIds = $derived(
    hasActiveFilter
      ? new Set(filteredProductLines.map(({ invoice }) => invoice.id))
      : new Set(($invoices.data ?? []).map((invoice) => invoice.id)),
  );
  const visibleInvoices = $derived(
    ($invoices.data ?? []).filter((invoice) =>
      visibleInvoiceIds.has(invoice.id),
    ),
  );
  const visibleLines = $derived(
    allLines.filter(({ invoice }) => visibleInvoiceIds.has(invoice.id)),
  );
  const itemSummaries = $derived(aggregatePurchaseItems(filteredProductLines));
  const categories = $derived.by(() =>
    aggregatePurchaseCategories(filteredProductLines).map((category) => ({
      ...category,
      items: [...category.items].sort(sortItems),
    })),
  );
  const maxCategoryAmount = $derived(
    Math.max(1, ...categories.map((category) => category.amount)),
  );
  const categoryTotal = $derived(
    categories.reduce((sum, category) => sum + category.amount, 0),
  );
  const adjustmentSummaries = $derived(
    aggregatePurchaseAdjustments(visibleLines),
  );
  const chargeSummaries = $derived(aggregatePurchaseCharges(visibleLines));
  const previousProductLines = $derived(
    flattenPurchaseLines($previousInvoices.data ?? []).filter(
      (row) =>
        row.kind === "item" &&
        (row.displayAmount > 0 || row.settlement === "redeemed"),
    ),
  );
  const previousCategories = $derived(
    aggregatePurchaseCategories(previousProductLines),
  );
  const previousCategoryAmounts = $derived(
    new Map(
      previousCategories.map((category) => [category.id, category.amount]),
    ),
  );
  const itemTotal = $derived(
    itemSummaries.reduce((sum, item) => sum + item.amount, 0),
  );
  const allowanceTotal = $derived(
    adjustmentSummaries
      .filter((item) => item.kind === "allowance")
      .reduce((sum, item) => sum + item.amount, 0),
  );
  const refundTotal = $derived(
    adjustmentSummaries
      .filter((item) => item.kind === "refund")
      .reduce((sum, item) => sum + item.amount, 0),
  );
  const chargeTotal = $derived(
    chargeSummaries.reduce((sum, item) => sum + item.amount, 0),
  );
  const invoiceTotal = $derived(
    visibleInvoices.reduce((sum, invoice) => sum + invoice.amount, 0),
  );
  function sortItems(a: PurchaseItemSummary, b: PurchaseItemSummary) {
    if (sortMode === "recent") {
      return (
        new Date(b.lastPurchasedAt).getTime() -
          new Date(a.lastPurchasedAt).getTime() || b.amount - a.amount
      );
    }
    if (sortMode === "frequency") {
      return b.lineCount - a.lineCount || b.amount - a.amount;
    }
    if (sortMode === "name")
      return a.description.localeCompare(b.description, "zh-TW");
    return (
      b.amount - a.amount || a.description.localeCompare(b.description, "zh-TW")
    );
  }

  function merchantName(row: PurchaseLineView) {
    return row.line.merchantName ?? row.invoice.sellerName ?? "未提供商家";
  }

  function itemMerchantLabel(item: PurchaseItemSummary) {
    if (item.merchants.length === 0) return "未提供商家";
    if (item.merchants.length <= 2) return item.merchants.join("、");
    return `${item.merchants.slice(0, 2).join("、")} 等 ${item.merchants.length} 家`;
  }

  function toggleCategory(id: string) {
    const next = new Set(expandedCategories);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedCategories = next;
  }

  function resetFilters() {
    search = "";
    categoryFilter = "all";
    merchantFilter = "all";
  }

  function rangeLabel() {
    if (period === "current")
      return `${currentMonth.slice(0, 4)} 年 ${Number(currentMonth.slice(5))} 月`;
    if (period === "previous")
      return `${previousMonth.slice(0, 4)} 年 ${Number(previousMonth.slice(5))} 月`;
    return `${invoiceRange.from} 至 ${invoiceRange.to}`;
  }

  function deltaLabel(value: number) {
    return `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value))}`;
  }

  function categoryDelta(id: string, amount: number) {
    return amount - (previousCategoryAmounts.get(id) ?? 0);
  }

  function itemLines(item: PurchaseItemSummary) {
    return [...item.lines].sort(
      (a, b) =>
        new Date(b.invoice.invoiceDate).getTime() -
        new Date(a.invoice.invoiceDate).getTime(),
    );
  }

  function lineQuantity(line: PurchaseLineView) {
    return line.line.quantity != null && Number.isFinite(line.line.quantity)
      ? Math.abs(line.line.quantity)
      : 1;
  }
</script>

{#if $invoices.isPending}
  <EmptyState title="載入購買品項中" body="正在整理電子發票明細。" />
{:else if $invoices.isError}
  <EmptyState
    alert
    title="無法載入購買品項"
    body="發票資料目前無法取得，請稍後再試。"
  />
{:else}
  <div class="grid min-w-0 gap-4 pt-2">
    <section class="grid gap-3" aria-label="購買品項範圍">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold tracking-tight">購買品項</h1>
          <p class="mt-0.5 text-caption text-subtle">{rangeLabel()}</p>
        </div>
        <label class="grid min-w-32 gap-1 text-caption text-subtle">
          期間
          <Select aria-label="購買品項期間" class="h-9" bind:value={period}>
            <option value="current">本月</option>
            <option value="previous">上月</option>
            <option value="threeMonths">近 3 個月</option>
            <option value="year">近 12 個月</option>
          </Select>
        </label>
      </div>

      <div
        class="grid gap-2 sm:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]"
      >
        <div class="relative min-w-0">
          <Search
            class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-subtle"
          />
          <Input
            aria-label="搜尋品項、商家或發票號碼"
            class="h-10 pl-9"
            placeholder="搜尋品項、商家或發票號碼"
            bind:value={search}
          />
        </div>
        <Select aria-label="品項分類" class="h-10" bind:value={categoryFilter}>
          <option value="all">全部分類</option>
          {#each categoryOptions as [id, label]}
            <option value={id}>{label}</option>
          {/each}
        </Select>
        <Select aria-label="品項商家" class="h-10" bind:value={merchantFilter}>
          <option value="all">全部商家</option>
          {#each merchantOptions as merchant}
            <option value={merchant}>{merchant}</option>
          {/each}
        </Select>
        <Select aria-label="品項排序" class="h-10" bind:value={sortMode}>
          <option value="amount">依金額</option>
          <option value="recent">依最近購買</option>
          <option value="frequency">依購買次數</option>
          <option value="name">依品項名稱</option>
        </Select>
      </div>

      {#if hasActiveFilter}
        <div class="flex flex-wrap items-center gap-2 text-caption text-subtle">
          <span>目前篩選 {visibleInvoices.length} 張發票</span>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full border border-ink/10 px-2.5 py-1 text-ink transition hover:bg-ink/5"
            onclick={resetFilters}
          >
            <X class="size-3.5" /> 清除篩選
          </button>
        </div>
      {/if}
    </section>

    <section
      class="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-ink/10 py-3 sm:grid-cols-5"
      aria-label="購買摘要"
    >
      <div>
        <p class="text-caption text-subtle">
          {hasActiveFilter ? "相關發票合計" : "實際支付"}
        </p>
        <p class="mt-0.5 text-lg font-semibold tabular-nums text-coral">
          {formatCurrency(invoiceTotal)}
        </p>
      </div>
      <div>
        <p class="text-caption text-subtle">商品實付小計</p>
        <p class="mt-0.5 text-lg font-semibold tabular-nums">
          {formatCurrency(itemTotal)}
        </p>
      </div>
      <div>
        <p class="text-caption text-subtle">
          {hasActiveFilter ? "相關發票折讓" : "折扣／折讓"}
        </p>
        <p class="mt-0.5 text-lg font-semibold tabular-nums text-moss">
          −{formatCurrency(allowanceTotal)}
        </p>
      </div>
      <div>
        <p class="text-caption text-subtle">發票</p>
        <p class="mt-0.5 text-lg font-semibold tabular-nums">
          {visibleInvoices.length} 張
        </p>
      </div>
      <div>
        <p class="text-caption text-subtle">品項種類</p>
        <p class="mt-0.5 text-lg font-semibold tabular-nums">
          {itemSummaries.length} 種
        </p>
      </div>
    </section>

    {#if refundTotal > 0 || chargeTotal > 0}
      <div class="grid gap-2 sm:grid-cols-2">
        {#if refundTotal > 0}
          <div
            class="rounded-lg border border-moss/20 bg-moss/[0.035] px-3 py-2"
          >
            <p class="text-caption text-subtle">退款／退貨</p>
            <p class="mt-0.5 font-semibold tabular-nums text-moss">
              {formatCurrency(refundTotal)} · {adjustmentSummaries.filter(
                (item) => item.kind === "refund",
              ).length} 種
            </p>
          </div>
        {/if}
        {#if chargeTotal > 0}
          <div class="rounded-lg border border-ink/10 bg-ink/[0.02] px-3 py-2">
            <p class="text-caption text-subtle">其他費用</p>
            <p class="mt-0.5 font-semibold tabular-nums">
              {formatCurrency(chargeTotal)}
            </p>
          </div>
        {/if}
      </div>
    {/if}

    {#if categories.length === 0}
      <p class="py-8 text-center text-sm text-subtle">
        這段期間沒有符合條件的品項。
      </p>
    {:else}
      <section class="min-w-0" aria-labelledby="purchase-categories-heading">
        <div class="mb-2 flex items-baseline justify-between gap-3">
          <h2 id="purchase-categories-heading" class="text-base font-semibold">
            支出分布
          </h2>
        </div>
        <div class="grid gap-2">
          {#each categories as category (category.id)}
            <section
              class="overflow-hidden rounded-xl border border-ink/10 bg-white"
            >
              <button
                type="button"
                class="flex min-h-16 w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-ink/[0.025] sm:px-4"
                aria-expanded={expandedCategories.has(category.id)}
                onclick={() => toggleCategory(category.id)}
              >
                <span class="min-w-0">
                  <span class="block truncate font-semibold"
                    >{category.label}</span
                  >
                  <span class="mt-0.5 block text-caption text-subtle"
                    >{category.itemCount} 種品項 · {category.lineCount} 筆 · {category.invoiceCount}
                    張發票</span
                  >
                  <span
                    class="mt-2 block h-1.5 overflow-hidden rounded-full bg-ink/8"
                    aria-hidden="true"
                  >
                    <span
                      class="block h-full rounded-full bg-ink/55"
                      style:width={Math.max(
                        2,
                        (category.amount / maxCategoryAmount) * 100,
                      ) + "%"}
                    ></span>
                  </span>
                </span>
                <span class="shrink-0 text-right">
                  <span class="block font-semibold tabular-nums"
                    >{formatCurrency(category.amount)}</span
                  >
                  <span
                    class="mt-0.5 block text-caption tabular-nums text-subtle"
                    >{categoryTotal > 0
                      ? Math.round((category.amount / categoryTotal) * 100)
                      : 0}%</span
                  >
                  {#if period === "current" && !hasActiveFilter && !$previousInvoices.isPending}
                    {@const delta = categoryDelta(category.id, category.amount)}
                    <span
                      class={`mt-0.5 block text-caption tabular-nums ${delta > 0 ? "text-coral" : delta < 0 ? "text-moss" : "text-subtle"}`}
                    >
                      較上月 {deltaLabel(delta)}
                    </span>
                  {/if}
                </span>
              </button>

              {#if expandedCategories.has(category.id)}
                <div class="border-t border-ink/8 bg-ink/[0.015]">
                  <div
                    class="hidden grid-cols-[minmax(0,1fr)_minmax(8rem,0.8fr)_6rem_7rem_6.5rem] gap-3 px-4 py-2 text-caption text-subtle sm:grid"
                  >
                    <span>品項</span>
                    <span>商家</span>
                    <span>購買</span>
                    <span class="text-right">平均單價</span>
                    <span class="text-right">小計</span>
                  </div>
                  <div class="divide-y divide-ink/8">
                    {#each category.items as item (item.key)}
                      <button
                        type="button"
                        class="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5 text-left transition hover:bg-white sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.8fr)_6rem_7rem_6.5rem] sm:items-center sm:px-4"
                        onclick={() => (selectedItem = item)}
                      >
                        <span class="min-w-0">
                          <span
                            class="block truncate font-medium"
                            title={item.description}>{item.description}</span
                          >
                          <span
                            class="mt-0.5 block truncate text-caption text-subtle sm:hidden"
                            >{itemMerchantLabel(item)}</span
                          >
                        </span>
                        <span
                          class="hidden min-w-0 truncate text-caption text-subtle sm:block"
                          title={itemMerchantLabel(item)}
                          >{itemMerchantLabel(item)}</span
                        >
                        <span
                          class="text-right text-caption text-subtle sm:text-left"
                        >
                          <span class="block tabular-nums"
                            >{item.lineCount} 次</span
                          >
                          <span class="block text-ink/45 tabular-nums"
                            >{formatNumber(item.quantity)} 件</span
                          >
                        </span>
                        <span
                          class="hidden text-right text-caption text-subtle tabular-nums sm:block"
                        >
                          {item.averageUnitPrice != null
                            ? formatCurrency(item.averageUnitPrice)
                            : "—"}
                        </span>
                        <span class="text-right font-semibold tabular-nums">
                          <span class="block">
                            {formatCurrency(item.amount)}
                          </span>
                          {#if item.redeemedCount > 0}
                            <span
                              class="block text-caption font-normal text-moss"
                            >
                              {item.amount === 0
                                ? "兌換 " + formatCurrency(item.originalAmount)
                                : "含 " + item.redeemedCount + " 次兌換"}
                            </span>
                          {/if}
                        </span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            </section>
          {/each}
        </div>
      </section>
    {/if}

    {#if adjustmentSummaries.length > 0}
      <details class="min-w-0 border-t border-ink/10 pt-3">
        <summary
          class="flex cursor-pointer list-none items-baseline justify-between gap-3 [&::-webkit-details-marker]:hidden"
        >
          <span class="font-semibold">折扣與折讓</span>
          <span class="text-caption tabular-nums text-moss"
            >−{formatCurrency(allowanceTotal)} · {adjustmentSummaries.length} 種</span
          >
        </summary>
        <div class="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {#each adjustmentSummaries as adjustment (`${adjustment.kind}:${adjustment.description}`)}
            <div
              class="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-moss/15 bg-moss/[0.035] px-3 py-2"
            >
              <div class="min-w-0">
                <p
                  class="truncate text-sm font-medium"
                  title={adjustment.description}
                >
                  {adjustment.description}
                </p>
                <p class="mt-0.5 text-caption text-subtle">
                  {adjustment.count} 筆 · 最近 {formatDate(
                    adjustment.lastAppliedAt,
                  )}
                </p>
              </div>
              <p class="shrink-0 font-semibold tabular-nums text-moss">
                −{formatCurrency(adjustment.amount)}
              </p>
            </div>
          {/each}
        </div>
      </details>
    {/if}
  </div>
{/if}

{#if selectedItem}
  <div class="fixed inset-0 z-[70] bg-ink/45 md:flex md:justify-end">
    <button
      type="button"
      class="absolute inset-0 cursor-default"
      aria-label="關閉品項明細"
      onclick={() => (selectedItem = null)}
    ></button>
    <div
      class="relative z-10 flex h-full w-full max-w-xl flex-col bg-background shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-item-detail-heading"
    >
      <div
        class="flex items-start justify-between gap-4 border-b border-ink/10 px-4 py-4 sm:px-6"
      >
        <div class="min-w-0">
          <h2
            id="purchase-item-detail-heading"
            class="break-words text-lg font-semibold"
          >
            {selectedItem.description}
          </h2>
          <p class="mt-1 text-caption text-subtle">
            {selectedItem.lineCount} 次 · {formatNumber(selectedItem.quantity)} 件
            · 實付 {formatCurrency(selectedItem.amount)}
            {#if selectedItem.redeemedCount > 0}
              · 原價 {formatCurrency(selectedItem.originalAmount)}
            {/if}
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-md p-2 text-subtle transition hover:bg-ink/5 hover:text-ink"
          aria-label="關閉品項明細"
          onclick={() => (selectedItem = null)}
        >
          <X class="size-5" />
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div class="grid grid-cols-2 gap-3 border-b border-ink/10 pb-4 text-sm">
          <div>
            <p class="text-caption text-subtle">平均單價</p>
            <p class="mt-0.5 font-semibold tabular-nums">
              {selectedItem.averageUnitPrice != null
                ? formatCurrency(selectedItem.averageUnitPrice)
                : "—"}
            </p>
          </div>
          <div>
            <p class="text-caption text-subtle">最近購買</p>
            <p class="mt-0.5 font-semibold">
              {formatDate(selectedItem.lastPurchasedAt)}
            </p>
          </div>
        </div>
        <div class="mt-4 flex items-center justify-between gap-3">
          <h3 class="font-semibold">購買紀錄</h3>
          <span class="text-caption text-subtle"
            >{selectedItem.invoiceCount} 張發票</span
          >
        </div>
        <div
          class="mt-2 divide-y divide-ink/8 rounded-xl border border-ink/10 bg-white"
        >
          {#each itemLines(selectedItem) as row (`${row.invoice.id}:${row.line.id}`)}
            <div class="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">{merchantName(row)}</p>
                <p class="mt-0.5 text-caption text-subtle">
                  {formatDate(row.invoice.invoiceDate)} · {row.invoice
                    .invoiceNumber ?? "無發票號碼"}
                </p>
                <p class="mt-1 text-caption text-subtle">
                  {row.line.classification?.label ?? "未分類"} · {lineQuantity(
                    row,
                  )} 件{#if row.line.unitPrice != null}
                    · 單價 {formatCurrency(Math.abs(row.line.unitPrice))}{/if}
                  {#if row.settlement === "redeemed"}
                    · <span class="text-moss">兌換，實付 NT$0</span>
                  {/if}
                </p>
              </div>
              <p class="self-center text-right font-semibold tabular-nums">
                {formatCurrency(row.displayAmount)}
              </p>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}
