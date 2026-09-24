import { chmod, mkdir, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
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

// Compose bind-mounts this file into the detached container. It must remain
// present after this launcher exits so `restart: unless-stopped` can start the
// container again. The directory is ignored by Git and the file is mode 600.
const secretDirectory = path.join(
  projectRoot,
  ".wrangler-config",
  "orbstack-secrets",
);
await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
await chmod(secretDirectory, 0o700);
const secretPath = path.join(secretDirectory, "config-encryption-key");
await writeFile(secretPath, `${configKey}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await chmod(secretPath, 0o600);

let child;
let stopping = false;
child = spawn(
  "docker",
  ["compose", "-f", composeFile, "up", "--build", "--detach"],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      CONFIG_ENCRYPTION_KEY_FILE: secretPath,
    },
    stdio: "inherit",
  },
);

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
if (exitCode === 0) {
  console.log("OrbStack local Worker is running detached: finance");
}
process.exitCode = exitCode;
