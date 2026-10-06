<script lang="ts">
  import {
    ArrowRight,
    BarChart3,
    History,
    ShieldCheck,
    Sparkles,
    Wallet,
  } from "@lucide/svelte";

  const summary = [
    { label: "本月收入", value: "NT$ 128,000", tone: "text-steel" },
    { label: "本月支出", value: "NT$ 64,820", tone: "text-coral" },
    { label: "淨資產", value: "NT$ 3.86M", tone: "text-moss" },
  ];

  const activities = [
    {
      name: "薪資入帳",
      category: "收入",
      amount: "+ NT$ 128,000",
      positive: true,
    },
    {
      name: "投資扣款",
      category: "資產轉移",
      amount: "− NT$ 50,000",
      positive: false,
    },
    {
      name: "家庭用品",
      category: "日常支出",
      amount: "− NT$ 2,480",
      positive: false,
    },
  ];

  const features = [
    {
      icon: BarChart3,
      eyebrow: "SEE THE FLOW",
      title: "看懂每一筆錢的流向",
      description:
        "把銀行、信用卡、投資與發票放進同一條時間軸，收入、支出與資產轉移不再混在一起。",
    },
    {
      icon: Wallet,
      eyebrow: "KNOW YOUR ASSETS",
      title: "掌握真正的資產狀態",
      description:
        "整合現金、存款、投資與其他資產，補上成本與報價後，看見更接近真實的淨資產。",
    },
    {
      icon: Sparkles,
      eyebrow: "ANALYZE WITH AI",
      title: "把資料交給 AI 分析",
      description:
        "依日期匯出經過整理與去識別化的財務 JSON，交給 ChatGPT 或其他 AI 找出消費與投資脈絡。",
    },
  ];

  const chartBars = [42, 56, 48, 68, 52, 76, 64, 88, 72, 94, 82, 100];
</script>

<svelte:head>
  <title>不用記帳 Demo | ALL SET</title>
  <meta
    name="description"
    content="不用記帳的互動展示頁：集中管理收入、支出、資產與投資。"
  />
</svelte:head>

