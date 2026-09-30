<script lang="ts">
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "@lucide/svelte";
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
  import {
    compileRulePattern,
    parseKeywordAlternation,
    type RuleInputMode,
  } from "@/shared/classification-rule-pattern";
  import { queryKeys } from "@/shared/api/query-keys";
  import {
    classificationCategoriesQuery,
    classificationRulesQuery,
  } from "@/data/classification/queries";
  import type {
    ClassificationCategoryRow,
    ClassificationRuleRow,
  } from "@/data/classification/types";
  import {
    editableRules,
    findRuleConflicts,
    groupRulesByCategory,
    moveRuleWithinTarget,
    rulesForTarget,
    type RuleTarget,
  } from "../model/classification-rule-list";

  type RuleEditor = {
    id?: string;
    targetType: RuleTarget;
    categoryId: string;
    pattern: string;
    mode: RuleInputMode;
  };

  let { api }: { api: ApiClient } = $props();
  const qc = useQueryClient();
  const rules = createQuery(classificationRulesQuery(() => api));
  const categories = createQuery(classificationCategoriesQuery(() => api));
  const operatorLabels: Record<string, string> = {
    contains: "包含",
    equals: "完全等於",
    starts_with: "開頭為",
    regex: "正則",
  };
  const targetLabels: Record<RuleTarget, string> = {
    invoice_item: "發票品項",
    bank_transaction: "銀行／信用卡",
  };

  let selectedTarget = $state<RuleTarget>("invoice_item");
  let ruleSearch = $state("");
  let editor = $state<RuleEditor | null>(null);
  let showCategoryForm = $state(false);
  let categoryName = $state("");
  let categoryEditor = $state<{ id: string; label: string } | null>(null);
  let categoryDeleteCandidate = $state<string | null>(null);
  let categoryReplacementId = $state("");
  let deleteCandidate = $state<string | null>(null);

  const categoryRows = $derived(
    [...($categories.data ?? [])].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    ),
  );
  const categoryLabels = $derived(
    Object.fromEntries(
      ($categories.data ?? []).map((category) => [category.id, category.label]),
    ),
  );
  const customRules = $derived(editableRules($rules.data ?? []));
  const systemRules = $derived(
    ($rules.data ?? []).filter((rule) => rule.isSystem),
  );
  const targetRules = $derived(rulesForTarget(customRules, selectedTarget));
  const visibleRules = $derived(
    rulesForTarget(customRules, selectedTarget, ruleSearch, categoryLabels),
  );
  const invoiceRuleGroups = $derived(
    groupRulesByCategory(visibleRules, categoryRows),
  );
  const conflicts = $derived(findRuleConflicts(customRules));
  const targetConflictCount = $derived(
    targetRules.filter((rule) => conflicts.has(rule.id)).length,
  );
  const editorError = $derived.by(() => {
    if (!editor) return "";
    if (!editor.pattern.trim()) return "請輸入關鍵字或正則表達式。";
    if (!editor.categoryId) return "請選擇分類。";
    const category = ($categories.data ?? []).find(
      (row) => row.id === editor?.categoryId,
    );
    if (
      editor.targetType === "invoice_item" &&
      category?.behavior === "cash_withdrawal"
    )
      return "發票品項不能設定為提款至現金。";
    if (!compileRulePattern(editor.mode, editor.pattern))
      return "比對條件格式有誤或超出長度上限，請修正後再儲存。";
    return "";
  });

  function categoryLabel(id: string) {
    return categoryLabels[id] ?? id;
  }

  function ruleSummary(rule: ClassificationRuleRow) {
    const keywords =
      rule.operator === "regex" ? parseKeywordAlternation(rule.pattern) : null;
    return keywords ? `${keywords.length} 個關鍵字` : rule.pattern;
  }

  function invalidateResults() {
    void qc.invalidateQueries({ queryKey: queryKeys.classificationRules });
    void qc.invalidateQueries({ queryKey: queryKeys.bank });
    void qc.invalidateQueries({ queryKey: queryKeys.invoices });
  }

  function startCreate() {
    const firstCategory = categoryRows.find(
      (category) =>
        selectedTarget !== "invoice_item" ||
        category.behavior !== "cash_withdrawal",
    );
    editor = {
      targetType: selectedTarget,
      categoryId: firstCategory?.id ?? "food",
      pattern: "",
      mode: "keywords",
    };
    showCategoryForm = false;
    categoryName = "";
  }

  function startEdit(rule: ClassificationRuleRow) {
    const keywords =
      rule.operator === "regex" ? parseKeywordAlternation(rule.pattern) : null;
    editor = {
      id: rule.id,
      targetType:
        rule.targetType === "invoice_item"
          ? "invoice_item"
          : "bank_transaction",
      categoryId: rule.categoryId,
      pattern: keywords ? keywords.join("\n") : rule.pattern,
      mode: keywords ? "keywords" : (rule.operator as RuleInputMode),
    };
    showCategoryForm = false;
    categoryName = "";
  }

  function closeEditor() {
    editor = null;
    showCategoryForm = false;
    categoryName = "";
  }

  function startCategoryEdit(category: ClassificationCategoryRow) {
    categoryEditor = { id: category.id, label: category.label };
    showCategoryForm = false;
    categoryDeleteCandidate = null;
  }

  function startCategoryDelete(category: ClassificationCategoryRow) {
    categoryDeleteCandidate = category.id;
    categoryEditor = null;
    categoryReplacementId =
      categoryRows.find((row) => row.id !== category.id)?.id ?? "";
  }

  function closeCategoryActions() {
    categoryEditor = null;
    categoryDeleteCandidate = null;
    categoryReplacementId = "";
  }

  function moveCategory(id: string, direction: -1 | 1) {
    const ids = categoryRows.map((category) => category.id);
    const index = ids.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    $reorderCategories.mutate(ids);
  }

  function changeTarget(target: RuleTarget) {
    selectedTarget = target;
    ruleSearch = "";
    closeEditor();
    deleteCandidate = null;
  }

  const addCategory = createMutation({
    mutationFn: () =>
      api.post<ClassificationCategoryRow>("/api/classification/categories", {
        label: categoryName.trim(),
      }),
    onSuccess: (category) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.classificationCategories,
      });
      if (editor) editor.categoryId = category.id;
      categoryName = "";
      showCategoryForm = false;
    },
  });
  const updateCategory = createMutation({
    mutationFn: (draft: { id: string; label: string }) =>
      api.put(
        `/api/classification/categories/${encodeURIComponent(draft.id)}`,
        { label: draft.label.trim() },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.classificationCategories,
      });
      closeCategoryActions();
    },
  });
  const removeCategory = createMutation({
    mutationFn: (input: { id: string; replacementId: string }) =>
      api.delete(
        `/api/classification/categories/${encodeURIComponent(input.id)}?replacementCategoryId=${encodeURIComponent(input.replacementId)}`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.classificationCategories,
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.classificationRules,
      });
      closeCategoryActions();
    },
  });
  const reorderCategories = createMutation({
    mutationFn: (categoryIds: string[]) =>
      api.put("/api/classification/categories/order", { categoryIds }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.classificationCategories }),
  });
  const save = createMutation({
    mutationFn: (draft: RuleEditor) => {
      const compiled = compileRulePattern(draft.mode, draft.pattern);
      if (!compiled) throw new Error("請輸入有效的比對條件。");
      return draft.id
        ? api.put(`/api/classification/rules/${encodeURIComponent(draft.id)}`, {
            categoryId: draft.categoryId,
            ...compiled,
          })
        : api.post("/api/classification/rules", {
            categoryId: draft.categoryId,
            targetType: draft.targetType,
            field:
              draft.targetType === "invoice_item" ? "description" : "any_text",
            ...compiled,
            priority: 200,
          });
    },
    onSuccess: () => {
      invalidateResults();
      closeEditor();
    },
  });
  const toggle = createMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.put(`/api/classification/rules/${encodeURIComponent(id)}`, {
        enabled,
      }),
    onSuccess: invalidateResults,
  });
  const remove = createMutation({
    mutationFn: (id: string) =>
      api.delete(`/api/classification/rules/${encodeURIComponent(id)}`),
    onSuccess: () => {
      invalidateResults();
      deleteCandidate = null;
    },
  });
  const reorder = createMutation({
    mutationFn: (ruleIds: string[]) =>
      api.put("/api/classification/rules/order", { ruleIds }),
    onSuccess: invalidateResults,
  });

  function moveRule(id: string, direction: -1 | 1) {
    const ids = moveRuleWithinTarget(
      $rules.data ?? [],
      selectedTarget,
      id,
      direction,
    );
    if (ids) $reorder.mutate(ids);
  }
