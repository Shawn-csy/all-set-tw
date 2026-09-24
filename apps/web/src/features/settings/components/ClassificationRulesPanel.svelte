<script lang="ts">
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import { ChevronDown, ChevronUp, Pencil, Plus } from "@lucide/svelte";
  import Card from "@/shared/ui/Card.svelte";
  import CardHeader from "@/shared/ui/CardHeader.svelte";
  import CardContent from "@/shared/ui/CardContent.svelte";
  import Button from "@/shared/ui/Button.svelte";
  import Badge from "@/shared/ui/Badge.svelte";
  import Checkbox from "@/shared/ui/Checkbox.svelte";
  import Input from "@/shared/ui/Input.svelte";
  import Select from "@/shared/ui/Select.svelte";
  import type { ApiClient } from "@/shared/api/client";
  import { messageFromError } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import {
    classificationCategoriesQuery,
    classificationRulesQuery,
  } from "@/data/classification/queries";
  import type {
    ClassificationCategoryRow,
    ClassificationRuleRow,
  } from "@/data/classification/types";

  type RuleOperator = "contains" | "equals" | "starts_with" | "regex";
  type EditableRule = {
    id: string;
    categoryId: string;
    pattern: string;
    operator: RuleOperator;
  };

  let { api }: { api: ApiClient } = $props();

  const operatorLabels: Record<string, string> = {
    contains: "包含",
    equals: "完全等於",
    starts_with: "開頭為",
    regex: "符合正規表示式",
  };
  function behaviorLabel(behavior?: string) {
    return (
      {
        normal: "一般收支",
        asset_transfer: "資產轉換",
        cash_withdrawal: "提款至現金",
        excluded: "不列入統計",
      }[behavior ?? "normal"] ?? "一般收支"
    );
  }
  const systemAutoRules = [
    {
      title: "帳戶互轉",
      description:
        "同日、同幣別、同金額且方向相反的已入帳交易，會在不同帳戶間自動配對，分類為「轉帳」並排除收支計算；相同銀行的不同帳戶也適用。",
    },
    {
      title: "信用卡年費減免",
      description:
        "同一張信用卡同日出現同幣別、同金額、方向相反的「年費」與減免相關交易時，會自動互相沖銷，分類為「手續費」並排除收支計算；一般退款不套用。",
    },
    {
      title: "電子發票配對",
      description:
        "電子發票與同日、同金額的 TWD 銀行／信用卡支出會自動配對；一筆發票與交易只配對一次，已配對發票不會重複計入支出。手動連結或「解除並保持分開」優先。",
    },
  ] as const;
  const rules = createQuery(classificationRulesQuery(() => api));
  const categories = createQuery(classificationCategoriesQuery(() => api));
  const qc = useQueryClient();
  const categoryLabels = $derived(
    Object.fromEntries(
      ($categories.data ?? []).map((category) => [category.id, category.label]),
    ),
  );
  let newRule = $state({
    categoryId: "food",
    pattern: "",
    operator: "contains",
  });
  let showCategoryForm = $state(false);
  let categoryName = $state("");
  let editingRule = $state<EditableRule | undefined>();

  function startEditing(rule: ClassificationRuleRow) {
    editingRule = {
      id: rule.id,
      categoryId: rule.categoryId,
      pattern: rule.pattern,
      operator: rule.operator as RuleOperator,
    };
  }

  function invalidateRuleResults() {
    qc.invalidateQueries({ queryKey: queryKeys.classificationRules });
    qc.invalidateQueries({ queryKey: queryKeys.bank });
  }

  function editableRuleIndex(ruleId: string) {
    return ($rules.data ?? [])
      .filter((rule) => !rule.isSystem)
      .findIndex((rule) => rule.id === ruleId);
  }

  const editableRuleCount = $derived(
    ($rules.data ?? []).filter((rule) => !rule.isSystem).length,
  );

  const addCategory = createMutation({
    mutationFn: () =>
      api.post<ClassificationCategoryRow>("/api/classification/categories", {
        label: categoryName,
      }),
    onSuccess: (category) => {
      qc.invalidateQueries({ queryKey: queryKeys.classificationCategories });
      newRule.categoryId = category.id;
      categoryName = "";
      showCategoryForm = false;
    },
  });
  const add = createMutation({
    mutationFn: () =>
      api.post("/api/classification/rules", {
        ...newRule,
        targetType: "bank_transaction",
        field: "any_text",
        priority: 200,
      }),
    onSuccess: () => {
      invalidateRuleResults();
      newRule.pattern = "";
    },
  });
  const toggle = createMutation({
    mutationFn: (payload: { id: string; enabled: boolean }) =>
      api.put(`/api/classification/rules/${payload.id}`, {
        enabled: payload.enabled,
      }),
    onSuccess: invalidateRuleResults,
  });
  const update = createMutation({
    mutationFn: (rule: EditableRule) =>
      api.put(`/api/classification/rules/${rule.id}`, {
        categoryId: rule.categoryId,
        pattern: rule.pattern,
        operator: rule.operator,
      }),
    onSuccess: () => {
      invalidateRuleResults();
      editingRule = undefined;
    },
  });
  const remove = createMutation({
    mutationFn: (id: string) => api.delete(`/api/classification/rules/${id}`),
    onSuccess: invalidateRuleResults,
  });
  const reorder = createMutation({
    mutationFn: (ruleIds: string[]) =>
      api.put("/api/classification/rules/order", { ruleIds }),
    onSuccess: invalidateRuleResults,
  });

  function moveRule(ruleId: string, direction: -1 | 1) {
    const editableRules = ($rules.data ?? []).filter((rule) => !rule.isSystem);
    const currentIndex = editableRules.findIndex(({ id }) => id === ruleId);
    const nextIndex = currentIndex + direction;
    if (
      currentIndex < 0 ||
      nextIndex < 0 ||
      nextIndex >= editableRules.length
    ) {
      return;
    }

    const nextOrder = editableRules.map(({ id }) => id);
    const currentId = nextOrder[currentIndex];
    const nextId = nextOrder[nextIndex];
    if (!currentId || !nextId) return;
    nextOrder[currentIndex] = nextId;
    nextOrder[nextIndex] = currentId;
    $reorder.mutate(nextOrder);
  }