<div class="min-h-screen overflow-hidden bg-paper text-ink">
  <header
    class="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10"
  >
    <a href="/" class="flex items-center gap-3" aria-label="返回不用記帳首頁">
      <span
        class="flex size-10 items-center justify-center rounded-xl bg-ink text-white shadow-sm"
      >
        <Wallet class="size-5" />
      </span>
      <span>
        <span class="block text-sm font-semibold tracking-tight">不用記帳</span>
        <span
          class="block text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle"
          >ALL SET</span
        >
      </span>
    </a>

    <nav
      class="hidden items-center gap-7 text-sm text-subtle md:flex"
      aria-label="Demo 導覽"
    >
      <a class="transition-colors hover:text-ink" href="#demo-features">功能</a>
      <a class="transition-colors hover:text-ink" href="#demo-flow">使用方式</a>
      <a class="transition-colors hover:text-ink" href="#demo-safe">資料安全</a>
    </nav>

    <a
      href="/"
      class="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-white shadow-sm transition-transform hover:-translate-y-0.5"
    >
      開始操作 Demo
      <ArrowRight class="size-4" />
    </a>
  </header>

  <main>
    <section
      class="relative mx-auto grid max-w-7xl gap-14 px-5 pb-20 pt-12 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-10 lg:pb-28 lg:pt-20"
    >
      <div
        class="pointer-events-none absolute -left-32 top-0 size-80 rounded-full bg-steel/10 blur-3xl"
        aria-hidden="true"
      ></div>
      <div class="relative">
        <p
          class="mb-5 text-xs font-semibold uppercase tracking-[0.24em] text-steel"
        >
          Personal finance, without the spreadsheet
        </p>
        <h1
          class="max-w-xl text-5xl font-semibold leading-[1.05] tracking-[-0.055em] sm:text-6xl lg:text-7xl"
        >
          讓每一筆錢，<span class="text-steel">都有去處。</span>
        </h1>
        <p class="mt-7 max-w-lg text-base leading-8 text-subtle sm:text-lg">
          不用記帳把分散在銀行、信用卡、投資與發票裡的資料，整理成一個可以每天看懂的財務畫面。
        </p>
        <div class="mt-9 flex flex-wrap items-center gap-3">
          <a
            href="/"
            class="inline-flex h-12 items-center gap-2 rounded-full bg-steel px-6 text-sm font-semibold text-white shadow-lg shadow-steel/15 transition-transform hover:-translate-y-0.5"
          >
            開始瀏覽 Demo
            <ArrowRight class="size-4" />
          </a>
          <a
            href="#demo-features"
            class="inline-flex h-12 items-center rounded-full px-5 text-sm font-medium text-subtle transition-colors hover:bg-ink/5 hover:text-ink"
          >
            先看看功能
          </a>
        </div>
        <div class="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-xs text-subtle">
          <span class="inline-flex items-center gap-2"
            ><ShieldCheck class="size-4 text-moss" />展示資料皆為虛構</span
          >
          <span class="inline-flex items-center gap-2"
            ><History class="size-4 text-steel" />支援完整時間軸</span
          >
        </div>
      </div>

      <div class="relative mx-auto w-full max-w-2xl lg:ml-auto">
        <div
          class="absolute -right-8 -top-8 size-28 rounded-full border border-steel/15 bg-steel/5"
          aria-hidden="true"
        ></div>
        <div
          class="absolute -bottom-10 -left-8 size-40 rounded-full border border-moss/15 bg-moss/5"
          aria-hidden="true"
        ></div>
        <div
          class="relative rounded-[2rem] border border-ink/10 bg-white/75 p-3 shadow-[0_28px_80px_rgba(31,41,51,0.14)] backdrop-blur-sm sm:p-5"
        >
          <div class="rounded-[1.45rem] bg-ink p-5 text-white sm:p-7">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-xs font-medium text-white/55">財務概況 · Demo</p>
                <p
                  class="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
                >
                  NT$ 3,864,820
                </p>
                <p
                  class="mt-2 inline-flex items-center gap-1.5 text-xs text-moss-200"
                >
                  <span class="size-1.5 rounded-full bg-[#a7c77b]"
                  ></span>淨資產較上月增加 4.8%
                </p>
              </div>
              <div
                class="rounded-full border border-white/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55"
              >
                Overview
              </div>
            </div>

            <div class="mt-8 grid grid-cols-3 gap-2 sm:gap-3">
              {#each summary as item}
                <div class="rounded-xl bg-white/8 p-3">
                  <p class="text-[10px] text-white/50">{item.label}</p>
                  <p
                    class={`mt-2 text-sm font-semibold ${item.tone === "text-coral" ? "text-[#e59b84]" : item.tone === "text-moss" ? "text-[#b5d18c]" : "text-[#a8d4db]"}`}
                  >
                    {item.value}
                  </p>
                </div>
              {/each}
            </div>

            <div class="mt-5 rounded-2xl bg-white/6 p-4">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-xs font-medium text-white/75">資產變化</p>
                  <p class="mt-1 text-[10px] text-white/45">過去 12 個月</p>
                </div>
                <BarChart3 class="size-4 text-white/45" />
              </div>
              <div class="mt-5 flex h-24 items-end gap-1.5 sm:gap-2">
                {#each chartBars as height, index}
                  <div class="flex h-full flex-1 items-end">
                    <div
                      class={`w-full rounded-t-sm ${index === chartBars.length - 1 ? "bg-[#a8d4db]" : "bg-white/25"}`}
                      style={`height: ${height}%`}
                    ></div>
                  </div>
                {/each}
              </div>
              <div class="mt-2 flex justify-between text-[9px] text-white/35">
                <span>07 月</span><span>現在</span>
              </div>
            </div>
          </div>

          <div class="mt-3 grid gap-3 sm:grid-cols-[1.1fr_0.9fr]">
            <div class="rounded-2xl border border-ink/8 bg-paper p-4">
              <div class="flex items-center justify-between">
                <p class="text-xs font-semibold">最近活動</p>
                <span class="text-[10px] text-subtle">今天</span>
              </div>
              <div class="mt-3 space-y-2">
                {#each activities as activity}
                  <div
                    class="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2.5"
                  >
                    <div class="min-w-0">
                      <p class="truncate text-xs font-medium">
                        {activity.name}
                      </p>
                      <p class="mt-0.5 text-[10px] text-subtle">
                        {activity.category}
                      </p>
                    </div>
                    <span
                      class={`shrink-0 text-xs font-semibold ${activity.positive ? "text-moss" : "text-ink"}`}
                      >{activity.amount}</span
                    >
                  </div>
                {/each}
              </div>
            </div>
            <div
              class="flex flex-col justify-between rounded-2xl bg-[#e8eee2] p-4"
            >
              <div>
                <p class="text-xs font-semibold text-moss">本月提醒</p>
                <p class="mt-2 text-sm font-medium leading-6 text-ink">
                  固定支出與投資扣款，已經幫你整理好了。
                </p>
              </div>
              <a
                href="#demo-features"
                class="mt-6 inline-flex items-center gap-1 text-xs font-semibold text-moss"
                >探索分析功能 <ArrowRight class="size-3.5" /></a
              >
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="demo-features" class="border-y border-ink/8 bg-white/45">
      <div class="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-24">
        <div class="max-w-2xl">
          <p
            class="text-xs font-semibold uppercase tracking-[0.24em] text-steel"
          >
            One calm view
          </p>
          <h2
            class="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl"
          >
            從「記錄」走到「理解」。
          </h2>
          <p class="mt-4 text-base leading-7 text-subtle">
            不是再多一個報表，而是一個能幫你把零散資料串起來的財務工作區。
          </p>
        </div>
        <div class="mt-12 grid gap-4 lg:grid-cols-3">
          {#each features as feature}
            {@const FeatureIcon = feature.icon}
            <article
              class="rounded-2xl border border-ink/8 bg-paper p-6 transition-transform hover:-translate-y-1"
            >
              <div
                class="flex size-11 items-center justify-center rounded-xl bg-ink text-white"
              >
                <FeatureIcon class="size-5" />
              </div>
              <p
                class="mt-8 text-[10px] font-semibold uppercase tracking-[0.22em] text-steel"
              >
                {feature.eyebrow}
              </p>
              <h3 class="mt-3 text-xl font-semibold tracking-tight">
                {feature.title}
              </h3>
              <p class="mt-3 text-sm leading-7 text-subtle">
                {feature.description}
              </p>
            </article>
          {/each}
        </div>
      </div>
    </section>

    <section
      id="demo-flow"
      class="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:px-10 lg:py-28"
    >
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-steel">
          A simpler rhythm
        </p>
        <h2 class="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
          每天三分鐘，知道錢去哪裡。
        </h2>
        <p class="mt-5 max-w-md text-base leading-7 text-subtle">
          資料同步是背景工作，真正留給你的，是一個可以快速做決定的畫面。
        </p>
      </div>
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-2xl bg-ink p-5 text-white sm:translate-y-5">
          <span class="text-3xl font-semibold text-[#a8d4db]">01</span>
          <p class="mt-10 text-sm font-semibold">接上資料</p>
          <p class="mt-2 text-xs leading-6 text-white/55">
            連接銀行、信用卡、投資與電子發票。
          </p>
        </div>
        <div class="rounded-2xl bg-[#e8eee2] p-5 sm:-translate-y-2">
          <span class="text-3xl font-semibold text-moss">02</span>
          <p class="mt-10 text-sm font-semibold">自動整理</p>
          <p class="mt-2 text-xs leading-6 text-subtle">
            分類、配對與資產轉移交給系統處理。
          </p>
        </div>
        <div class="rounded-2xl bg-[#e9eef2] p-5 sm:translate-y-8">
          <span class="text-3xl font-semibold text-steel">03</span>
          <p class="mt-10 text-sm font-semibold">看懂變化</p>
          <p class="mt-2 text-xs leading-6 text-subtle">
            從時間軸、分析與持倉找到下一步。
          </p>
        </div>
      </div>
    </section>

    <section id="demo-safe" class="bg-ink text-white">
      <div
        class="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-16 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10"
      >
        <div class="max-w-2xl">
          <p
            class="text-xs font-semibold uppercase tracking-[0.24em] text-[#a8d4db]"
          >
            Private by design
          </p>
          <h2
            class="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl"
          >
            先看懂，再決定要不要連線。
          </h2>
          <p class="mt-4 text-sm leading-7 text-white/60">
            這個展示頁只使用虛構資料。正式使用時，連接器設定會加密保存，並可選擇地端優先、雲端備份的部署方式。
          </p>
        </div>
        <a
          href="/"
          class="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-ink transition-transform hover:-translate-y-0.5"
          >開始操作 Demo <ArrowRight class="size-4" /></a
        >
      </div>
    </section>
  </main>

  <footer
    class="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-8 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10"
  >
    <p>不用記帳 · ALL SET</p>
    <p>本頁為產品展示用途，所有數字皆為虛構資料。</p>
  </footer>
</div>
