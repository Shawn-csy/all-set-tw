<script lang="ts">
  import { onMount } from "svelte";
  import { Ellipsis, Eye, EyeOff } from "@lucide/svelte";
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import Overview from "@/features/overview/OverviewPage.svelte";
  import type { ConnectorId } from "@/data/connectors/types";
  import { createApiClient } from "@/shared/api/client";
  import { swipeBack } from "@/shared/actions/swipe-back";
  import { moneyState } from "@/shared/state/money-visibility.svelte";
  import Button from "@/shared/ui/Button.svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import Icon from "@/shared/ui/Icon.svelte";
  import {
    detailLabels,
    mobilePrimaryViews,
    mobileSettingsLabels,
    navItems,
    workspaceTabs,
  } from "./navigation-config";
  import { parseViewHash, viewHash } from "./navigation";
  import { queryClient } from "./query-client";
  import type {
    DetailView,
    MobileSettingsView,
    PrimaryView,
    RuntimeInfo,
    View,
  } from "./types";
  import "../styles.css";

  type LazyView = Exclude<View, "overview">;
  type PageKey =
    | "assets"
    | "activity"
    | "investments"
    | "manual-assets"
    | "purchases"
    | "investment-returns"
    | "activity-analysis"
    | "settings";
  type LazyPageModule =
    | typeof import("@/features/assets/AssetsPage.svelte")
    | typeof import("@/features/activity/ActivityPage.svelte")
    | typeof import("@/features/assets/Investments.svelte")
    | typeof import("@/features/assets/ManualAssets.svelte")
    | typeof import("@/features/purchases/PurchasesPage.svelte")
    | typeof import("@/features/investment-returns/InvestmentReturnsPage.svelte")
    | typeof import("@/features/activity/ActivityAnalysisPage.svelte")
    | typeof import("@/features/settings/SettingsPage.svelte");

  const pageLoaders = {
    assets: () => import("@/features/assets/AssetsPage.svelte"),
    activity: () => import("@/features/activity/ActivityPage.svelte"),
    investments: () => import("@/features/assets/Investments.svelte"),
    "manual-assets": () => import("@/features/assets/ManualAssets.svelte"),
    purchases: () => import("@/features/purchases/PurchasesPage.svelte"),
    "investment-returns": () =>
      import("@/features/investment-returns/InvestmentReturnsPage.svelte"),
    "activity-analysis": () =>
      import("@/features/activity/ActivityAnalysisPage.svelte"),
    settings: () => import("@/features/settings/SettingsPage.svelte"),
  } satisfies Record<PageKey, () => Promise<LazyPageModule>>;
  const pagePromises: Partial<Record<PageKey, Promise<LazyPageModule>>> = {};

  const api = createApiClient();
  let view = $state<View>("overview");
  let connectorTarget = $state<ConnectorId | null>(null);
  let runtime = $state<RuntimeInfo>({ demoMode: false });
  const isDetail = (v: View): v is DetailView => Object.hasOwn(detailLabels, v);
  const isMobileSetting = (v: View): v is MobileSettingsView =>
    Object.hasOwn(mobileSettingsLabels, v);
  const primaryView = $derived(
    view === "more" || isMobileSetting(view)
      ? "settings"
      : isDetail(view)
        ? view === "purchases" || view === "activity-analysis"
          ? "activity"
          : "assets"
        : (view as PrimaryView),
  );
  const currentView = $derived(
    navItems.find((item) => item.view === primaryView) ?? navItems[0]!,
  );
  const detail = $derived(isDetail(view) ? detailLabels[view] : undefined);
  const mobileSetting = $derived(
    isMobileSetting(view) ? mobileSettingsLabels[view] : undefined,
  );
  const activeWorkspaceTabs = $derived(
    view === "more" ? [] : (workspaceTabs[primaryView] ?? []),
  );

  function pageKey(next: LazyView): PageKey {
    if (
      next === "assets" ||
      next === "activity" ||
      next === "investments" ||
      next === "manual-assets" ||
      next === "purchases" ||
      next === "investment-returns" ||
      next === "activity-analysis"
    )
      return next;
    return "settings";
  }

  function getPagePromise(key: PageKey) {
    return (pagePromises[key] ??= pageLoaders[key]());
  }

  const pagePromise = $derived.by(() => {
    if (view === "overview") return Promise.resolve(undefined);
    return getPagePromise(pageKey(view as LazyView));
  });

  function retryPage() {
    window.location.reload();
  }

  const isStandalone = () =>
    document.documentElement.classList.contains("is-standalone");
  function scrollToTop() {
    const options: ScrollToOptions = { top: 0, behavior: "smooth" };
    if (isStandalone()) document.getElementById("root")?.scrollTo(options);
    else window.scrollTo(options);
  }

  onMount(() => {
    const routeView = parseViewHash(window.location.hash);
    if (routeView) view = routeView;
    else
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}${viewHash(view)}`,
      );

    const handleHashChange = () => {
      const next = parseViewHash(window.location.hash);
      if (next) {
        view = next;
        scrollToTop();
      }
    };
    window.addEventListener("hashchange", handleHashChange);

    void api
      .get<RuntimeInfo>("/api/runtime")
      .then((info) => (runtime = info))
      .catch(() => (runtime = { demoMode: false }));
    moneyState.hidden =
      localStorage.getItem("taiwan-fin-hub-money-hidden") === "true";
    return () => window.removeEventListener("hashchange", handleHashChange);
  });
  function navigate(next: View, targetConnector?: ConnectorId) {
    view = next;
    connectorTarget =
      next === "data-sources" ? (targetConnector ?? null) : null;
    const nextHash = viewHash(next);
    if (window.location.hash !== nextHash) {
      if (isStandalone()) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}${nextHash}`,
        );
      } else {
        window.location.hash = nextHash;
      }
    }
    scrollToTop();
  }
  function navigateBack() {
    if (isDetail(view))
      navigate(
        view === "purchases" || view === "activity-analysis"
          ? "activity"
          : "assets",
      );
    else if (isMobileSetting(view)) navigate("more");
  }
  function toggleMoneyVisibility() {
    moneyState.hidden = !moneyState.hidden;
    localStorage.setItem(
      "taiwan-fin-hub-money-hidden",
      String(moneyState.hidden),
    );
  }
