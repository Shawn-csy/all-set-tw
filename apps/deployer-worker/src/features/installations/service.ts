import { randomToken } from "../../platform/crypto";
import type { Env, PublicSession } from "../../platform/env";
import { listAuthorizedAccounts } from "../../platform/cloudflare";
import { readAccessToken } from "../auth/service";
import { AccountNotAuthorizedError } from "../precheck/service";
import { enqueueDeployJob } from "../deployments/queue";
import {
  findActiveJob,
  getJobById,
  insertJob,
  listJobsForInstallation,
  updateJob,
} from "../deployments/repository";
import {
  getInstallationByAccountWorker,
  getInstallationById,
  insertInstallation,
  listInstallationsForOwnerAccount,
  type InstallationRow,
} from "./repository";

export class InstallationConflictError extends Error {
  constructor() {
    super("INSTALLATION_CONFLICT");
    this.name = "InstallationConflictError";
  }
}

export class InstallationNotFoundError extends Error {
  constructor() {
    super("INSTALLATION_NOT_FOUND");
    this.name = "InstallationNotFoundError";
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export function assertInstallInput(input: {
  workerName: string;
  allowedEmail: string;
  targetVersion: string;
  targetDigest: string;
}) {
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(input.workerName)) {
    throw new Error("INVALID_REQUEST");
  }
  if (
    !EMAIL_PATTERN.test(input.allowedEmail) ||
    input.allowedEmail.length > 254
  ) {
    throw new Error("INVALID_REQUEST");
  }
  if (!VERSION_PATTERN.test(input.targetVersion)) {
    throw new Error("INVALID_REQUEST");
  }
  if (!DIGEST_PATTERN.test(input.targetDigest)) {
    throw new Error("INVALID_REQUEST");
  }
}

export async function createOrReuseInstallation(
  env: Env,
  session: PublicSession,
  input: {
    accountId: string;
    workerName: string;
    allowedEmail: string;
    targetVersion: string;
    targetDigest: string;
  },
) {
  assertInstallInput(input);
  if (session.selectedAccountId !== input.accountId) {
    throw new AccountNotAuthorizedError();
  }
  const { accessToken } = await readAccessToken(env, session.id);
  const accounts = await listAuthorizedAccounts(accessToken);
  if (!accounts.some((account) => account.id === input.accountId)) {
    throw new AccountNotAuthorizedError();
  }

  const now = new Date().toISOString();
  const candidate: InstallationRow = {
    id: `inst_${randomToken(16)}`,
    ownerSub: session.oauthSub,
    accountId: input.accountId,
    workerName: input.workerName,
    allowedEmail: input.allowedEmail,
    status: "draft",
    targetVersion: input.targetVersion,
    targetDigest: input.targetDigest,
    workerScriptId: null,
    d1DatabaseId: null,
    queueId: null,
    accessAppId: null,
    createdAt: now,
    updatedAt: now,
  };
  await insertInstallation(env.DB, candidate);
  const installation = await getInstallationByAccountWorker(
    env.DB,
    input.accountId,
    input.workerName,
  );
  if (!installation) throw new Error("Failed to persist installation.");
  if (installation.ownerSub !== session.oauthSub) {
    throw new InstallationConflictError();
  }

  const job = await createOrReuseJob(env, installation.id, {
    kind: "install",
    targetVersion: input.targetVersion,
    targetDigest: input.targetDigest,
  });
  return { installation, job, reused: installation.id !== candidate.id };
}

export async function createOrReuseJob(
  env: Env,
  installationId: string,
  input: {
    kind: "install" | "update";
    targetVersion: string;
    targetDigest: string;
  },
) {
  const existing = await findActiveJob(env.DB, installationId);
  if (existing) {
    if (existing.status === "queued" || existing.status === "awaiting_reauth") {
      if (existing.status === "awaiting_reauth") {
        await updateJob(env.DB, existing.id, {
          status: "queued",
          errorCode: null,
          updatedAt: new Date().toISOString(),
        });
      }
      await enqueueDeployJob(env, existing.id);
    }
    const current = await getJobById(env.DB, existing.id);
    if (!current) throw new Error("Failed to persist deploy job.");
    return current;
  }
  const now = new Date().toISOString();
  const job = {
    id: `job_${randomToken(16)}`,
    installationId,
    kind: input.kind,
    status: "queued",
    step: "validate_authorization",
    targetVersion: input.targetVersion,
    targetDigest: input.targetDigest,
    attemptCount: 0,
    createdResources: "{}",
    createdAt: now,
    updatedAt: now,
  };
  await insertJob(env.DB, job);
  await enqueueDeployJob(env, job.id);
  const stored = await getJobById(env.DB, job.id);
  if (!stored) throw new Error("Failed to persist deploy job.");
  return stored;
}

export async function listOwnedInstallations(env: Env, session: PublicSession) {
  if (!session.selectedAccountId) throw new AccountNotAuthorizedError();
  const { accessToken } = await readAccessToken(env, session.id);
  const accounts = await listAuthorizedAccounts(accessToken);
  if (!accounts.some((account) => account.id === session.selectedAccountId)) {
    throw new AccountNotAuthorizedError();
  }
  return listInstallationsForOwnerAccount(
    env.DB,
    session.oauthSub,
    session.selectedAccountId,
  );
}

export async function getOwnedInstallation(
  env: Env,
  session: PublicSession,
  installationId: string,
) {
  const installation = await getInstallationById(env.DB, installationId);
  if (
    !installation ||
    installation.ownerSub !== session.oauthSub ||
    installation.accountId !== session.selectedAccountId
  ) {
    throw new InstallationNotFoundError();
  }
  const { accessToken } = await readAccessToken(env, session.id);
  const accounts = await listAuthorizedAccounts(accessToken);
  if (!accounts.some((account) => account.id === installation.accountId)) {
    throw new InstallationNotFoundError();
  }
  return installation;
}

export async function getOwnedInstallationJob(
  env: Env,
  session: PublicSession,
  installationId: string,
  jobId: string,
) {
  const installation = await getOwnedInstallation(env, session, installationId);
  const jobs = await listJobsForInstallation(env.DB, installation.id);
  const job = jobs.find((row) => row.id === jobId);
  if (!job) throw new InstallationNotFoundError();
  return { installation, job };
}

export async function resumeOwnedInstallation(
  env: Env,
  session: PublicSession,
  installationId: string,
) {
  const installation = await getOwnedInstallation(env, session, installationId);
  if (!installation.targetVersion || !installation.targetDigest) {
    throw new Error("INVALID_REQUEST");
  }
  const job = await createOrReuseJob(env, installation.id, {
    kind: "install",
    targetVersion: installation.targetVersion,
    targetDigest: installation.targetDigest,
  });
  return { installation, job };
}

export function toInstallationDto(row: InstallationRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    workerName: row.workerName,
    allowedEmail: row.allowedEmail,
    status: row.status,
    targetVersion: row.targetVersion,
    targetDigest: row.targetDigest,
  };
}

export function toJobDto(row: {
  id: string;
  installationId: string;
  kind: string;
  status: string;
  step: string;
  targetVersion: string;
  targetDigest: string;
  attemptCount: number;
  createdResources: string;
  errorCode: string | null;
  migrationName: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: row.id,
    installationId: row.installationId,
    kind: row.kind,
    status: row.status,
    step: row.step,
    targetVersion: row.targetVersion,
    targetDigest: row.targetDigest,
    attemptCount: row.attemptCount,
    createdResources: JSON.parse(row.createdResources) as Record<
      string,
      unknown
    >,
    errorCode: row.errorCode,
    migrationName: row.migrationName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