</script>

<Card class="w-full min-w-0">
  <CardHeader class="gap-4">
    <div>
      <h2 class="text-lg font-semibold">分類規則</h2>
      <p class="text-sm text-muted-foreground">
        管理自訂分類規則；現金流向與統計行為由所選分類決定
      </p>
    </div>
  </CardHeader>
  <CardContent>
    <details class="group mb-6 border-b border-border pb-5">
      <summary
        class="flex cursor-pointer list-none items-start justify-between gap-3 rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-steel"
      >
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-base font-semibold">系統自動分類與配對</h3>
            <Badge variant="secondary">內建 3 項</Badge>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">
            查看系統分類，以及「投資」、「提款至現金」和「不列入統計」等特殊分類的行為。
          </p>
        </div>
        <ChevronDown
          class="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div class="mt-3 grid gap-3 md:grid-cols-3">
        {#each systemAutoRules as rule (rule.title)}
          <article class="rounded-lg border border-border bg-muted/30 p-4">
            <h4 class="text-sm font-semibold">{rule.title}</h4>
            <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
              {rule.description}
            </p>
          </article>
        {/each}
      </div>
      <p class="mt-3 text-sm leading-relaxed text-muted-foreground">
        活動套用分類後，該分類會同時決定它是否列入收支、是否為資產轉換，以及是否增加現金錢包。
      </p>
    </details>

    <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="text-base font-semibold">自訂分類規則</h3>
        <p class="mt-1 text-sm text-muted-foreground">
          建立、排序與編輯自己的關鍵字分類規則。
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-expanded={showCategoryForm}
          onclick={() => (showCategoryForm = !showCategoryForm)}
        >
          <Plus class="size-4" />新增分類
        </Button>
        <Badge class="text-sm" variant="secondary"
          >{editableRuleCount} 條自訂規則</Badge
        >
      </div>
    </div>

    {#if showCategoryForm}
      <form
        class="mb-4 grid gap-3 rounded-lg border border-border bg-background p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"
        onsubmit={(event) => {
          event.preventDefault();
          if (categoryName.trim()) $addCategory.mutate();
        }}
      >
        <label class="grid gap-1.5 text-sm font-medium">
          分類名稱
          <Input
            maxlength="24"
            placeholder="例如：寵物、旅遊"
            bind:value={categoryName}
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={!categoryName.trim() || $addCategory.isPending}
        >
          {$addCategory.isPending ? "新增中…" : "儲存分類"}
        </Button>
        <Button
          variant="ghost"
          onclick={() => {
            showCategoryForm = false;
            categoryName = "";
          }}>取消</Button
        >
        {#if $addCategory.isError}
          <p class="text-sm text-destructive sm:col-span-3" role="alert">
            {messageFromError($addCategory.error)}
          </p>
        {/if}
      </form>
    {/if}

    <div
      class="mb-4 overflow-hidden rounded-lg border border-border bg-muted/40"
    >
      <div
        class="grid gap-3 p-4 md:grid-cols-[minmax(0,140px)_minmax(0,140px)_minmax(0,1fr)]"
      >
        <label class="grid gap-1.5 text-sm font-medium">
          分類
          <Select bind:value={newRule.categoryId}>
            {#each $categories.data ?? [] as category (category.id)}
              <option value={category.id}>{category.label}</option>
            {/each}
          </Select>
          <span class="text-xs font-normal text-muted-foreground">
            行為：{behaviorLabel(
              $categories.data?.find(
                (category) => category.id === newRule.categoryId,
              )?.behavior,
            )}
          </span>
        </label>
        <label class="grid gap-1.5 text-sm font-medium">
          條件
          <Select bind:value={newRule.operator}>
            <option value="contains">包含</option>
            <option value="equals">完全等於</option>
            <option value="starts_with">開頭為</option>
            <option value="regex">符合正規表示式</option>
          </Select>
        </label>
        <label class="grid gap-1.5 text-sm font-medium">
          關鍵字
          <Input placeholder="例如：卡費" bind:value={newRule.pattern} />
        </label>
      </div>
      <p class="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        例：選擇「提款至現金」並使用正則表示式
        <code>ATM|提款|現金提領|自動櫃員機</code
        >，符合的銀行扣款會增加現金錢包；選擇「不列入統計」則只排除統計。
      </p>
      <div
        class="flex justify-end border-t border-border bg-background px-4 py-3"
      >
        <Button
          class="w-full sm:w-auto"
          variant="primary"
          disabled={!newRule.pattern.trim() || $add.isPending}
          onclick={() => $add.mutate()}
        >
          {$add.isPending ? "新增中…" : "新增規則"}
        </Button>
      </div>
    </div>

    {#if $categories.isError || $rules.isError}
      <p class="py-3 text-sm text-destructive" role="alert">
        無法載入分類設定，請稍後再試。
      </p>
    {:else if $rules.isPending}
      <p class="py-3 text-sm text-muted-foreground">載入分類規則中…</p>
    {:else if ($rules.data?.length ?? 0) === 0}
      <p class="py-3 text-sm text-muted-foreground">目前還沒有分類規則。</p>
    {:else}
      <div class="divide-y divide-border">
        {#each $rules.data ?? [] as rule (rule.id)}
          <div class="py-3.5 text-sm">
            {#if editingRule && editingRule.id === rule.id}
              <form
                class="rounded-lg border border-border bg-muted/30 p-4"
                onsubmit={(event) => {
                  event.preventDefault();
                  if (editingRule?.pattern.trim()) $update.mutate(editingRule);
                }}
              >
                <div
                  class="grid gap-3 md:grid-cols-[minmax(0,140px)_minmax(0,140px)_minmax(0,1fr)]"
                >
                  <label class="grid gap-1.5 font-medium">
                    分類
                    <Select bind:value={editingRule.categoryId}>
                      {#each $categories.data ?? [] as category (category.id)}
                        <option value={category.id}>{category.label}</option>
                      {/each}
                    </Select>
                  </label>
                  <label class="grid gap-1.5 font-medium">
                    條件
                    <Select bind:value={editingRule.operator}>
                      <option value="contains">包含</option>
                      <option value="equals">完全等於</option>
                      <option value="starts_with">開頭為</option>
                      <option value="regex">符合正規表示式</option>
                    </Select>
                  </label>
                  <label class="grid gap-1.5 font-medium">
                    關鍵字
                    <Input bind:value={editingRule.pattern} />
                  </label>
                </div>
                <div
                  class="mt-4 flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center"
                >
                  <div class="min-w-0 flex-1 text-sm text-muted-foreground">
                    分類行為：{behaviorLabel(
                      $categories.data?.find(
                        (category) => category.id === editingRule?.categoryId,
                      )?.behavior,
                    )}
                  </div>
                  <div class="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      disabled={$update.isPending}
                      onclick={() => (editingRule = undefined)}>取消</Button
                    >
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!editingRule.pattern.trim() ||
                        $update.isPending}
                    >
                      {$update.isPending ? "儲存中…" : "儲存變更"}
                    </Button>
                  </div>
                </div>
              </form>
            {:else}
              <div class="flex min-w-0 flex-wrap items-start gap-3">
                <Checkbox
                  aria-label={`${rule.enabled ? "停用" : "啟用"}${categoryLabels[rule.categoryId] ?? rule.categoryId}規則`}
                  class="mt-1"
                  checked={rule.enabled}
                  disabled={rule.isSystem}
                  onchange={(event: Event) =>
                    $toggle.mutate({
                      id: rule.id,
                      enabled: (event.currentTarget as HTMLInputElement)
                        .checked,
                    })}
                />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <Badge class="text-sm" variant="outline">
                      {categoryLabels[rule.categoryId] ?? rule.categoryId}
                    </Badge>
                    {#if rule.behavior !== "normal"}
                      <Badge
                        class="border-transparent bg-coral/10 text-coral text-sm"
                      >
                        {rule.behavior === "cash_withdrawal"
                          ? "提款至現金"
                          : rule.behavior === "asset_transfer"
                            ? "資產轉換"
                            : "不列入統計"}
                      </Badge>
                    {/if}
                    {#if rule.isSystem}
                      <Badge class="text-sm" variant="secondary">內建</Badge>
                    {/if}
                  </div>
                  <p class="mt-1.5 break-words text-foreground/80">
                    {operatorLabels[rule.operator] ??
                      rule.operator}「{rule.pattern}」
                  </p>
                </div>
                {#if !rule.isSystem}
                  {@const ruleIndex = editableRuleIndex(rule.id)}
                  <div
                    class="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto"
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`將${categoryLabels[rule.categoryId] ?? rule.categoryId}規則上移`}
                      title="上移"
                      disabled={$reorder.isPending || ruleIndex <= 0}
                      onclick={() => moveRule(rule.id, -1)}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`將${categoryLabels[rule.categoryId] ?? rule.categoryId}規則下移`}
                      title="下移"
                      disabled={$reorder.isPending ||
                        ruleIndex >= editableRuleCount - 1}
                      onclick={() => moveRule(rule.id, 1)}
                    >
                      <ChevronDown />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={$update.isPending ||
                        $remove.isPending ||
                        $reorder.isPending}
                      onclick={() => startEditing(rule)}
                    >
                      <Pencil class="size-4" />編輯
                    </Button>
                    <Button
                      class="text-destructive hover:text-destructive"
                      size="sm"
                      variant="ghost"
                      disabled={$remove.isPending &&
                        $remove.variables === rule.id}
                      onclick={() => $remove.mutate(rule.id)}>刪除</Button
                    >
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if $add.isError || $toggle.isError || $update.isError || $remove.isError || $reorder.isError}
      <p class="mt-3 text-sm text-destructive" role="alert">
        {messageFromError(
          $add.error ??
            $toggle.error ??
            $update.error ??
            $remove.error ??
            $reorder.error,
        )}
      </p>
    {/if}
  </CardContent>
</Card>
