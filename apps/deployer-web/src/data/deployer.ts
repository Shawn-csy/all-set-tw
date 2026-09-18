import { createApiClient, setCsrfToken } from "@/shared/api/client";
import type {
  AuthSession,
  AuthStatus,
  CloudflareAccount,
  Installation,
  PrecheckResult,
} from "./types";

const api = createApiClient();

export function fetchAuthStatus() {
  return api.get<AuthStatus>("/api/auth/status");
}

export async function fetchSession() {
  const session = await api.get<AuthSession>("/api/auth/me");
  setCsrfToken(session.csrfToken);
  return session;
}

export function fetchAccounts() {
  return api.get<{ accounts: CloudflareAccount[] }>("/api/auth/accounts");
}

export function selectAccount(accountId: string) {
  return api.post<{ selectedAccountId: string }>("/api/auth/select-account", {
    accountId,
  });
}

export function runPrecheck(input: { accountId: string; workerName: string }) {
  return api.post<PrecheckResult>("/api/precheck", input);
}

export function createInstallation(input: {
  accountId: string;
  workerName: string;
  allowedEmail: string;
  targetVersion: string;
  targetDigest: string;
}) {
  return api.post<{
    installation: Installation;
    job: { id: string; status: string; step: string };
    reused: boolean;
    writesEnabled: boolean;
  }>("/api/installations", input);
}
