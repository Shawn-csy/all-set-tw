<script lang="ts">
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import { Trash2 } from "@lucide/svelte";
  import {
    classificationCategoriesQuery,
    classificationMerchantsQuery,
  } from "@/data/classification/queries";
  import type {
    ClassificationMerchantProductRuleRow,
    ClassificationMerchantRuleRow,
    ClassificationMerchantRow,
  } from "@/data/classification/types";
  import type { ApiClient } from "@/shared/api/client";
  import { messageFromError } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import Badge from "@/shared/ui/Badge.svelte";
  import Button from "@/shared/ui/Button.svelte";
  import Card from "@/shared/ui/Card.svelte";
  import CardContent from "@/shared/ui/CardContent.svelte";
  import CardHeader from "@/shared/ui/CardHeader.svelte";
  import Input from "@/shared/ui/Input.svelte";
  import Select from "@/shared/ui/Select.svelte";

  let { api }: { api: ApiClient } = $props();
  const qc = useQueryClient();
  const merchants = createQuery(classificationMerchantsQuery(() => api));
  const categories = createQuery(classificationCategoriesQuery(() => api));

  let selectedMerchantId = $state("");
  let merchantName = $state("");
  let defaultCategoryId = $state("");
  let merchantPattern = $state("");
  let merchantOperator = $state("contains");
  let merchantField = $state("any_text");
  let merchantTargetType = $state("bank_transaction");
  let productPattern = $state("");
  let productOperator = $state("contains");
  let productField = $state("description");
  let productTargetType = $state("invoice_item");
  let productCategoryId = $state("");

  const merchantRows = $derived($merchants.data?.merchants ?? []);
  const selectedMerchant = $derived(
    merchantRows.find((merchant) => merchant.id === selectedMerchantId),
  );
  const selectedMerchantRules = $derived(
    ($merchants.data?.merchantRules ?? []).filter(
      (rule) => rule.merchantId === selectedMerchantId,
    ),
  );
  const selectedProductRules = $derived(
    ($merchants.data?.productRules ?? []).filter(
      (rule) => rule.merchantId === selectedMerchantId,
    ),
  );
  const categoryRows = $derived($categories.data ?? []);
  const merchantFieldLabels: Record<string, string> = {
    any_text: "名稱或摘要",
    description: "交易名稱",
    counterparty: "交易對象",
    source_id: "來源編號",
  };

  $effect(() => {
    if (!selectedMerchantId && merchantRows[0]) chooseMerchant(merchantRows[0]);
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: queryKeys.classificationRules });
    void qc.invalidateQueries({ queryKey: queryKeys.bank });
    void qc.invalidateQueries({ queryKey: queryKeys.invoices });
  }

  function chooseMerchant(merchant: ClassificationMerchantRow) {
    selectedMerchantId = merchant.id;
    defaultCategoryId = merchant.defaultCategoryId ?? "";
  }

  const createMerchant = createMutation({
    mutationFn: () =>
      api.post<ClassificationMerchantRow>("/api/classification/merchants", {
        name: merchantName.trim(),
        defaultCategoryId: null,
      }),
    onSuccess: (merchant) => {
      merchantName = "";
      selectedMerchantId = merchant.id;
      defaultCategoryId = merchant.defaultCategoryId ?? "";
      invalidate();
    },
  });

  const updateMerchant = createMutation({
    mutationFn: () =>
      api.put(
        `/api/classification/merchants/${encodeURIComponent(selectedMerchantId)}`,
        {
          defaultCategoryId: defaultCategoryId || null,
        },
      ),
    onSuccess: invalidate,
  });

  const createMerchantRule = createMutation({
    mutationFn: () =>
      api.post(
        `/api/classification/merchants/${encodeURIComponent(selectedMerchantId)}/match-rules`,
        {
          field: merchantField,
          operator: merchantOperator,
          pattern: merchantPattern.trim(),
          targetType: merchantTargetType,
          priority: 200,
        },
      ),
    onSuccess: () => {
      merchantPattern = "";
      invalidate();
    },
  });

  const createProductRule = createMutation({
    mutationFn: () =>
      api.post(
        `/api/classification/merchants/${encodeURIComponent(selectedMerchantId)}/product-rules`,
        {
          categoryId: productCategoryId,
          field: productField,
          operator: productOperator,
          pattern: productPattern.trim(),
          targetType: productTargetType,
          priority: 200,
        },
      ),
    onSuccess: () => {
      productPattern = "";
      invalidate();
    },
  });

  const deleteRule = createMutation({
    mutationFn: ({ id, kind }: { id: string; kind: "merchant" | "product" }) =>
      api.delete(
        kind === "merchant"
          ? `/api/classification/merchant-rules/${encodeURIComponent(id)}`
          : `/api/classification/merchant-product-rules/${encodeURIComponent(id)}`,
      ),
    onSuccess: invalidate,
  });

  const toggleRule = createMutation({
    mutationFn: ({
      rule,
      kind,
    }: {
      rule:
        ClassificationMerchantRuleRow | ClassificationMerchantProductRuleRow;
      kind: "merchant" | "product";
    }) =>
      api.put(
        kind === "merchant"
          ? `/api/classification/merchant-rules/${encodeURIComponent(rule.id)}`
          : `/api/classification/merchant-product-rules/${encodeURIComponent(rule.id)}`,
        { enabled: !rule.enabled },
      ),
    onSuccess: invalidate,
  });

  function submitCreateMerchant(event: SubmitEvent) {
    event.preventDefault();
    if (merchantName.trim()) $createMerchant.mutate();
  }

  function submitMerchantRule(event: SubmitEvent) {
    event.preventDefault();
    if (selectedMerchantId && merchantPattern.trim())
      $createMerchantRule.mutate();
  }

  function submitProductRule(event: SubmitEvent) {
    event.preventDefault();
    if (selectedMerchantId && productPattern.trim() && productCategoryId)
      $createProductRule.mutate();
  }
