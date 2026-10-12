import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_getMiniflareWorkerOptions } from "wrangler";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workerDirectory = path.join(projectRoot, "apps", "worker");
const configPath = path.resolve(
  process.env.WORKER_RUNTIME_CONFIG?.trim() ||
    path.join(workerDirectory, "wrangler.production.local.toml"),
);
const bundlePath = path.resolve(
  process.env.WORKER_BUNDLE?.trim() ||
    path.join(workerDirectory, "dist", "index.js"),
);
const statePath = path.resolve(
  process.env.WORKER_STATE_PATH?.trim() ||
    path.join(workerDirectory, ".wrangler", "state", "v3"),
);
const tmpPath = path.resolve(
  process.env.WORKER_TMP_PATH?.trim() ||
    path.join(workerDirectory, ".wrangler", "tmp"),
);
const host = process.env.WORKER_RUNTIME_HOST?.trim() || "0.0.0.0";
const port = Number(process.env.WORKER_RUNTIME_PORT || 8787);
const cronMinutes = Math.max(
  1,
  Number(process.env.LOCAL_CRON_INTERVAL_MINUTES || 10),
);
const cronExpression = process.env.LOCAL_CRON_EXPRESSION || "*/10 * * * *";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const relayToken = randomBytes(32).toString("hex");

const relay = createServer(async (request, response) => {
  try {
    if (
      request.method !== "POST" ||
      request.url !== "/ctbc" ||
      request.headers["x-ctbc-relay-token"] !== relayToken
    ) {
      response.writeHead(404).end();
      return;
    }

    const requestBody = await readRequest(request, MAX_REQUEST_BYTES);
    const payload = JSON.parse(requestBody);
    const target = new URL(payload.url);
    if (
      target.origin !== "https://eb.ctbcbank.com" ||
      !target.pathname.startsWith("/IMP/") ||
      payload.method !== "POST" ||
      typeof payload.body !== "string" ||
      !isStringRecord(payload.headers)
    ) {
      response.writeHead(400).end();
      return;
    }

    const upstream = await fetch(target, {
      method: "POST",
      headers: payload.headers,
      body: payload.body,
      redirect: "manual",
    });
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      response.writeHead(502).end();
      return;
    }
    const responseHeaders = {};
    for (const name of ["content-type", "x-auth-token"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    response.writeHead(upstream.status, responseHeaders).end(bytes);
  } catch (error) {
    const status = error?.code === "REQUEST_TOO_LARGE" ? 413 : 502;
    response.writeHead(status).end();
  }
});

await new Promise((resolve, reject) => {
  relay.once("error", reject);
  relay.listen(0, "127.0.0.1", resolve);
});
const relayAddress = relay.address();
if (!relayAddress || typeof relayAddress === "string") {
  throw new Error("Unable to resolve the CTBC local relay address.");
}

const runtimeVars = await readDotEnv(path.join(workerDirectory, ".dev.vars"));
const { workerOptions } = unstable_getMiniflareWorkerOptions(configPath);
const normalizedWorkerOptions = Object.fromEntries(
  Object.entries(workerOptions).filter(
    ([key, value]) => value !== undefined && key !== "modulesRules",
  ),
);
const bindings = {
  ...normalizedWorkerOptions.bindings,
  ...runtimeVars,
  ...(process.env.CONFIG_ENCRYPTION_KEY
    ? { CONFIG_ENCRYPTION_KEY: process.env.CONFIG_ENCRYPTION_KEY }
    : {}),
  CTBC_API_RELAY_URL: `http://127.0.0.1:${relayAddress.port}/ctbc`,
  CTBC_API_RELAY_TOKEN: relayToken,
};

const miniflare = new Miniflare(
  convertV4MiniflareOptions({
    host,
    port,
    resourcePersistencePath: statePath,
    resourceTmpPath: tmpPath,
    workers: [
      {
        ...normalizedWorkerOptions,
        bindings,
        scriptPath: bundlePath,
        modules: true,
        modulesRoot: path.dirname(bundlePath),
      },
    ],
  }),
);

await miniflare.ready;
console.log(`CTBC local relay ready on 127.0.0.1:${relayAddress.port}`);
console.log(`Production Worker runtime ready on ${host}:${port}`);

const worker = await miniflare.getWorker();
let scheduledRunning = false;
const scheduleTimer = setInterval(() => {
  if (scheduledRunning) return;
  scheduledRunning = true;
  void worker
    .scheduled({ cron: cronExpression, scheduledTime: new Date() })
    .catch((error) => {
      console.error(
        `[runtime] scheduled event failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    })
    .finally(() => {
      scheduledRunning = false;
    });
}, cronMinutes * 60_000);

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(scheduleTimer);
  await Promise.allSettled([miniflare.dispose()]);
  await new Promise((resolve) => relay.close(resolve));
  console.log(`[runtime] stopped after ${signal}`);
  process.exit(0);
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
await new Promise(() => {});

async function readRequest(request, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) {
      const error = new Error("Request too large.");
      error.code = "REQUEST_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isStringRecord(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

async function readDotEnv(filePath) {
  const contents = await readFile(filePath, "utf8");
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}
