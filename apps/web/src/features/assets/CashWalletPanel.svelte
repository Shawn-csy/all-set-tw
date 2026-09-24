<script lang="ts">
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import { cashWalletQuery } from "@/data/assets/queries";
  import type { ApiClient } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import { formatCurrency } from "@/shared/format/financial";
  import Button from "@/shared/ui/Button.svelte";
  import Input from "@/shared/ui/Input.svelte";

  let { api }: { api: ApiClient } = $props();
  const qc = useQueryClient();
  const wallet = createQuery(cashWalletQuery(() => api));
  let openingBalance = $state("");
  let initialized = $state(false);

  $effect(() => {
    if ($wallet.data && !initialized) {
      openingBalance = String($wallet.data.openingBalance);
      initialized = true;
    }
  });

  const update = createMutation({
    mutationFn: (value: number) =>
      api.put("/api/cash-wallet", { openingBalance: value }),
    onSuccess: (value) => {
      qc.setQueryData(queryKeys.cashWallet, value);
      qc.invalidateQueries({ queryKey: queryKeys.cashWallet });
      initialized = false;
    },
  });

  function save() {
    const value = Number(openingBalance);
    if (!Number.isFinite(value)) return;
    $update.mutate(Math.trunc(value));
  }
</script>

<section class="rounded-2xl border border-ink/10 bg-white p-5 shadow-sm md:p-6">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <p class="text-sm text-subtle">現金錢包</p>
      <p class="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
        {formatCurrency($wallet.data?.balance ?? 0)}
      </p>
      <p class="mt-2 text-caption text-subtle">
        提款會增加；現金支付發票會扣除。這是本地帳本，不會被銀行同步覆蓋。
      </p>
    </div>
    <div class="grid min-w-[12rem] gap-2 text-right text-sm tabular-nums">
      <span class="text-subtle"
        >提款增加 {formatCurrency($wallet.data?.cashWithdrawals ?? 0)}</span
      >
      <span class="text-subtle"
        >現金支出 {formatCurrency($wallet.data?.cashExpenses ?? 0)}</span
      >
    </div>
  </div>
  <div class="mt-5 flex flex-wrap items-end gap-3 border-t border-ink/10 pt-4">
    <label class="min-w-52 flex-1">
      <span class="mb-1 block text-caption font-medium text-subtle"
        >初始現金餘額</span
      >
      <Input
        bind:value={openingBalance}
        type="number"
        min="0"
        step="1"
        aria-label="初始現金餘額"
      />
    </label>
    <Button
      class="h-10"
      disabled={$update.isPending || $wallet.isPending}
      onclick={save}>{$update.isPending ? "儲存中…" : "儲存現金餘額"}</Button
    >
  </div>
  {#if $update.isError}
    <p class="mt-3 text-sm text-coral">現金餘額更新失敗，請稍後再試。</p>
  {/if}
</section>
