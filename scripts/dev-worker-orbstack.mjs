import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const composeFile = path.join(projectRoot, "docker-compose.orbstack.yml");
const keychainService = "taiwan-fin-hub/config-encryption-key";

const keyResult = spawnSync(
  "security",
  [
    "find-generic-password",
    "-a",
    process.env.USER ?? "",
    "-s",
    keychainService,
    "-w",
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
const configKey = keyResult.status === 0 ? keyResult.stdout.trim() : "";
if (!configKey) {
  throw new Error(
    "The local CONFIG_ENCRYPTION_KEY was not found in macOS Keychain.",
  );
}

const secretDirectory = await mkdtemp(
  path.join(os.tmpdir(), "taiwan-fin-hub-orbstack-"),
);
const secretPath = path.join(secretDirectory, "config-encryption-key");
await writeFile(secretPath, `${configKey}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await chmod(secretPath, 0o600);

let child;
let stopping = false;
const cleanup = async () => {
  await rm(secretDirectory, { recursive: true, force: true });
};

try {
  child = spawn("docker", ["compose", "-f", composeFile, "up", "--build"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CONFIG_ENCRYPTION_KEY_FILE: secretPath,
    },
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (stopping) return;
      stopping = true;
      child.kill(signal);
    });
  }

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  process.exitCode = exitCode;
} finally {
  await cleanup();
}
