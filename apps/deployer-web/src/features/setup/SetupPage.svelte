<script lang="ts">
  import {
    createInstallation,
    fetchAccounts,
    runPrecheck,
    selectAccount,
  } from "@/data/deployer";
  import type {
    AuthSession,
    CloudflareAccount,
    Installation,
    PrecheckResult,
  } from "@/data/types";
  import { ApiRequestError } from "@/shared/api/client";
  import { checkLabels, precheckSummary } from "./model/precheck";

  let { session }: { session: AuthSession } = $props();

  let accounts = $state<CloudflareAccount[]>([]);
  let accountId = $state("");
  let workerName = $state("taiwan-fin-hub");
  let allowedEmail = $state("");
  let loadError = $state("");
  let actionError = $state("");
  let precheck = $state<PrecheckResult | null>(null);
  let installation = $state<Installation | null>(null);
  let jobStatus = $state("");
  let busy = $state(false);

  const summary = $derived(precheck ? precheckSummary(precheck.checks) : null);

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

  async function onRecordInstallation() {
    actionError = "";
    busy = true;
    try {
      const result = await createInstallation({
        accountId,
        workerName,
        allowedEmail,
        targetVersion: "dev-local",
        targetDigest: "0".repeat(64),
      });
      installation = result.installation;
      jobStatus = `${result.job.status} / ${result.job.step}`;
      if (!result.writesEnabled) {
        actionError =
          "已建立安裝紀錄與工作，但尚未對你的帳戶寫入 Cloudflare 資源。";
      }
    } catch (error) {
      actionError =
        error instanceof ApiRequestError ? error.message : "無法建立安裝紀錄。";
    } finally {
      busy = false;
    }
  }

  void loadAccounts();
</script>

<section class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
  <header class="flex flex-col gap-2">
    <p class="text-sm font-medium text-steel">授權完成</p>
    <h1 class="text-2xl font-semibold">選擇帳戶並執行預檢</h1>
    <p class="text-sm leading-6 text-ink/75">
      只會列出此次 Cloudflare 授權實際能管理的帳戶。缺少 workers.dev 或 Zero
      Trust 時，請用下方連結到 Dashboard 完成後再回來續做。
    </p>
  </header>

  {#if loadError}
    <p class="text-sm text-red-800">{loadError}</p>
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
      disabled={busy || !accountId || !allowedEmail}
      onclick={onRecordInstallation}
    >
      建立安裝紀錄
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

  {#if installation}
    <p class="text-sm leading-6">
      安裝 ID：{installation.id}。工作狀態：{jobStatus}。此階段不會建立
      D1、Access 或正式 Worker。
    </p>
  {/if}

  {#if actionError}
    <p class="text-sm leading-6 text-ink/80">{actionError}</p>
  {/if}
</section>
