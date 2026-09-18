<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    createInstallation,
    fetchAccounts,
    fetchCurrentRelease,
    fetchInstallationJob,
    resumeInstallation,
    runPrecheck,
    selectAccount,
  } from "@/data/deployer";
  import type {
    AuthSession,
    CloudflareAccount,
    CurrentRelease,
    DeployJob,
    Installation,
    PrecheckResult,
  } from "@/data/types";
  import { ApiRequestError } from "@/shared/api/client";
  import { checkLabels, precheckSummary } from "./model/precheck";
  import ProgressPanel from "./components/ProgressPanel.svelte";

  let { session }: { session: AuthSession } = $props();

  let accounts = $state<CloudflareAccount[]>([]);
  let accountId = $state("");
  let workerName = $state("taiwan-fin-hub");
  let allowedEmail = $state("");
  let loadError = $state("");
  let actionError = $state("");
  let precheck = $state<PrecheckResult | null>(null);
  let release = $state<CurrentRelease | null>(null);
  let installation = $state<Installation | null>(null);
  let job = $state<DeployJob | null>(null);
  let busy = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const summary = $derived(precheck ? precheckSummary(precheck.checks) : null);

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      void refreshJob();
    }, 2000);
  }

  async function refreshJob() {
    if (!installation || !job) return;
    try {
      const result = await fetchInstallationJob(installation.id, job.id);
      installation = result.installation;
      job = result.job;
      if (
        result.job.status === "succeeded" ||
        result.job.status === "failed" ||
        result.job.status === "awaiting_reauth" ||
        result.job.status === "awaiting_release"
      ) {
        stopPolling();
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        stopPolling();
        actionError = "授權已過期，請重新授權後續跑。";
      }
    }
  }

  async function loadAccounts() {
    try {
      const result = await fetchAccounts();
      accounts = result.accounts;
      if (!accountId) {
        accountId = session.selectedAccountId ?? accounts[0]?.id ?? "";
      }
    } catch (error) {
      loadError = error instanceof Error ? error.message : "無法載入帳戶。";
    }
  }

  async function loadRelease() {
    try {
      release = await fetchCurrentRelease();
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === "RELEASE_UNAVAILABLE"
      ) {
        release = null;
        return;
      }
      actionError = error instanceof Error ? error.message : "無法載入版本。";
    }
  }

  async function onSelectAccount() {
    actionError = "";
    busy = true;
    try {
      await selectAccount(accountId);
    } catch (error) {
      actionError = error instanceof Error ? error.message : "無法選擇帳戶。";
    } finally {
      busy = false;
    }
  }

  async function onPrecheck() {
    actionError = "";
    busy = true;
    try {
      await onSelectAccount();
      precheck = await runPrecheck({ accountId, workerName });
    } catch (error) {
      actionError = error instanceof Error ? error.message : "預檢失敗。";
    } finally {
      busy = false;
    }
  }

  async function onCreateInstallation() {
    actionError = "";
    busy = true;
    try {
      const targetVersion = release?.version ?? "pending";
      const targetDigest = release?.digest ?? "0".repeat(64);
      const result = await createInstallation({
        accountId,
        workerName,
        allowedEmail,
        targetVersion,
        targetDigest,
      });
      installation = result.installation;
      job = result.job;
      if (
        result.job.status === "queued" ||
        result.job.status === "running" ||
        result.job.status === "awaiting_reauth" ||
        result.job.status === "awaiting_release"
      ) {
        startPolling();
      }
    } catch (error) {
      actionError =
        error instanceof ApiRequestError ? error.message : "無法建立安裝。";
    } finally {
      busy = false;
    }
  }

  async function onRetry() {
    if (!installation) return;
    actionError = "";
    busy = true;
    try {
      const result = await resumeInstallation(installation.id);
      installation = result.installation;
      job = result.job;
      startPolling();
    } catch (error) {
      actionError = error instanceof Error ? error.message : "無法續跑安裝。";
    } finally {
      busy = false;
    }
  }

  void loadAccounts();
  void loadRelease();
  onDestroy(stopPolling);
</script>

<section class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
  <header class="flex flex-col gap-2">
    <p class="text-sm font-medium text-steel">授權完成</p>
    <h1 class="text-2xl font-semibold">選擇帳戶並開始安裝</h1>
    <p class="text-sm leading-6 text-ink/75">
      只會列出此次 Cloudflare 授權實際能管理的帳戶。缺少 workers.dev 或 Zero
      Trust 時，請用下方連結到 Dashboard
      完成後再回來續做。沒有版本包時會停在可續跑狀態，不會寫入你的帳戶。
    </p>
  </header>

  {#if loadError}
    <p class="text-sm text-red-800">{loadError}</p>
  {/if}

  {#if release}
    <p class="text-sm leading-6 text-ink/75">
      目標版本：{release.version}（{release.source === "local_fixture"
        ? "本機測試包"
        : "維護者發布"}）
    </p>
  {:else}
    <p class="text-sm leading-6 text-ink/75">
      目前沒有可安裝的版本包。你仍可完成預檢，建立安裝後會等待發布。
    </p>
  {/if}

  <label class="flex flex-col gap-2 text-sm">
    Cloudflare 帳戶
    <select
      class="min-h-11 rounded-md border border-ink/15 bg-white px-3"
      bind:value={accountId}
    >
      {#each accounts as account}
        <option value={account.id}>{account.name}</option>
      {/each}
    </select>
  </label>

  <label class="flex flex-col gap-2 text-sm">
    Worker 名稱
    <input
      class="min-h-11 rounded-md border border-ink/15 bg-white px-3"
      bind:value={workerName}
    />
  </label>

  <label class="flex flex-col gap-2 text-sm">
    允許登入的 Email
    <input
      type="email"
      class="min-h-11 rounded-md border border-ink/15 bg-white px-3"
      bind:value={allowedEmail}
      placeholder="you@example.com"
    />
  </label>

  <div class="flex flex-wrap gap-3">
    <button
      type="button"
      class="min-h-11 rounded-md bg-ink px-4 text-sm font-medium text-white disabled:opacity-50"
      disabled={busy || !accountId}
      onclick={onPrecheck}
    >
      執行預檢
    </button>
    <button
      type="button"
      class="min-h-11 rounded-md border border-ink/20 px-4 text-sm font-medium disabled:opacity-50"
      disabled={busy || !accountId || !allowedEmail || !summary?.ready}
      onclick={onCreateInstallation}
    >
      建立我的不用記帳
    </button>
  </div>

  {#if summary}
    <ul class="flex flex-col gap-2">
      {#each precheck?.checks ?? [] as check}
        <li class="rounded-md border border-ink/10 bg-white px-3 py-2 text-sm">
          <span class="font-medium">{checkLabels[check.id]}</span>
          {check.ok ? "已通過" : "需要處理"}
          {#if !check.ok && check.dashboardUrl}
            <a class="ml-2 text-steel underline" href={check.dashboardUrl}
              >前往 Dashboard</a
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if installation && job}
    <ProgressPanel {installation} {job} {busy} {onRetry} />
  {/if}

  {#if actionError}
    <p class="text-sm leading-6 text-ink/80">{actionError}</p>
  {/if}
</section>
