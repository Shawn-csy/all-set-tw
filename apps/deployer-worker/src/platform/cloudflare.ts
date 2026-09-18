export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

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

export class CloudflareApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code:
      "TOKEN_EXPIRED" | "FORBIDDEN" | "NOT_FOUND" | "UPSTREAM",
  ) {
    super("Cloudflare API request failed.");
    this.name = "CloudflareApiError";
  }
}

function mapStatus(status: number): CloudflareApiError["code"] {
  if (status === 401) return "TOKEN_EXPIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  return "UPSTREAM";
}

async function cfFetch(accessToken: string, path: string) {
  const response = await fetch(`${CLOUDFLARE_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok)
    throw new CloudflareApiError(response.status, mapStatus(response.status));
  return response.json() as Promise<{ success?: boolean; result?: unknown }>;
}

export async function listAuthorizedAccounts(
  accessToken: string,
): Promise<CloudflareAccount[]> {
  const body = await cfFetch(accessToken, "/memberships");
  const rows = Array.isArray(body.result) ? body.result : [];
  const accounts: CloudflareAccount[] = [];
  for (const row of rows) {
    const account = (row as { account?: { id?: string; name?: string } })
      .account;
    if (account?.id) {
      accounts.push({ id: account.id, name: account.name ?? account.id });
    }
  }
  return accounts;
}

export function workersDashboardUrl(accountId: string) {
  return `https://dash.cloudflare.com/${accountId}/workers-and-pages`;
}

export function zeroTrustDashboardUrl() {
  return "https://one.dash.cloudflare.com/";
}

export async function readWorkersSubdomain(
  accessToken: string,
  accountId: string,
) {
  try {
    const body = await cfFetch(
      accessToken,
      `/accounts/${accountId}/workers/subdomain`,
    );
    const result = body.result as { subdomain?: string } | undefined;
    return Boolean(result?.subdomain);
  } catch (error) {
    if (error instanceof CloudflareApiError && error.code === "NOT_FOUND") {
      return false;
    }
    throw error;
  }
}

export async function readAccessOrganization(
  accessToken: string,
  accountId: string,
) {
  try {
    const body = await cfFetch(
      accessToken,
      `/accounts/${accountId}/access/organizations`,
    );
    const result = body.result as { auth_domain?: string } | undefined;
    return Boolean(result?.auth_domain);
  } catch (error) {
    if (error instanceof CloudflareApiError && error.code === "NOT_FOUND") {
      return false;
    }
    throw error;
  }
}

export async function workerScriptExists(
  accessToken: string,
  accountId: string,
  workerName: string,
) {
  try {
    await cfFetch(
      accessToken,
      `/accounts/${accountId}/workers/scripts/${workerName}`,
    );
    return true;
  } catch (error) {
    if (error instanceof CloudflareApiError && error.code === "NOT_FOUND") {
      return false;
    }
    throw error;
  }
}

export async function runAccountPrecheck(input: {
  accessToken: string;
  accountId: string;
  workerName: string;
}): Promise<{ ready: boolean; checks: PrecheckItem[] }> {
  const [subdomain, organization, workerExists] = await Promise.all([
    readWorkersSubdomain(input.accessToken, input.accountId),
    readAccessOrganization(input.accessToken, input.accountId),
    workerScriptExists(input.accessToken, input.accountId, input.workerName),
  ]);
  const checks: PrecheckItem[] = [
    {
      id: "workers_subdomain",
      ok: subdomain,
      blocking: true,
      dashboardUrl: workersDashboardUrl(input.accountId),
    },
    {
      id: "access_organization",
      ok: organization,
      blocking: true,
      dashboardUrl: zeroTrustDashboardUrl(),
    },
    {
      id: "worker_name",
      ok: !workerExists,
      blocking: true,
      dashboardUrl: workersDashboardUrl(input.accountId),
    },
  ];
  return { ready: checks.every((check) => check.ok), checks };
}
