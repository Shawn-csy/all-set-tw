export const INSTALL_PHASES = [
  {
    id: "prepare",
    label: "準備環境",
    steps: [
      "precheck",
      "load_release",
      "generate_keys",
      "create_d1",
      "create_queue",
      "deploy_bootstrap",
      "enable_workers_dev",
    ],
  },
  {
    id: "protect",
    label: "設定登入保護",
    steps: ["ensure_otp_idp", "create_access_app", "write_access_secrets"],
  },
  {
    id: "install",
    label: "安裝版本",
    steps: [
      "apply_migrations",
      "write_app_secrets",
      "upload_assets",
      "deploy_worker",
      "attach_queue_consumer",
      "attach_cron",
    ],
  },
  {
    id: "verify",
    label: "驗證完成",
    steps: ["verify_install", "finalize"],
  },
] as const;

export type JobProgress = {
  status: string;
  step: string;
  errorCode: string | null;
};

export type PhaseState = "pending" | "active" | "done" | "error";

export type PhaseId = (typeof INSTALL_PHASES)[number]["id"];

export function phaseState(
  phaseId: PhaseId,
  progress: JobProgress,
): PhaseState {
  const phase = INSTALL_PHASES.find((item) => item.id === phaseId);
  if (
    progress.status === "failed" &&
    phase &&
    (phase.steps as readonly string[]).includes(progress.step)
  ) {
    return "error";
  }
  if (progress.status === "succeeded") return "done";
  const currentIndex = INSTALL_PHASES.findIndex((phase) =>
    (phase.steps as readonly string[]).includes(progress.step),
  );
  const thisIndex = INSTALL_PHASES.findIndex((phase) => phase.id === phaseId);
  if (currentIndex < 0) return "pending";
  if (thisIndex < currentIndex) return "done";
  if (thisIndex > currentIndex) return "pending";
  return "active";
}

export function nextAction(errorCode: string | null) {
  switch (errorCode) {
    case "PRECHECK_INCOMPLETE":
      return "請先完成上方預檢列出的 Dashboard 步驟，再回來續跑。";
    case "RELEASE_UNAVAILABLE":
    case "RELEASE_DIGEST_MISMATCH":
      return "維護者尚未提供可安裝的版本包。版本發布後可直接續跑，不必重填資料。";
    case "TOKEN_EXPIRED":
      return "Cloudflare 授權已過期，請重新授權後續跑同一筆安裝。";
    case "RESOURCE_CONFLICT":
      return "目標帳戶已有同名資源。請更換 Worker 名稱，或確認那不是別人的安裝。";
    case "ACCESS_NOT_ENFORCED":
      return "網站還沒有套用登入保護，入口尚未開放。";
    case "TOO_MANY_ATTEMPTS":
      return "重試次數已達上限，請稍後再試或聯絡維護者。";
    default:
      return errorCode ? "安裝尚未完成。請依錯誤說明處理後按「重試」。" : "";
  }
}

export function publicSiteUrl(
  workerName: string,
  createdResources: Record<string, unknown>,
) {
  const subdomain = createdResources.workersSubdomain;
  if (typeof subdomain !== "string" || !subdomain) return null;
  return `https://${workerName}.${subdomain}.workers.dev/`;
}
