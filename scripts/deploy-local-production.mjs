import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultProductionRoot = path.join(
  os.homedir(),
  ".local",
  "share",
  "taiwan-fin-hub-production",
);
const productionRoot = path.resolve(
  process.env.FINANCE_PRODUCTION_ROOT?.trim() || defaultProductionRoot,
);
const productionCompose = path.join(productionRoot, "docker-compose.yml");
const productionEnv = path.join(productionRoot, ".env");
const productionVars = path.join(productionRoot, "vars", ".dev.vars");
const configKeyPath = path.join(
  productionRoot,
  "secrets",
  "config_encryption_key",
);
const imageTag = sanitizeTag(
  process.env.FINANCE_PRODUCTION_TAG?.trim() ||
    process.env.GITHUB_SHA?.slice(0, 12) ||
    `local-${Date.now()}`,
);
const image = `finance-worker-production:${imageTag}`;

await prepareProductionRoot();
await ensureWranglerAuth();
await ensureProductionVars();
await writeConfigKey();
await copyFile(
  path.join(projectRoot, "docker-compose.production.yml"),
  productionCompose,
);
await writeFile(
  productionEnv,
  `FINANCE_PRODUCTION_ROOT=${productionRoot}\nFINANCE_PRODUCTION_TAG=latest\n`,
  { encoding: "utf8", mode: 0o600 },
);
await chmod(productionEnv, 0o600);

console.log(`Building ${image}...`);
await run("docker", [
  "build",
  "--provenance=false",
  "--platform",
  "linux/amd64",
  "-f",
  path.join(projectRoot, "docker/orbstack/worker.production.Dockerfile"),
  "-t",
  image,
  ".",
]);
await run("docker", ["tag", image, "finance-worker-production:latest"]);

console.log(`Deploying local production from ${productionRoot}...`);
await run(
  "docker",
  [
    "compose",
    "--project-name",
    "finance-production",
    "--env-file",
    productionEnv,
    "-f",
    productionCompose,
    "up",
    "-d",
    "--no-build",
    "--force-recreate",
  ],
  { cwd: productionRoot },
);

await waitForHealthy();
console.log("Local production is healthy: finance on 127.0.0.1:8787");

async function prepareProductionRoot() {
  await mkdir(path.join(productionRoot, "state"), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(path.join(productionRoot, "wrangler-config"), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(path.join(productionRoot, "vars"), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(path.join(productionRoot, "secrets"), {
    recursive: true,
    mode: 0o700,
  });
}

async function ensureProductionVars() {
  try {
    await stat(productionVars);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Missing production vars file: ${productionVars}. Copy apps/worker/.dev.vars.example there and fill in production values.`,
      );
    }
    throw error;
  }

  const contents = await readFile(productionVars, "utf8");
  if (/^LOCAL_DEV_MODE\s*=\s*(true|1|yes|on)\s*$/im.test(contents)) {
    throw new Error(
      `Production vars must not enable LOCAL_DEV_MODE: ${productionVars}. Remove that setting before deploying.`,
    );
  }
}

async function ensureWranglerAuth() {
  const target = path.join(
    productionRoot,
    "wrangler-config",
    ".wrangler",
    "config",
    "default.toml",
  );
  const source = path.join(
    projectRoot,
    ".wrangler-config",
    ".wrangler",
    "config",
    "default.toml",
  );
  try {
    await stat(source);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  await chmod(target, 0o600);
}

async function writeConfigKey() {
  const configuredKey = process.env.CONFIG_ENCRYPTION_KEY?.trim();
  const configKey = configuredKey || loadKeychainConfigKey();
  if (!configKey) {
    throw new Error(
      "CONFIG_ENCRYPTION_KEY was not provided and the macOS Keychain entry was not found.",
    );
  }
  await writeFile(configKeyPath, `${configKey}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(configKeyPath, 0o600);
}

function loadKeychainConfigKey() {
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync(
      "security",
      [
        "find-generic-password",
        "-a",
        process.env.USER ?? "",
        "-s",
        "taiwan-fin-hub/config-encryption-key",
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

async function waitForHealthy() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const result = await capture("docker", [
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      "finance",
    ]);
    if (result.code === 0 && result.stdout.trim() === "healthy") return;
    if (result.code === 0 && result.stdout.trim() === "unhealthy") {
      await run("docker", ["logs", "--tail", "100", "finance"]);
      throw new Error("Local production failed its healthcheck.");
    }
    await delay(1000);
  }
  await run("docker", ["logs", "--tail", "100", "finance"]);
  throw new Error("Timed out waiting for local production to become healthy.");
}

function sanitizeTag(value) {
  const tag = value.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return tag || `local-${Date.now()}`;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by ${signal}`));
      } else if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: productionRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({
        code: signal ? null : code,
        stdout,
        stderr,
      });
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
