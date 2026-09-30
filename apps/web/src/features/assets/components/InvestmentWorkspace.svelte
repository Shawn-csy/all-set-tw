<script lang="ts">
  import { createMutation, useQueryClient } from "@tanstack/svelte-query";
  import { Pencil, Plus, RefreshCw, Trash2 } from "@lucide/svelte";
  import type {
    InvestmentRow,
    InvestmentTransactionRow,
  } from "@/data/investments/types";
  import type { ApiClient } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import Button from "@/shared/ui/Button.svelte";
  import Input from "@/shared/ui/Input.svelte";
  import Textarea from "@/shared/ui/Textarea.svelte";
  import {
    formatCurrency,
    formatDate,
    formatNumber,
  } from "@/shared/format/financial";

  let {
    api,
    positions,
    trades,
    total,
    tradesPending = false,
    tradesError = false,
    compact = false,
  }: {
    api: ApiClient;
    positions: InvestmentRow[];
    trades: InvestmentTransactionRow[];
    total: number;
    tradesPending?: boolean;
    tradesError?: boolean;
    compact?: boolean;
  } = $props();

  type QuoteResult = {
    status: string;
    updated: number;
    failed: number;
  };

  const qc = useQueryClient();
  let tab = $state<"holdings" | "transactions">("holdings");
  let adding = $state(false);
  let editing = $state<InvestmentRow | null>(null);
  let editingCost = $state<InvestmentRow | null>(null);
  let costInput = $state("");
  let costError = $state("");
  let formError = $state("");
  let quoteMessage = $state("");
  let form = $state({
    name: "",
    symbol: "",
    quantity: "",
    costPerShare: "",
    note: "",
  });

  const manualPositions = $derived(
    positions.filter((position) => position.isManual),
  );

  const add = createMutation({
    mutationFn: () =>
      api.post<{ id: string; quote: QuoteResult }>("/api/investments/manual", {
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        quantity: Number(form.quantity),
        costPerShare: Number(form.costPerShare),
        note: form.note.trim() || undefined,
      }),
    onSuccess: (result) => {
      invalidateInvestments();
      closeEditor();
      quoteMessage = quoteResultMessage(result.quote);
    },
  });

  const update = createMutation({
    mutationFn: () =>
      api.put<{ success: true; quote: QuoteResult }>(
        `/api/investments/manual/${editing!.id}`,
        {
          name: form.name.trim(),
          symbol: form.symbol.trim().toUpperCase(),
          quantity: Number(form.quantity),
          costPerShare: Number(form.costPerShare),
          note: form.note.trim() || null,
        },
      ),
    onSuccess: (result) => {
      invalidateInvestments();
      closeEditor();
      quoteMessage = quoteResultMessage(result.quote);
    },
  });

  const updateSyncedCost = createMutation({
    mutationFn: ({ id, costPerShare }: { id: string; costPerShare: number }) =>
      api.put(`/api/investments/${encodeURIComponent(id)}/cost`, {
        costPerShare,
      }),
    onSuccess: () => {
      invalidateInvestments();
      editingCost = null;
      costInput = "";
      costError = "";
    },
    onError: (error) => {
      costError = error instanceof Error ? error.message : "成本儲存失敗。";
    },
  });

  const remove = createMutation({
    mutationFn: (id: string) => api.delete(`/api/investments/manual/${id}`),
    onSuccess: invalidateInvestments,
  });

  const refreshQuotes = createMutation({
    mutationFn: () => api.post<QuoteResult>("/api/investments/quotes/refresh"),
    onSuccess: (result) => {
      invalidateInvestments();
      quoteMessage = quoteResultMessage(result);
    },
    onError: (error) => {
      quoteMessage = error instanceof Error ? error.message : "行情更新失敗。";
    },
  });

  function invalidateInvestments() {
    qc.invalidateQueries({ queryKey: queryKeys.investments });
    qc.invalidateQueries({ queryKey: queryKeys.manualAssets });
    qc.invalidateQueries({ queryKey: queryKeys.netWorthHistory });
  }

  function quoteResultMessage(result: QuoteResult) {
    if (result.status === "not_configured")
      return "已儲存持倉；尚未設定行情 API，先以成本估值。";
    if (result.failed > 0)
      return `持倉已儲存，行情更新 ${result.updated} 筆，${result.failed} 筆失敗。`;
    return result.updated > 0
      ? `持倉已儲存，行情已更新 ${result.updated} 筆。`
      : "持倉已儲存，目前沒有可更新的行情。";
  }

  function reset() {
    formError = "";
    form = {
      name: "",
      symbol: "",
      quantity: "",
      costPerShare: "",
      note: "",
    };
  }

  function openAdd() {
    adding = true;
    editing = null;
    reset();
  }

  function startEdit(position: InvestmentRow) {
    if (!position.isManual) return;
    editing = position;
    adding = false;
    formError = "";
    form = {
      name: position.name,
      symbol: position.symbol ?? "",
      quantity: position.quantity == null ? "" : String(position.quantity),
      costPerShare:
        position.costPerShare == null ? "" : String(position.costPerShare),
      note: "",
    };
  }

  function closeEditor() {
    adding = false;
    editing = null;
    reset();
  }

  function startCostEdit(position: InvestmentRow) {
    editingCost = position;
    costInput =
      position.costPerShare == null ? "" : String(position.costPerShare);
    costError = "";
  }

  function saveSyncedCost() {
    if (!editingCost) return;
    const costPerShare = Number(costInput);
    if (!Number.isFinite(costPerShare) || costPerShare <= 0) {
      costError = "請輸入大於 0 的每股成本。";
      return;
    }
    costError = "";
    $updateSyncedCost.mutate({ id: editingCost.id, costPerShare });
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

  function submit() {
    const quantity = Number(form.quantity);
    const costPerShare = Number(form.costPerShare);
    if (
      !form.name.trim() ||
      !form.symbol.trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(costPerShare) ||
      costPerShare <= 0
    ) {
      formError = "請輸入股票名稱、代號、股數與每股成本。";
      return;
    }
    formError = "";
    editing ? $update.mutate() : $add.mutate();
  }

  function removeHolding(position: InvestmentRow) {
    if (!position.isManual) return;
    if (
      window.confirm(
        `確定刪除 ${position.symbol ?? position.name} 的手動持倉？`,
      )
    )
      $remove.mutate(position.id);
  }

  function tradeDisplay(trade: InvestmentTransactionRow) {
    if (trade.amount != null && trade.price != null && trade.price !== 1)
      return formatCurrency(trade.amount, trade.currency);
    if (trade.quantity != null) return `${formatNumber(trade.quantity)} 股`;
    return "金額未提供";
  }
</script>

<div class={compact ? "grid gap-3" : "flex min-h-full flex-col"}>
  {#if !compact}
    <header class="border-b border-ink/10 px-5 py-4">
      <p class="text-caption font-medium text-subtle">投資</p>
      <h2 class="mt-1 text-xl font-semibold tracking-tight">投資組合</h2>
      <p class="mt-1 text-caption text-subtle">持倉與交易紀錄集中查看</p>
    </header>
    <div class="grid grid-cols-2 gap-6 border-b border-ink/10 px-5 py-4">
      <div>
        <p class="text-caption text-subtle">投資市值</p>
        <p class="mt-2 text-lg font-medium tabular-nums text-steel">
          {formatCurrency(total)}
        </p>
      </div>
      <div>
        <p class="text-caption text-subtle">持倉</p>
        <p class="mt-2 text-lg font-medium tabular-nums">
          {positions.length} 筆
        </p>
      </div>
    </div>
  {/if}

  <div
    class={`flex gap-1 border-b border-ink/8 pt-2 ${compact ? "" : "px-4"}`}
    role="tablist"
    aria-label="投資組合"
  >
    <button
      class={`min-h-10 border-b-2 px-3 text-sm font-semibold ${tab === "holdings" ? "border-steel text-ink" : "border-transparent text-subtle"}`}
      type="button"
      role="tab"
      aria-selected={tab === "holdings"}
      onclick={() => (tab = "holdings")}>持倉</button
    >
    <button
      class={`min-h-10 border-b-2 px-3 text-sm font-semibold ${tab === "transactions" ? "border-steel text-ink" : "border-transparent text-subtle"}`}
      type="button"
      role="tab"
      aria-selected={tab === "transactions"}
      onclick={() => (tab = "transactions")}>交易紀錄</button
    >
  </div>

  <div class={compact ? "" : "min-h-0 flex-1 overflow-y-auto px-5 pb-4"}>
    {#if tab === "holdings"}
      <div class="flex flex-wrap items-center justify-between gap-2 py-3">
        <p class="text-caption text-subtle">
          行情會依股票代號自動更新目前市值。
        </p>
        <div class="flex flex-wrap gap-2">
          {#if manualPositions.length > 0}<Button
              size="sm"
              variant="secondary"
              disabled={$refreshQuotes.isPending}
              onclick={() => $refreshQuotes.mutate()}
              >{#if $refreshQuotes.isPending}<RefreshCw
                  class="size-4 animate-spin"
                />更新中…{:else}<RefreshCw
                  class="size-4"
                />更新行情{/if}</Button
            >{/if}
          <Button size="sm" variant="primary" onclick={openAdd}
            ><Plus class="size-4" />新增美股持倉</Button
          >
        </div>
      </div>
      {#if quoteMessage}<p class="pb-2 text-sm text-subtle" role="status">
          {quoteMessage}
        </p>{/if}
      {#if positions.length === 0}
        <p class="py-8 text-center text-sm text-subtle">尚無投資持倉。</p>
      {:else}
        <div class="divide-y divide-border">
          {#each positions as position (position.id)}
            <div class="flex items-center gap-3 py-3">
              <div class="min-w-0 flex-1">
                <p class="break-words text-sm font-semibold">
                  {position.symbol ? `${position.symbol} ` : ""}{position.name}
                </p>
                <p class="mt-1 text-caption text-subtle">
                  {position.assetType.toUpperCase()} · {position.currency} ·
                  {formatNumber(position.quantity ?? 0)} 股{#if position.isManual && position.costPerShare != null}
                    · 成本 {formatCurrency(
                      position.costPerShare,
                      position.currency,
                      6,
                    )}/股
                  {/if}{#if position.isManual && position.marketPrice != null}
                    · 現價 {formatCurrency(
                      position.marketPrice,
                      position.currency,
                    )}
                  {/if}{#if position.marketPriceAsOf}
                    · {formatDate(position.marketPriceAsOf)}
                  {/if}
                  {#if !position.isManual && position.costPerShare != null}
                    · 成本 {formatCurrency(
                      position.costPerShare,
                      position.currency,
                      6,
                    )}/股
                  {/if}
                  {#if !position.isManual && brokerLabel(position)}
                    · {brokerLabel(position)}
                  {/if}
                </p>
              </div>
              <p class="text-right text-sm font-medium tabular-nums text-steel">
                {formatCurrency(
                  (position.marketValue ?? position.costBasis ?? 0) +
                    (position.cashBalance ?? 0),
                  position.currency,
                )}
              </p>
              {#if position.isManual}<div
                  class="flex shrink-0 items-center gap-1"
                >
                  <button
                    class="rounded-sm p-1 text-subtle hover:text-steel"
                    aria-label="編輯手動持倉"
                    type="button"
                    onclick={() => startEdit(position)}
                    ><Pencil class="size-4" /></button
                  ><button
                    class="rounded-sm p-1 text-subtle hover:text-coral"
                    aria-label="刪除手動持倉"
                    type="button"
                    onclick={() => removeHolding(position)}
                    ><Trash2 class="size-4" /></button
                  >
                </div>{:else}<button
                  class="shrink-0 rounded-sm p-1 text-subtle hover:text-steel"
                  aria-label={`設定 ${position.symbol ?? position.name} 的持倉成本`}
                  type="button"
                  onclick={() => startCostEdit(position)}
                  ><Pencil class="size-4" /></button
                >{/if}
            </div>
            {#if editingCost?.id === position.id}
              <div class="flex flex-wrap items-end gap-2 pb-3 pl-1">
                <label
                  class="grid gap-1 text-caption text-subtle"
                  for={`investment-cost-${position.id}`}
                >
                  每股／單位成本（{position.currency}）
                  <input
                    id={`investment-cost-${position.id}`}
                    class="min-h-9 w-36 rounded-md border border-ink/15 bg-white px-2 text-sm text-ink"
                    type="number"
                    min="0.000001"
                    step="any"
                    bind:value={costInput}
                  />
                </label>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={$updateSyncedCost.isPending}
                  onclick={saveSyncedCost}>儲存成本</Button
                >
                <Button
                  size="sm"
                  variant="secondary"
                  onclick={() => (editingCost = null)}>取消</Button
                >
                {#if costError}<p
                    class="w-full text-caption text-coral"
                    role="alert"
                  >
                    {costError}
                  </p>{/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    {:else if tradesPending}
      <p class="py-8 text-center text-sm text-subtle">正在載入交易紀錄。</p>
    {:else if tradesError}
      <p class="py-8 text-center text-sm text-coral">交易紀錄暫時無法載入。</p>
    {:else if trades.length === 0}
      <p class="py-8 text-center text-sm text-subtle">尚無交易紀錄。</p>
    {:else}
      <div class="divide-y divide-border">
        {#each trades.slice(0, 100) as trade (trade.id)}
          <div
            class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"
          >
            <div class="min-w-0">
              <p class="break-words text-sm font-semibold">
                {trade.name ?? trade.symbol ?? "投資交易"}
              </p>
              <p class="mt-1 text-caption text-subtle">
                {trade.transactionName ?? trade.transactionCode ?? "交易"} ·
                {formatDate(trade.tradeDate ?? trade.postedDate)}
              </p>
            </div>
            <p class="text-right text-sm font-semibold">
              {tradeDisplay(trade)}
            </p>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if adding || editing}
    <div
      class="fixed inset-0 z-[70] flex items-end bg-ink/45 md:items-center md:justify-center md:p-6"
    >
      <div
        aria-labelledby="manual-investment-editor-title"
        aria-modal="true"
        class="w-full rounded-t-2xl bg-white p-5 shadow-2xl md:max-w-lg md:rounded-2xl"
        role="dialog"
      >
        <h2 id="manual-investment-editor-title" class="text-xl font-semibold">
          {editing ? "編輯美股持倉" : "新增美股持倉"}
        </h2>
        <p class="mt-2 text-sm leading-6 text-subtle">
          輸入成本與股數；儲存後會用股票代號向行情 API 取得目前價格與市值。
        </p>
        <div class="mt-5 grid gap-3">
          <label class="grid gap-1 text-sm"
            >股票名稱<Input required bind:value={form.name} /></label
          ><label class="grid gap-1 text-sm"
            >股票代號<Input
              required
              maxlength="16"
              placeholder="例如 AAPL、MSFT"
              bind:value={form.symbol}
            /></label
          >
          <div class="grid grid-cols-2 gap-3">
            <label class="grid gap-1 text-sm"
              >持有股數<Input
                required
                min="0"
                step="any"
                type="number"
                bind:value={form.quantity}
              /></label
            ><label class="grid gap-1 text-sm"
              >平均成本／股（USD）<Input
                required
                min="0"
                step="any"
                type="number"
                bind:value={form.costPerShare}
              /></label
            >
          </div>
          <label class="grid gap-1 text-sm"
            >備註<Textarea rows="2" bind:value={form.note} /></label
          >
          {#if formError}<p class="text-sm font-medium text-coral" role="alert">
              {formError}
            </p>{/if}
        </div>
        <div class="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onclick={closeEditor}>取消</Button><Button
            disabled={$add.isPending || $update.isPending}
            onclick={submit}
            >{$add.isPending || $update.isPending ? "儲存中…" : "儲存"}</Button
          >
        </div>
      </div>
    </div>
  {/if}
</div>
