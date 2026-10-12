import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { restoreCloudD1ToLocal } from "./backup-local-d1.mjs";

const productionRoot = path.resolve(
  process.env.FINANCE_PRODUCTION_ROOT?.trim() ||
    path.join(os.homedir(), ".local", "share", "taiwan-fin-hub-production"),
);
const manageProduction = ["1", "true", "yes", "on"].includes(
  (process.env.LOCAL_PRODUCTION_RESTORE || "").trim().toLowerCase(),
);
let productionWasStopped = false;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const confirmed = process.argv.includes("--confirm");
    if (manageProduction && !confirmed) {
      throw new Error(
        "LOCAL_PRODUCTION_RESTORE requires --confirm before stopping local production.",
      );
    }
    if (manageProduction) {
      configureProductionRestore();
      stopProduction();
      productionWasStopped = true;
    }
    await restoreCloudD1ToLocal({
      confirm: confirmed,
    });
  } catch (error) {
    console.error(
      `[restore] ${error instanceof Error ? error.message : "Restore failed."}`,
    );
    process.exitCode = 1;
  } finally {
    if (productionWasStopped) startProduction();
  }
}

function configureProductionRestore() {
  process.env.LOCAL_WRANGLER_CONFIG ||= path.join(
    process.cwd(),
    "apps/worker/wrangler.production.local.toml",
  );
  process.env.LOCAL_D1_PERSIST_TO ||= path.join(
    productionRoot,
    "state",
    "state",
  );
  process.env.REMOTE_WRANGLER_CONFIG ||= path.join(
    productionRoot,
    "wrangler.private.toml",
  );
}

function composeArgs(command, ...extra) {
  return [
    "compose",
    "--project-name",
    "finance-production",
    "--env-file",
    path.join(productionRoot, ".env"),
    "-f",
    path.join(productionRoot, "docker-compose.yml"),
    command,
    ...extra,
  ];
}

function stopProduction() {
  console.log("[restore] Stopping local production before replacing D1.");
  execFileSync("docker", composeArgs("stop", "worker", "d1-sync"), {
    cwd: productionRoot,
    stdio: "inherit",
  });
}

function startProduction() {
  console.log("[restore] Starting local production after D1 restore.");
  execFileSync(
    "docker",
    composeArgs("up", "-d", "--no-recreate", "worker", "d1-sync"),
    {
      cwd: productionRoot,
      stdio: "inherit",
    },
  );
}
