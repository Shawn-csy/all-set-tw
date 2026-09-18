import type { Env } from "../../platform/env";
import {
  CloudflareApiError,
  runAccountPrecheck,
} from "../../platform/cloudflare";
import { findLatestActiveSessionForOwner } from "../auth/repository";
import { AuthServiceError, readAccessToken } from "../auth/service";
import {
  getInstallationById,
  updateInstallationStatus,
} from "../installations/repository";
import {
  MAX_JOB_ATTEMPTS,
  acquireJobLease,
  getJobById,
  updateJob,
} from "./repository";

export type QueueOutcome = "ack" | "retry";

export async function processDeployJob(
  env: Env,
  jobId: string,
  leaseOwner: string,
  now = new Date(),
): Promise<QueueOutcome> {
  const job = await getJobById(env.DB, jobId);
  if (!job) return "ack";
  if (
    job.status === "succeeded" ||
    job.status === "cancelled" ||
    job.status === "awaiting_stage3"
  ) {
    return "ack";
  }
  if (job.status === "failed") return "ack";
  if (job.status === "awaiting_reauth") return "ack";

  const leased = await acquireJobLease(env.DB, jobId, leaseOwner, now);
  if (!leased) return "retry";

  const current = await getJobById(env.DB, jobId);
  if (!current) return "ack";
  if (current.attemptCount > MAX_JOB_ATTEMPTS) {
    await updateJob(env.DB, jobId, {
      status: "failed",
      errorCode: "TOO_MANY_ATTEMPTS",
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: now.toISOString(),
    });
    return "ack";
  }

  const installation = await getInstallationById(
    env.DB,
    current.installationId,
  );
  if (!installation) {
    await updateJob(env.DB, jobId, {
      status: "failed",
      errorCode: "INSTALLATION_NOT_FOUND",
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: now.toISOString(),
    });
    return "ack";
  }

  let accessToken: string;
  try {
    const latestSession = await readOwnerToken(env, installation.ownerSub);
    accessToken = latestSession;
  } catch (error) {
    const code =
      error instanceof AuthServiceError ? error.code : "TOKEN_EXPIRED";
    await updateJob(env.DB, jobId, {
      status: "awaiting_reauth",
      errorCode: code === "SESSION_EXPIRED" ? "TOKEN_EXPIRED" : code,
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: now.toISOString(),
    });
    await updateInstallationStatus(
      env.DB,
      installation.id,
      "awaiting_reauth",
      now.toISOString(),
    );
    return "ack";
  }

  try {
    const precheck = await runAccountPrecheck({
      accessToken,
      accountId: installation.accountId,
      workerName: installation.workerName,
    });
    if (!precheck.ready) {
      await updateJob(env.DB, jobId, {
        status: "failed",
        step: "precheck",
        errorCode: "PRECHECK_INCOMPLETE",
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: now.toISOString(),
      });
      await updateInstallationStatus(
        env.DB,
        installation.id,
        "failed",
        now.toISOString(),
      );
      return "ack";
    }
  } catch (error) {
    if (error instanceof CloudflareApiError && error.code === "TOKEN_EXPIRED") {
      await updateJob(env.DB, jobId, {
        status: "awaiting_reauth",
        errorCode: "TOKEN_EXPIRED",
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: now.toISOString(),
      });
      return "ack";
    }
    throw error;
  }

  // Stage 2 stops before Cloudflare writes. Stage 3 will resume from this step.
  await updateJob(env.DB, jobId, {
    status: "awaiting_stage3",
    step: "provision_resources",
    errorCode: null,
    leaseOwner: null,
    leaseUntil: null,
    updatedAt: now.toISOString(),
  });
  await updateInstallationStatus(
    env.DB,
    installation.id,
    "awaiting_stage3",
    now.toISOString(),
  );
  return "ack";
}

async function readOwnerToken(env: Env, ownerSub: string) {
  const row = await findLatestActiveSessionForOwner(
    env.DB,
    ownerSub,
    new Date(),
  );
  if (!row) {
    throw new AuthServiceError(
      "TOKEN_EXPIRED",
      "Cloudflare 授權已過期，請重新授權後續跑。",
    );
  }
  const { accessToken } = await readAccessToken(env, row.id);
  return accessToken;
}

export async function consumeDeployQueue(
  batch: MessageBatch<{ type: string; jobId?: string }>,
  env: Env,
) {
  for (const message of batch.messages) {
    if (message.body.type !== "run-deploy-job" || !message.body.jobId) {
      console.error(
        JSON.stringify({
          event: "deploy_queue_message_rejected",
          messageId: message.id,
        }),
      );
      message.ack();
      continue;
    }
    const outcome = await processDeployJob(env, message.body.jobId, message.id);
    if (outcome === "retry") message.retry();
    else message.ack();
  }
}
