import type { Env } from "./env";
import { isLocalDevMode } from "./http";
import { BOOTSTRAP_WORKER_MODULE } from "./cloudflare-provision";

export const LOCAL_FIXTURE_VERSION = "dev-local";
export const LOCAL_FIXTURE_DIGEST = "0".repeat(64);

export class ReleaseUnavailableError extends Error {
  constructor(
    public readonly code: "RELEASE_UNAVAILABLE" | "RELEASE_DIGEST_MISMATCH",
  ) {
    super(code);
    this.name = "ReleaseUnavailableError";
  }
}

export type ReleaseArtifact = {
  version: string;
  digest: string;
  source: "r2" | "local_fixture";
  compatibilityDate: string;
  compatibilityFlags: string[];
  crons: string[];
  workerMain: string;
  workerSource: string;
  migrations: Array<{ name: string; sql: string }>;
  assets: Array<{ path: string; hash: string; size: number; bytes: string }>;
};

export function hasReleaseSource(env: Env) {
  return Boolean(env.RELEASE_BUCKET) || isLocalDevMode(env);
}

export function localFixtureRelease(
  version = LOCAL_FIXTURE_VERSION,
  digest = LOCAL_FIXTURE_DIGEST,
): ReleaseArtifact {
  const html = "<!doctype html><title>不用記帳</title><p>ok</p>";
  return {
    version,
    digest,
    source: "local_fixture",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],
    crons: ["*/10 * * * *"],
    workerMain: "index.js",
    workerSource: BOOTSTRAP_WORKER_MODULE.replace(
      "Installation is not ready.",
      "ALL SET",
    ),
    migrations: [
      {
        name: "0001_initial.sql",
        sql: "CREATE TABLE IF NOT EXISTS probe (\n  id INTEGER PRIMARY KEY\n);\n",
      },
    ],
    assets: [
      {
        path: "/index.html",
        hash: "local-index-html",
        size: html.length,
        bytes: html,
      },
    ],
  };
}

export async function readCurrentRelease(env: Env) {
  if (env.RELEASE_BUCKET) {
    const latest = await env.RELEASE_BUCKET.get("releases/latest");
    if (!latest) throw new ReleaseUnavailableError("RELEASE_UNAVAILABLE");
    const version = (await latest.text()).trim();
    const manifest = await env.RELEASE_BUCKET.get(
      `releases/${version}/release.json`,
    );
    if (!manifest) throw new ReleaseUnavailableError("RELEASE_UNAVAILABLE");
    const parsed = (await manifest.json()) as {
      version?: string;
      digest?: string;
      sha256?: string;
    };
    const digest = parsed.digest ?? parsed.sha256;
    if (!parsed.version || !digest) {
      throw new ReleaseUnavailableError("RELEASE_UNAVAILABLE");
    }
    return { version: parsed.version, digest, source: "r2" as const };
  }
  if (isLocalDevMode(env)) {
    return {
      version: LOCAL_FIXTURE_VERSION,
      digest: LOCAL_FIXTURE_DIGEST,
      source: "local_fixture" as const,
    };
  }
  throw new ReleaseUnavailableError("RELEASE_UNAVAILABLE");
}

export async function loadRelease(
  env: Env,
  version: string,
  digest: string,
): Promise<ReleaseArtifact> {
  if (env.RELEASE_BUCKET) {
    const object = await env.RELEASE_BUCKET.get(
      `releases/${version}/release.json`,
    );
    if (!object) throw new ReleaseUnavailableError("RELEASE_UNAVAILABLE");
    const manifest = (await object.json()) as {
      version?: string;
      digest?: string;
      sha256?: string;
      compatibilityDate?: string;
      compatibility_date?: string;
      compatibilityFlags?: string[];
      crons?: string[];
      workerMain?: string;
      migrations?: Array<{ name: string }>;
    };
    const actual = manifest.digest ?? manifest.sha256;
    if (actual !== digest) {
      throw new ReleaseUnavailableError("RELEASE_DIGEST_MISMATCH");
    }
    const workerMain = manifest.workerMain ?? "worker/index.js";
    const workerObject = await env.RELEASE_BUCKET.get(
      `releases/${version}/${workerMain}`,
    );
    if (!workerObject) throw new ReleaseUnavailableError("RELEASE_UNAVAILABLE");
    const migrations: ReleaseArtifact["migrations"] = [];
    for (const file of manifest.migrations ?? []) {
      const sqlObject = await env.RELEASE_BUCKET.get(
        `releases/${version}/migrations/${file.name}`,
      );
      if (!sqlObject) throw new ReleaseUnavailableError("RELEASE_UNAVAILABLE");
      migrations.push({ name: file.name, sql: await sqlObject.text() });
    }
    return {
      version: manifest.version ?? version,
      digest,
      source: "r2",
      compatibilityDate:
        manifest.compatibilityDate ??
        manifest.compatibility_date ??
        "2026-06-01",
      compatibilityFlags: manifest.compatibilityFlags ?? ["nodejs_compat"],
      crons: manifest.crons ?? ["*/10 * * * *"],
      workerMain: workerMain.split("/").pop() ?? "index.js",
      workerSource: await workerObject.text(),
      migrations,
      assets: [],
    };
  }
  if (isLocalDevMode(env)) {
    return localFixtureRelease(version, digest);
  }
  throw new ReleaseUnavailableError("RELEASE_UNAVAILABLE");
}