</script>

<Card class="w-full min-w-0">
  <CardHeader class="gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="hidden text-lg font-semibold md:block">分類規則</h2>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="primary"
          onclick={startCreate}
          disabled={$categories.isPending}
        >
          <Plus class="size-4" />新增規則
        </Button>
      </div>
    </div>
  </CardHeader>
  <CardContent>
    <details class="mb-5 rounded-xl border border-border bg-muted/20 p-4">
      <summary class="min-h-8 cursor-pointer text-sm font-semibold text-steel">
        管理分類與顯示順序
      </summary>
      <div class="mt-3">
        <Button
          size="sm"
          variant="outline"
          aria-expanded={showCategoryForm}
          onclick={() => (showCategoryForm = !showCategoryForm)}
        >
          <Plus class="size-4" />新增分類
        </Button>
        {#if showCategoryForm}
          <form
            class="mt-3 grid gap-3 rounded-lg border border-border bg-background p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"
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
              type="button"
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
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">分類管理</h3>
            <p class="mt-1 text-xs text-muted-foreground">
              排序只影響分類顯示；規則命中順序請在規則列表調整。內建分類不能改名或刪除。
            </p>
          </div>
          {#if $reorderCategories.isPending}
            <span class="text-xs text-muted-foreground">儲存排序中…</span>
          {/if}
        </div>

        {#if categoryEditor}
          <form
            class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"
            onsubmit={(event) => {
              event.preventDefault();
              if (categoryEditor?.label.trim())
                $updateCategory.mutate({ ...categoryEditor });
            }}
          >
            <label class="grid gap-1.5 text-sm font-medium">
              編輯分類名稱
              <Input maxlength="24" bind:value={categoryEditor.label} />
            </label>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={!categoryEditor.label.trim() ||
                $updateCategory.isPending}
            >
              {$updateCategory.isPending ? "儲存中…" : "儲存"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onclick={closeCategoryActions}>取消</Button
            >
          </form>
        {/if}

        <div
          class="mt-3 divide-y divide-border rounded-lg border border-border"
        >
          {#each categoryRows as category, index (category.id)}
            <div class="p-2.5">
              <div class="flex min-w-0 items-center gap-2">
                <div class="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    size="icon"
                    class="size-8"
                    variant="ghost"
                    aria-label={`將${category.label}上移`}
                    title="上移"
                    disabled={$reorderCategories.isPending || index === 0}
                    onclick={() => moveCategory(category.id, -1)}
                    ><ChevronUp class="size-4" /></Button
                  >
                  <Button
                    type="button"
                    size="icon"
                    class="size-8"
                    variant="ghost"
                    aria-label={`將${category.label}下移`}
                    title="下移"
                    disabled={$reorderCategories.isPending ||
                      index === categoryRows.length - 1}
                    onclick={() => moveCategory(category.id, 1)}
                    ><ChevronDown class="size-4" /></Button
                  >
                </div>
                <span class="min-w-0 flex-1 truncate text-sm font-medium">
                  {category.label}
                </span>
                {#if category.isSystem}
                  <Badge variant="secondary">內建</Badge>
                {:else}
                  <Badge variant="outline">自訂</Badge>
                  <Button
                    type="button"
                    size="icon"
                    class="size-8"
                    variant="ghost"
                    aria-label={`編輯${category.label}`}
                    onclick={() => startCategoryEdit(category)}
                  >
                    <Pencil class="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    class="size-8 text-destructive"
                    variant="ghost"
                    aria-label={`刪除${category.label}`}
                    disabled={$removeCategory.isPending}
                    onclick={() => startCategoryDelete(category)}
                  >
                    <Trash2 class="size-4" />
                  </Button>
                {/if}
              </div>
              {#if categoryDeleteCandidate === category.id}
                <div
                  class="mt-2 grid gap-2 border-t border-border pt-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"
                >
                  <label class="grid gap-1 text-xs font-medium">
                    刪除後移至
                    <Select bind:value={categoryReplacementId}>
                      {#each categoryRows as replacement (replacement.id)}
                        {#if replacement.id !== category.id}
                          <option value={replacement.id}
                            >{replacement.label}</option
                          >
                        {/if}
                      {/each}
                    </Select>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onclick={closeCategoryActions}>取消</Button
                  >
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    class="text-destructive"
                    disabled={!categoryReplacementId ||
                      $removeCategory.isPending}
                    onclick={() =>
                      $removeCategory.mutate({
                        id: category.id,
                        replacementId: categoryReplacementId,
                      })}
                  >
                    {$removeCategory.isPending ? "刪除中…" : "確定刪除"}
                  </Button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
        {#if $updateCategory.isError || $removeCategory.isError || $reorderCategories.isError}
          <p class="mt-2 text-sm text-destructive" role="alert">
            {messageFromError(
              $updateCategory.error ??
                $removeCategory.error ??
                $reorderCategories.error,
            )}
          </p>
        {/if}
      </div>
    </details>

    <div class="flex flex-wrap gap-2" role="group" aria-label="規則資料來源">
      {#each ["invoice_item", "bank_transaction"] as target (target)}
        <Button
          size="sm"
          variant={selectedTarget === target ? "primary" : "outline"}
          aria-pressed={selectedTarget === target}
          onclick={() => changeTarget(target as RuleTarget)}
        >
          {targetLabels[target as RuleTarget]}
          {rulesForTarget(customRules, target as RuleTarget).length}
        </Button>
      {/each}
    </div>

    {#if editor}
      <form
        class="mt-4 grid gap-4 rounded-xl border border-steel/30 bg-steel/5 p-4"
        onsubmit={(event) => {
          event.preventDefault();
          if (editor && !editorError) $save.mutate({ ...editor });
        }}
      >
        <div class="flex items-center justify-between gap-3">
          <h3 class="font-semibold">{editor.id ? "編輯規則" : "新增規則"}</h3>
          <Badge variant="secondary"
            >{editor.id &&
            !$rules.data?.find((rule) => rule.id === editor?.id)?.targetType
              ? "所有來源"
              : targetLabels[editor.targetType]}</Badge
          >
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="grid gap-1.5 text-sm font-medium">
            條件
            <Select bind:value={editor.mode}>
              <option value="keywords">多個關鍵字（任一符合）</option>
              <option value="contains">包含文字</option>
              <option value="equals">完全相同</option>
              <option value="starts_with">開頭為</option>
              <option value="regex">正則表達式</option>
            </Select>
          </label>
          <label class="grid gap-1.5 text-sm font-medium">
            分類
            <Select bind:value={editor.categoryId}>
              {#each categoryRows.filter((category) => editor?.targetType !== "invoice_item" || category.behavior !== "cash_withdrawal") as category (category.id)}
                <option value={category.id}>{category.label}</option>
              {/each}
            </Select>
          </label>
        </div>
        <label class="grid gap-1.5 text-sm font-medium">
          {editor.mode === "regex"
            ? "正則表達式"
            : editor.mode === "keywords"
              ? "關鍵字（每行一個）"
              : "比對文字"}
          {#if editor.mode === "keywords"}
            <textarea
              aria-label="規則關鍵字"
              class="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="每行一個，例如：&#10;Spotify Premium&#10;YouTube Premium"
              bind:value={editor.pattern}></textarea>
          {:else}
            <Input
              aria-label="規則比對文字"
              placeholder={editor.targetType === "invoice_item"
                ? "例如：Spotify Premium"
                : "例如：信用卡款"}
              bind:value={editor.pattern}
            />
          {/if}
        </label>
        <p class="text-xs text-muted-foreground">
          {#if editor.mode === "keywords"}多個關鍵字會安全地合併成一條正則規則；特殊符號當作一般文字。{/if}
          同一分類、來源與欄位的文字規則會自動整合。
          {editor.targetType === "invoice_item"
            ? "只比對發票品項名稱，不比對商家。"
            : "比對銀行／信用卡交易的名稱與備註。"}
          第一條符合的規則生效；手動指定分類仍優先。
        </p>
        {#if editor.pattern.trim() && editorError}
          <p class="text-sm text-destructive" role="alert">{editorError}</p>
        {/if}
        {#if $save.isError}
          <p class="text-sm text-destructive" role="alert">
            {messageFromError($save.error)}
          </p>
        {/if}
        <div
          class="flex items-center justify-end gap-2 border-t border-border pt-3"
        >
          <Button variant="ghost" type="button" onclick={closeEditor}
            >取消</Button
          >
          <Button
            type="submit"
            variant="primary"
            disabled={Boolean(editorError) || $save.isPending}
          >
            {$save.isPending ? "儲存中…" : "儲存規則"}
          </Button>
        </div>
      </form>
    {/if}

    <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="font-semibold">{targetLabels[selectedTarget]}規則</h3>
        <p class="mt-1 text-xs text-muted-foreground">
          由上而下比對，先符合者生效。
        </p>
      </div>
      <Input
        aria-label="搜尋分類規則"
        class="h-10 w-full sm:w-52"
        placeholder="搜尋規則或分類"
        bind:value={ruleSearch}
      />
    </div>

    {#if targetConflictCount > 0}
      <p
        class="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
        role="status"
      >
        有 {targetConflictCount} 條規則的條件重複；只有規則排序最前面的條件會生效。請檢查下方標記。
      </p>
    {/if}
    <div>
      {#snippet renderInvoiceRule(rule: ClassificationRuleRow)}
        {@const position = targetRules.findIndex((row) => row.id === rule.id)}
        {@const conflict = conflicts.get(rule.id)}
        {@const keywords =
          rule.operator === "regex"
            ? parseKeywordAlternation(rule.pattern)
            : null}
        <article class={`p-2 sm:p-3 ${rule.enabled ? "" : "opacity-60"}`}>
          <div class="flex min-w-0 items-start gap-3">
            <Checkbox
              aria-label={`${rule.enabled ? "停用" : "啟用"}${categoryLabel(rule.categoryId)}規則`}
              class="mt-0.5"
              checked={rule.enabled}
              disabled={$toggle.isPending}
              onchange={(event: Event) =>
                $toggle.mutate({
                  id: rule.id,
                  enabled: (event.currentTarget as HTMLInputElement).checked,
                })}
            />
            <div class="min-w-0 flex-1">
              {#if keywords}
                <details class="group">
                  <summary class="cursor-pointer list-none font-medium">
                    {keywords.length} 個關鍵字（任一符合）
                    <span
                      class="ml-1 text-xs font-normal text-muted-foreground underline"
                      >檢視</span
                    >
                  </summary>
                  <ul class="mt-2 flex flex-wrap gap-1.5">
                    {#each keywords as keyword (`${rule.id}:${keyword}`)}
                      <li
                        class="max-w-full break-words rounded bg-muted px-2 py-1 text-xs"
                      >
                        {keyword}
                      </li>
                    {/each}
                  </ul>
                </details>
              {:else}
                <p class="break-words font-medium">{rule.pattern}</p>
              {/if}
              <div
                class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span>{operatorLabels[rule.operator] ?? rule.operator}</span>
                {#if !rule.targetType}<span>· 所有來源</span>{/if}
                {#if !rule.enabled}<span>· 已停用</span>{/if}
              </div>
              {#if conflict}
                <p class="mt-1 text-xs text-amber-800" role="status">
                  {conflict.kind === "different_category"
                    ? "分類衝突"
                    : "重複條件"}：
                  {conflict.winnerId === rule.id
                    ? "這條會優先套用"
                    : "前面的規則會先套用"}。
                </p>
              {/if}
            </div>
            <div class="flex shrink-0 items-center gap-0.5">
              <Button
                size="icon"
                class="size-8"
                variant="ghost"
                aria-label={`將${ruleSummary(rule)}規則上移`}
                title="上移"
                disabled={Boolean(ruleSearch) ||
                  $reorder.isPending ||
                  position <= 0}
                onclick={() => moveRule(rule.id, -1)}
                ><ChevronUp class="size-4" /></Button
              >
              <Button
                size="icon"
                class="size-8"
                variant="ghost"
                aria-label={`將${ruleSummary(rule)}規則下移`}
                title="下移"
                disabled={Boolean(ruleSearch) ||
                  $reorder.isPending ||
                  position >= targetRules.length - 1}
                onclick={() => moveRule(rule.id, 1)}
                ><ChevronDown class="size-4" /></Button
              >
              <Button
                size="icon"
                class="size-8"
                variant="ghost"
                aria-label={`編輯${ruleSummary(rule)}規則`}
                onclick={() => startEdit(rule)}
              >
                <Pencil class="size-4" />
              </Button>
              {#if deleteCandidate !== rule.id}
                <Button
                  size="icon"
                  class="size-8 text-destructive"
                  variant="ghost"
                  aria-label={`刪除${ruleSummary(rule)}規則`}
                  disabled={$remove.isPending}
                  onclick={() => (deleteCandidate = rule.id)}
                >
                  <Trash2 class="size-4" />
                </Button>
              {/if}
            </div>
          </div>
          {#if deleteCandidate === rule.id}
            <div
              class="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-2 text-xs"
            >
              <span class="mr-auto text-destructive">確定刪除此規則？</span>
              <Button
                size="sm"
                variant="ghost"
                onclick={() => (deleteCandidate = null)}>取消</Button
              >
              <Button
                size="sm"
                variant="outline"
                class="text-destructive"
                disabled={$remove.isPending}
                onclick={() => $remove.mutate(rule.id)}
              >
                {$remove.isPending ? "刪除中…" : "確定刪除"}
              </Button>
            </div>
          {/if}
        </article>
      {/snippet}

      {#if $rules.isError || $categories.isError}
        <p class="mt-4 text-sm text-destructive" role="alert">
          無法載入分類規則，請稍後再試。
        </p>
      {:else if $rules.isPending}
        <p class="mt-4 text-sm text-muted-foreground">載入規則中…</p>
      {:else if visibleRules.length === 0}
        <p
          class="mt-4 rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground"
        >
          {ruleSearch
            ? "找不到符合的規則。"
            : `尚無${targetLabels[selectedTarget]}自訂規則。`}
        </p>
      {:else if selectedTarget === "invoice_item"}
        <div class="mt-3 space-y-3">
          {#each invoiceRuleGroups as group (group.categoryId)}
            <details class="overflow-hidden rounded-xl border border-border">
              <summary
                class="flex cursor-pointer list-none items-center justify-between gap-3 bg-muted/40 px-3 py-3 font-semibold"
              >
                <span class="min-w-0 truncate">{group.label}</span>
                <Badge variant="secondary">{group.rules.length} 條條件</Badge>
              </summary>
              <div class="divide-y divide-border border-t border-border">
                {#each group.rules as rule (rule.id)}
                  {@render renderInvoiceRule(rule)}
                {/each}
              </div>
            </details>
          {/each}
        </div>
      {:else}
        <div
          class="mt-3 divide-y divide-border rounded-xl border border-border"
        >
          {#each visibleRules as rule (rule.id)}
            {@const position = targetRules.findIndex(
              (row) => row.id === rule.id,
            )}
            {@const conflict = conflicts.get(rule.id)}
            {@const keywords =
              rule.operator === "regex"
                ? parseKeywordAlternation(rule.pattern)
                : null}
            <article class={`p-2 sm:p-3 ${rule.enabled ? "" : "opacity-60"}`}>
              <div class="flex min-w-0 items-start gap-3">
                <Checkbox
                  aria-label={`${rule.enabled ? "停用" : "啟用"}${categoryLabel(rule.categoryId)}規則`}
                  class="mt-0.5"
                  checked={rule.enabled}
                  disabled={$toggle.isPending}
                  onchange={(event: Event) =>
                    $toggle.mutate({
                      id: rule.id,
                      enabled: (event.currentTarget as HTMLInputElement)
                        .checked,
                    })}
                />
                <div class="min-w-0 flex-1">
                  {#if keywords}
                    <details class="group">
                      <summary class="cursor-pointer list-none font-medium">
                        {keywords.length} 個關鍵字（任一符合）
                        <span
                          class="ml-1 text-xs font-normal text-muted-foreground underline"
                          >檢視</span
                        >
                      </summary>
                      <ul class="mt-2 flex flex-wrap gap-1.5">
                        {#each keywords as keyword (`${rule.id}:${keyword}`)}
                          <li
                            class="max-w-full break-words rounded bg-muted px-2 py-1 text-xs"
                          >
                            {keyword}
                          </li>
                        {/each}
                      </ul>
                    </details>
                  {:else}
                    <p class="break-words font-medium">{rule.pattern}</p>
                  {/if}
                  <div
                    class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <Badge variant="outline"
                      >{categoryLabel(rule.categoryId)}</Badge
                    >
                    <span>{operatorLabels[rule.operator] ?? rule.operator}</span
                    >
                    {#if !rule.targetType}<span>· 所有來源</span>{/if}
                    {#if !rule.enabled}<span>· 已停用</span>{/if}
                  </div>
                  {#if conflict}
                    <p class="mt-1 text-xs text-amber-800" role="status">
                      {conflict.kind === "different_category"
                        ? "分類衝突"
                        : "重複條件"}：
                      {conflict.winnerId === rule.id
                        ? "這條會優先套用"
                        : "前面的規則會先套用"}。
                    </p>
                  {/if}
                </div>
                <div class="flex shrink-0 items-center gap-0.5">
                  <Button
                    size="icon"
                    class="size-8"
                    variant="ghost"
                    aria-label={`將${ruleSummary(rule)}規則上移`}
                    title="上移"
                    disabled={Boolean(ruleSearch) ||
                      $reorder.isPending ||
                      position <= 0}
                    onclick={() => moveRule(rule.id, -1)}
                    ><ChevronUp class="size-4" /></Button
                  >
                  <Button
                    size="icon"
                    class="size-8"
                    variant="ghost"
                    aria-label={`將${ruleSummary(rule)}規則下移`}
                    title="下移"
                    disabled={Boolean(ruleSearch) ||
                      $reorder.isPending ||
                      position >= targetRules.length - 1}
                    onclick={() => moveRule(rule.id, 1)}
                    ><ChevronDown class="size-4" /></Button
                  >
                  <Button
                    size="icon"
                    class="size-8"
                    variant="ghost"
                    aria-label={`編輯${ruleSummary(rule)}規則`}
                    onclick={() => startEdit(rule)}
                  >
                    <Pencil class="size-4" />
                  </Button>
                  {#if deleteCandidate !== rule.id}
                    <Button
                      size="icon"
                      class="size-8 text-destructive"
                      variant="ghost"
                      aria-label={`刪除${ruleSummary(rule)}規則`}
                      disabled={$remove.isPending}
                      onclick={() => (deleteCandidate = rule.id)}
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  {/if}
                </div>
              </div>
              {#if deleteCandidate === rule.id}
                <div
                  class="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-2 text-xs"
                >
                  <span class="mr-auto text-destructive">確定刪除此規則？</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onclick={() => (deleteCandidate = null)}>取消</Button
                  >
                  <Button
                    size="sm"
                    variant="outline"
                    class="text-destructive"
                    disabled={$remove.isPending}
                    onclick={() => $remove.mutate(rule.id)}
                  >
                    {$remove.isPending ? "刪除中…" : "確定刪除"}
                  </Button>
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </div>

    {#if $toggle.isError || $remove.isError || $reorder.isError}
      <p class="mt-3 text-sm text-destructive" role="alert">
        {messageFromError($toggle.error ?? $remove.error ?? $reorder.error)}
      </p>
    {/if}

    <details class="mt-6 rounded-lg border border-border p-4">
      <summary class="cursor-pointer text-sm font-semibold"
        >內建規則與配對說明（{systemRules.length} 條）</summary
      >
      <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
        內建規則不可編輯；自訂規則優先。發票是資料來源，消費分類依品項；信用卡繳款屬資產移轉，不算新消費。
      </p>
      <div class="mt-3 divide-y divide-border">
        {#each systemRules as rule (rule.id)}
          <details class="py-2 text-sm">
            <summary class="cursor-pointer break-words">
              {categoryLabel(rule.categoryId)} · {rule.description ??
                "內建比對"}
            </summary>
            <code class="mt-2 block break-all rounded bg-muted p-2 text-xs"
              >{rule.pattern}</code
            >
          </details>
        {/each}
      </div>
    </details>
  </CardContent>
</Card>
