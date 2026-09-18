export type AuthStatus = {
  oauthConfigured: boolean;
  stage: {
    oauthLiveVerified: boolean;
    writesEnabled: boolean;
  };
};

export type AuthSession = {
  sub: string;
  selectedAccountId: string | null;
  tokenExpiresAt: string;
  csrfToken: string;
  expiresAt: string;
};

export type CloudflareAccount = {
  id: string;
  name: string;
};

export type PrecheckItem = {
  id: "workers_subdomain" | "access_organization" | "worker_name";
  ok: boolean;
  blocking: boolean;
  dashboardUrl?: string;
};

export type PrecheckResult = {
  accountId: string;
  workerName: string;
  ready: boolean;
  checks: PrecheckItem[];
};

export type Installation = {
  id: string;
  accountId: string;
  workerName: string;
  allowedEmail: string;
  status: string;
  targetVersion: string | null;
  targetDigest: string | null;
};

export type DeployJob = {
  id: string;
  installationId: string;
  kind: string;
  status: string;
  step: string;
  errorCode: string | null;
};
