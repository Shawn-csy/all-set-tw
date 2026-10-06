<script lang="ts">
  import { ArrowRight, LockKeyhole, Sparkles, Wallet } from "@lucide/svelte";
</script>

<svelte:head>
  <title>不用記帳 | ALL SET</title>
  <meta
    name="description"
    content="不用記帳：集中查看收入、支出、資產與投資的個人財務工作區。"
  />
</svelte:head>

<div class="min-h-screen overflow-hidden bg-paper text-ink">
  <div
    class="pointer-events-none absolute -right-32 -top-40 size-[34rem] rounded-full bg-steel/10 blur-3xl"
    aria-hidden="true"
  ></div>
  <div
    class="pointer-events-none absolute -bottom-52 -left-40 size-[30rem] rounded-full bg-moss/10 blur-3xl"
    aria-hidden="true"
  ></div>

  <header
    class="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10"
  >
    <a href="/" class="flex items-center gap-3" aria-label="不用記帳首頁">
      <span
        class="flex size-10 items-center justify-center rounded-xl bg-ink text-white shadow-sm"
        ><Wallet class="size-5" /></span
      >
      <span>
        <span class="block text-sm font-semibold tracking-tight">不用記帳</span>
        <span
          class="block text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle"
          >ALL SET</span
        >
      </span>
    </a>
    <span class="hidden text-xs font-medium text-subtle sm:block"
      >個人財務工作區</span
    >
  </header>

  <main
    class="relative z-10 mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 lg:px-10 lg:pb-24 lg:pt-20"
  >
    <section class="grid gap-12 lg:grid-cols-[1fr_0.9fr] lg:items-center">
      <div class="max-w-2xl">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-steel">
          Welcome to ALL SET
        </p>
        <h1
          class="mt-5 text-5xl font-semibold leading-[1.04] tracking-[-0.06em] sm:text-6xl lg:text-7xl"
        >
          先選一個入口，<span class="text-steel">再開始看懂你的錢。</span>
        </h1>
        <p class="mt-7 max-w-xl text-base leading-8 text-subtle sm:text-lg">
          集中管理銀行、信用卡、投資與電子發票。正式環境保留原本的登入流程，也提供一份不碰真實資料的互動
          Demo。
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <a
          href="/#/overview"
          class="group rounded-[1.5rem] bg-ink p-6 text-white shadow-xl shadow-ink/15 transition-transform hover:-translate-y-1 sm:p-7"
        >
          <div class="flex items-start justify-between gap-4">
            <span
              class="flex size-11 items-center justify-center rounded-xl bg-white/10"
              ><LockKeyhole class="size-5 text-[#a8d4db]" /></span
            >
            <ArrowRight
              class="size-5 text-white/45 transition-transform group-hover:translate-x-1 group-hover:text-white"
            />
          </div>
          <p
            class="mt-9 text-xs font-semibold uppercase tracking-[0.2em] text-[#a8d4db]"
          >
            Private workspace
          </p>
          <h2 class="mt-2 text-xl font-semibold">登入正式系統</h2>
          <p class="mt-3 text-sm leading-6 text-white/60">
            使用既有的 Cloudflare Access 登入流程，查看你的真實資料。
          </p>
        </a>

        <a
          href="/#/demo"
          class="group rounded-[1.5rem] border border-ink/10 bg-white/80 p-6 shadow-lg shadow-ink/5 transition-transform hover:-translate-y-1 sm:p-7"
        >
          <div class="flex items-start justify-between gap-4">
            <span
              class="flex size-11 items-center justify-center rounded-xl bg-[#e8eee2]"
              ><Sparkles class="size-5 text-moss" /></span
            >
            <ArrowRight
              class="size-5 text-subtle/45 transition-transform group-hover:translate-x-1 group-hover:text-ink"
            />
          </div>
          <p
            class="mt-9 text-xs font-semibold uppercase tracking-[0.2em] text-moss"
          >
            Explore the product
          </p>
          <h2 class="mt-2 text-xl font-semibold">瀏覽互動 Demo</h2>
          <p class="mt-3 text-sm leading-6 text-subtle">
            使用虛構資料預覽總覽、帳務、資產與分析功能，不會修改任何正式資料。
          </p>
        </a>
      </div>
    </section>

    <section
      class="mt-20 border-t border-ink/10 pt-7 sm:mt-28 sm:flex sm:items-center sm:justify-between"
    >
      <p class="text-xs leading-6 text-subtle">
        Demo 資料為虛構內容；正式連線前，請先確認部署與資料庫設定。
      </p>
      <div class="mt-3 flex items-center gap-4 sm:mt-0">
        <a
          href="/#/demo"
          class="inline-flex items-center gap-1 text-xs font-semibold text-steel hover:underline"
          >先看看功能 <ArrowRight class="size-3.5" /></a
        >
        <a
          href="/#/demo/overview"
          class="inline-flex items-center gap-1 text-xs font-semibold text-moss hover:underline"
          >直接操作 Demo <ArrowRight class="size-3.5" /></a
        >
      </div>
    </section>
  </main>
</div>