</script>

<QueryClientProvider client={queryClient}>
  <div
    class="min-h-screen bg-paper text-ink xl:grid xl:grid-cols-[240px_minmax(0,1fr)]"
    use:swipeBack={{
      enabled: isStandalone() && (isDetail(view) || isMobileSetting(view)),
      onBack: navigateBack,
    }}
  >
    <aside
      class="hidden border-r border-white/10 bg-ink px-5 py-5 text-white xl:sticky xl:top-0 xl:flex xl:h-screen xl:flex-col"
    >
      <div class="px-2">
        <h1 class="text-xl font-semibold tracking-normal">不用記帳</h1>
        <p
          class="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-steel/90"
        >
          ALL SET
        </p>
      </div>
      <nav class="mt-7 grid gap-1" aria-label="主要工作區">
        {#each navItems as item (item.view)}
          {@const NavIcon = item.icon}
          <button
            class={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition ${primaryView === item.view ? "bg-white/12 text-white" : "text-white/65 hover:bg-white/5 hover:text-white"}`}
            aria-current={primaryView === item.view ? "page" : undefined}
            onclick={() => navigate(item.view)}
          >
            <NavIcon class="size-[21px] shrink-0 stroke-[1.8]" />{item.label}
          </button>
        {/each}
      </nav>
    </aside>

    <div class="min-w-0 pb-20">
      <div
        class="no-scrollbar hidden border-b border-ink/10 bg-paper px-4 py-2 md:flex md:gap-1 md:overflow-x-auto xl:hidden"
      >
        {#each navItems as item (item.view)}
          {@const NavIcon = item.icon}
          <button
            class={`flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium ${primaryView === item.view ? "bg-ink text-white" : "text-subtle hover:bg-ink/5"}`}
            onclick={() => navigate(item.view)}
            ><NavIcon class="size-4" />{item.label}</button
          >
        {/each}
      </div>
      <header
        class="sticky top-0 z-20 border-b border-ink/10 bg-paper/95 backdrop-blur-sm xl:static xl:bg-transparent xl:backdrop-blur-0"
      >
        <div
          class="mx-auto flex max-w-[1600px] flex-col px-4 py-2 sm:px-6 xl:px-8 xl:py-3"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              {#if mobileSetting}
                <div class="flex items-center gap-2 md:block">
                  <button
                    aria-label="返回更多"
                    class="flex size-10 shrink-0 items-center justify-center rounded-full text-xl text-ink hover:bg-ink/5 md:hidden"
                    onclick={() => navigate("more")}>←</button
                  >
                  <h1
                    class="truncate text-xl font-semibold tracking-tight xl:text-2xl"
                  >
                    <span class="md:hidden">{mobileSetting.label}</span>
                    <span class="hidden md:inline"
                      >設定 / {mobileSetting.label}</span
                    >
                  </h1>
                </div>
              {:else}
                {#if detail && view !== "activity-analysis"}<button
                    class="mb-1 inline-flex items-center gap-1 text-xs font-medium text-steel xl:hidden"
                    onclick={() =>
                      navigate(view === "purchases" ? "activity" : "assets")}
                    >← 返回{view === "purchases" ? "帳務" : "資產"}</button
                  >
                  <p class="mb-1 hidden text-caption text-subtle xl:block">
                    {detail.label}
                  </p>{/if}
                <h1
                  class="truncate text-xl font-semibold tracking-tight xl:text-2xl"
                >
                  <span class="md:hidden"
                    >{view === "more"
                      ? "更多"
                      : (detail?.label ??
                        currentView.pageTitle ??
                        currentView.label)}</span
                  ><span class="hidden md:inline"
                    >{currentView.pageTitle ?? currentView.label}</span
                  >
                </h1>
              {/if}
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button
                class={mobileSetting
                  ? "hidden rounded-full md:inline-flex"
                  : "rounded-full"}
                aria-label={moneyState.hidden ? "顯示金額" : "隱藏金額"}
                onclick={toggleMoneyVisibility}
                size="icon"
                variant="secondary"
                ><Icon
                  icon={moneyState.hidden ? Eye : EyeOff}
                  size="lg"
                /></Button
              >
            </div>
          </div>
        </div>
      </header>

      {#if activeWorkspaceTabs.length > 1}
        <div
          class="no-scrollbar overflow-x-auto border-b border-ink/10 bg-paper"
        >
          <nav
            class="mx-auto flex max-w-[1600px] gap-1 px-4 sm:px-6 xl:px-8"
            aria-label={`${currentView.label}分頁`}
          >
            {#each activeWorkspaceTabs as tab (tab.view)}
              <button
                class={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold transition ${view === tab.view ? "border-steel text-steel" : "border-transparent text-subtle hover:border-ink/20 hover:text-ink"}`}
                aria-current={view === tab.view ? "page" : undefined}
                onclick={() => navigate(tab.view)}>{tab.label}</button
              >
            {/each}
          </nav>
        </div>
      {/if}

      <main
        class="mx-auto max-w-[1600px] px-4 pb-4 pt-0 sm:px-6 md:py-4 xl:px-8 xl:py-5"
      >
        {#if view === "overview"}
          <Overview {api} {navigate} />
        {:else}
          {#await pagePromise}
            <EmptyState title="載入頁面中" body="正在準備內容。" />
          {:then module}
            {#if module}
              {#if view === "assets"}
                {@const Page =
                  module.default as typeof import("@/features/assets/AssetsPage.svelte").default}
                <Page {api} />
              {:else if view === "activity"}
                {@const Page =
                  module.default as typeof import("@/features/activity/ActivityPage.svelte").default}
                <Page {api} />
              {:else if view === "investments"}
                {@const Page =
                  module.default as typeof import("@/features/assets/Investments.svelte").default}
                <Page {api} />
              {:else if view === "manual-assets"}
                {@const Page =
                  module.default as typeof import("@/features/assets/ManualAssets.svelte").default}
                <Page {api} />
              {:else if view === "purchases"}
                {@const Page =
                  module.default as typeof import("@/features/purchases/PurchasesPage.svelte").default}
                <Page {api} />
              {:else if view === "investment-returns"}
                {@const Page =
                  module.default as typeof import("@/features/investment-returns/InvestmentReturnsPage.svelte").default}
                <Page {api} />
              {:else if view === "activity-analysis"}
                {@const Page =
                  module.default as typeof import("@/features/activity/ActivityAnalysisPage.svelte").default}
                <Page {api} />
              {:else}
                {@const Page =
                  module.default as typeof import("@/features/settings/SettingsPage.svelte").default}
                <Page
                  {api}
                  demoMode={runtime.demoMode}
                  {connectorTarget}
                  mobileView={view === "more"
                    ? "more"
                    : isMobileSetting(view)
                      ? view
                      : undefined}
                  {navigate}
                />
              {/if}
            {/if}
          {:catch}
            <section class="min-w-0 py-10" role="alert" aria-live="assertive">
              <h2 class="text-base font-semibold tracking-tight">
                頁面載入失敗
              </h2>
              <p class="mt-2 text-caption text-subtle">請再試一次。</p>
              <Button class="mt-5" variant="outline" onclick={retryPage}
                >重新載入</Button
              >
            </section>
          {/await}
        {/if}
      </main>
      <footer
        class="mx-auto hidden max-w-[1600px] border-t border-ink/8 px-4 py-4 sm:px-6 md:block xl:px-8"
      >
        <p class="text-xs text-ink/35">
          <strong class="font-medium text-ink/50">免責聲明：</strong>
          僅供個人研究；資料可能有延遲或誤差。
        </p>
      </footer>
    </div>

    <nav
      aria-label="主要導覽"
      class="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 gap-1 border-t border-ink/10 bg-ink px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 text-white shadow-[0_-8px_28px_rgba(31,41,51,0.12)] md:hidden"
    >
      {#each mobilePrimaryViews as mobileView (mobileView)}
        {@const item = navItems.find(
          (candidate) => candidate.view === mobileView,
        )!}{@const NavIcon = item.icon}
        <button
          class={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium transition ${primaryView === item.view ? "bg-white/10 text-white" : "text-white/65"}`}
          onclick={() => navigate(item.view)}
          ><NavIcon class="size-5" />{item.shortLabel}</button
        >
      {/each}
      <button
        class={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium transition ${view === "more" || !mobilePrimaryViews.includes(primaryView) ? "bg-white/10 text-white" : "text-white/65"}`}
        onclick={() => navigate("more")}><Ellipsis class="size-5" />更多</button
      >
    </nav>
  </div>
</QueryClientProvider>