</script>

<Card class="w-full min-w-0">
  <CardHeader>
    <div>
      <h2 class="hidden text-lg font-semibold md:block">商家與產品分類</h2>
    </div>
  </CardHeader>
  <CardContent class="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
    <section class="grid content-start gap-3" aria-label="商家清單">
      {#if $merchants.isPending}
        <p class="text-sm text-muted-foreground">載入商家中…</p>
      {:else if merchantRows.length === 0}
        <p class="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
          尚未建立商家。
        </p>
      {:else}
        <div class="grid gap-1">
          {#each merchantRows as merchant (merchant.id)}
            <button
              type="button"
              class={`rounded-lg border px-3 py-2 text-left text-sm transition ${selectedMerchantId === merchant.id ? "border-steel bg-steel/10" : "border-border hover:bg-muted/50"}`}
              onclick={() => chooseMerchant(merchant)}
            >
              <span class="block font-semibold">{merchant.name}</span>
              <span class="mt-1 block text-xs text-muted-foreground">
                預設：{merchant.defaultCategoryLabel ?? "未設定"}
              </span>
            </button>
          {/each}
        </div>
      {/if}
      <details class="rounded-lg border border-border bg-muted/20 p-3">
        <summary class="cursor-pointer text-sm font-semibold text-steel">
          新增商家
        </summary>
        <form class="mt-3 grid gap-2" onsubmit={submitCreateMerchant}>
          <label class="grid gap-1 text-sm font-medium">
            商家名稱
            <Input placeholder="例如：7-11、Apple" bind:value={merchantName} />
          </label>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={!merchantName.trim() || $createMerchant.isPending}
          >
            {$createMerchant.isPending ? "新增中…" : "儲存商家"}
          </Button>
        </form>
      </details>
      {#if $createMerchant.isError}
        <p class="text-sm text-destructive" role="alert">
          {messageFromError($createMerchant.error)}
        </p>
      {/if}
    </section>

    {#if selectedMerchant}
      <section
        class="grid min-w-0 gap-5"
        aria-label={`${selectedMerchant.name} 分類規則`}
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="text-base font-semibold">{selectedMerchant.name}</h3>
          </div>
          <div class="flex items-center gap-2">
            <Select
              class="h-9 w-36"
              bind:value={defaultCategoryId}
              aria-label="商家預設分類"
            >
              <option value="">不設定預設分類</option>
              {#each categoryRows as category (category.id)}
                <option value={category.id}>{category.label}</option>
              {/each}
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={$updateMerchant.isPending}
              onclick={() => $updateMerchant.mutate()}
            >
              儲存預設
            </Button>
          </div>
        </div>

        <details class="rounded-xl border border-border bg-muted/20 p-4">
          <summary class="cursor-pointer font-semibold text-steel"
            >新增商家辨識規則</summary
          >
          <form class="mt-3 grid gap-3" onsubmit={submitMerchantRule}>
            <div>
              <h4 class="font-semibold">商家辨識規則</h4>
              <p class="mt-1 text-xs text-muted-foreground">
                例如摘要包含「統一超」時辨識為 7-11。
              </p>
            </div>
            <div class="grid gap-2 sm:grid-cols-3">
              <Select bind:value={merchantField} aria-label="商家辨識欄位">
                <option value="any_text">名稱或摘要</option>
                <option value="description">交易名稱</option>
                <option value="counterparty">交易對象</option>
                <option value="source_id">來源編號</option>
              </Select>
              <Select bind:value={merchantOperator} aria-label="商家辨識運算子">
                <option value="contains">包含</option>
                <option value="equals">完全相同</option>
                <option value="starts_with">開頭為</option>
                <option value="regex">正則</option>
              </Select>
              <Select
                bind:value={merchantTargetType}
                aria-label="商家辨識資料來源"
              >
                <option value="bank_transaction">銀行／信用卡</option>
                <option value="invoice_item">發票品項</option>
              </Select>
            </div>
            <div class="flex gap-2">
              <Input
                class="min-w-0 flex-1"
                placeholder="例如：7-11|統一超"
                bind:value={merchantPattern}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={!merchantPattern.trim() ||
                  $createMerchantRule.isPending}>新增</Button
              >
            </div>
          </form>
        </details>

        <div class="grid gap-2">
          <h4 class="font-semibold">
            商家辨識規則（{selectedMerchantRules.length}）
          </h4>
          {#each selectedMerchantRules as rule (rule.id)}
            <div
              class={`flex min-w-0 items-center gap-2 rounded-lg border border-border p-3 text-sm ${rule.enabled ? "" : "opacity-50"}`}
            >
              <input
                type="checkbox"
                checked={rule.enabled}
                aria-label="啟用商家辨識規則"
                onchange={() => $toggleRule.mutate({ rule, kind: "merchant" })}
              />
              <span class="min-w-0 flex-1 break-words">{rule.pattern}</span>
              <Badge variant="outline">
                {merchantFieldLabels[rule.field] ?? rule.field}
              </Badge>
              <Button
                size="icon"
                variant="ghost"
                class="size-8 text-destructive"
                aria-label="刪除商家辨識規則"
                onclick={() =>
                  $deleteRule.mutate({ id: rule.id, kind: "merchant" })}
                ><Trash2 class="size-4" /></Button
              >
            </div>
          {/each}
        </div>

        <details class="rounded-xl border border-steel/25 bg-steel/5 p-4">
          <summary class="cursor-pointer font-semibold text-steel"
            >新增產品／服務規則</summary
          >
          <form class="mt-3 grid gap-3" onsubmit={submitProductRule}>
            <div>
              <h4 class="font-semibold">商家內產品／服務規則</h4>
              <p class="mt-1 text-xs text-muted-foreground">
                優先使用發票品項；銀行摘要沒有品項時不會硬猜。
              </p>
            </div>
            <div class="grid gap-2 sm:grid-cols-4">
              <Select
                bind:value={productTargetType}
                aria-label="產品規則資料來源"
              >
                <option value="invoice_item">發票品項</option>
                <option value="bank_transaction">銀行／信用卡摘要</option>
              </Select>
              <Select bind:value={productField} aria-label="產品規則欄位">
                <option value="description">品項／交易名稱</option>
                <option value="any_text">所有文字</option>
                <option value="counterparty">交易對象</option>
              </Select>
              <Select bind:value={productOperator} aria-label="產品規則運算子">
                <option value="contains">包含</option>
                <option value="equals">完全相同</option>
                <option value="starts_with">開頭為</option>
                <option value="regex">正則</option>
              </Select>
              <Select bind:value={productCategoryId} aria-label="產品規則分類">
                <option value="">選擇分類</option>
                {#each categoryRows as category (category.id)}
                  <option value={category.id}>{category.label}</option>
                {/each}
              </Select>
            </div>
            <div class="flex gap-2">
              <Input
                class="min-w-0 flex-1"
                placeholder="例如：咖啡|飯糰"
                bind:value={productPattern}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={!productPattern.trim() ||
                  !productCategoryId ||
                  $createProductRule.isPending}>新增</Button
              >
            </div>
          </form>
        </details>

        <div class="grid gap-2">
          <h4 class="font-semibold">
            產品／服務規則（{selectedProductRules.length}）
          </h4>
          {#each selectedProductRules as rule (rule.id)}
            <div
              class={`flex min-w-0 items-center gap-2 rounded-lg border border-border p-3 text-sm ${rule.enabled ? "" : "opacity-50"}`}
            >
              <input
                type="checkbox"
                checked={rule.enabled}
                aria-label="啟用產品規則"
                onchange={() => $toggleRule.mutate({ rule, kind: "product" })}
              />
              <span class="min-w-0 flex-1 break-words">{rule.pattern}</span>
              <Badge variant="outline">{rule.categoryLabel}</Badge>
              <Button
                size="icon"
                variant="ghost"
                class="size-8 text-destructive"
                aria-label="刪除產品規則"
                onclick={() =>
                  $deleteRule.mutate({ id: rule.id, kind: "product" })}
                ><Trash2 class="size-4" /></Button
              >
            </div>
          {/each}
        </div>

        {#if $createMerchantRule.isError || $createProductRule.isError || $updateMerchant.isError || $deleteRule.isError}
          <p class="text-sm text-destructive" role="alert">
            {messageFromError(
              $createMerchantRule.error ??
                $createProductRule.error ??
                $updateMerchant.error ??
                $deleteRule.error,
            )}
          </p>
        {/if}
      </section>
    {:else}
      <div
        class="grid min-h-40 place-items-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
      >
        請先新增或選擇一個商家。
      </div>
    {/if}
  </CardContent>
</Card>
