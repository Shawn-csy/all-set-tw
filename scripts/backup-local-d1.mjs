import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const repositoryDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Keep this list explicit. It prevents an accidental DELETE of Wrangler's
// metadata tables when refreshing the cloud backup database.
export const BACKUP_TABLES = [
  "bank_accounts",
  "bank_balance_snapshots",
  "bank_transaction_preferences",
  "bank_transactions",
  "classification_categories",
  "classification_overrides",
  "classification_rules",
  "connector_settings",
  "credit_card_bills",
  "einvoice_sync_run_items",
  "einvoice_sync_runs",
  "exchange_rates",
  "investment_positions",
  "investment_transactions",
  "invoice_line_items",
  "invoice_transaction_preferences",
  "invoices",
  "manual_assets",
  "net_worth_history",
  "notification_preferences",
  "push_subscriptions",
  "scheduled_sync_batch_results",
  "scheduled_sync_batches",
  "sync_activity_changes",
  "sync_activity_details",
  "sync_activity_runs",
  "sync_jobs",
  "sync_schedule_settings",
  "sync_write_staging",
  "tdcc_sync_run_items",
  "tdcc_sync_runs",
];

const WRANGLER_METADATA_TABLES = new Set(["d1_migrations", "sqlite_sequence"]);

export function buildBackupClearSql() {
  return [
    "PRAGMA foreign_keys = OFF;",
    "PRAGMA defer_foreign_keys = ON;",
    ...BACKUP_TABLES.map((table) => `DELETE FROM \"${table}\";`),
    "PRAGMA defer_foreign_keys = OFF;",
    "PRAGMA foreign_keys = ON;",
  ].join("\n");
}

export function buildRestoreSql(localExport) {
  const dataSql = localExport
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.trim().match(
        /^(?:INSERT|REPLACE) INTO [\"`]?([^\"` (]+)[\"`]?/i,
      );
      return !match || !WRANGLER_METADATA_TABLES.has(match[1]);
    })
    .join("\n")
    .trim();

  return `${buildBackupClearSql()}\n${dataSql}\n`;
}

function configPath(name, fallback) {
  return resolve(repositoryDirectory, process.env[name]?.trim() || fallback);
}

async function runWrangler(args) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const { stdout, stderr } = await execFileAsync(
    executable,
    ["wrangler", ...args],
    {
      cwd: repositoryDirectory,
      env: {
        ...process.env,
        XDG_CONFIG_HOME:
          process.env.XDG_CONFIG_HOME ||
          join(repositoryDirectory, ".wrangler-config"),
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}

export async function backupLocalD1({ confirm = false } = {}) {
  if (!confirm) {
    throw new Error(
      "This operation replaces the cloud backup database. Re-run with --confirm after checking both Wrangler configurations.",
    );
  }

  const localConfig = configPath(
    "LOCAL_WRANGLER_CONFIG",
    "apps/worker/wrangler.local.toml",
  );
  const remoteConfig = configPath(
    "REMOTE_WRANGLER_CONFIG",
    "wrangler.private.toml",
  );
  const localDatabase = process.env.LOCAL_D1_NAME?.trim() || "DB";
  const remoteDatabase = process.env.REMOTE_D1_NAME?.trim() || "DB";
  const workingDirectory = await mkdtemp(
    join(tmpdir(), "taiwan-fin-hub-backup-"),
  );
  const localExportPath = join(workingDirectory, "local-data.sql");
  const restorePath = join(workingDirectory, "restore.sql");

  try {
    console.log("[backup] Applying local migrations before export.");
    await runWrangler([
      "d1",
      "migrations",
      "apply",
      localDatabase,
      "--local",
      "--config",
      localConfig,
    ]);

    console.log("[backup] Exporting local D1 data.");
    await runWrangler([
      "d1",
      "export",
      localDatabase,
      "--local",
      "--no-schema",
      "--output",
      localExportPath,
      "--skip-confirmation",
      "--config",
      localConfig,
    ]);

    const localExport = await readFile(localExportPath, "utf8");
    if (!localExport.trim()) {
      throw new Error(
        "The local D1 export was empty; cloud backup was not changed.",
      );
    }
    await writeFile(restorePath, buildRestoreSql(localExport), "utf8");

    console.log("[backup] Applying migrations to the cloud backup database.");
    await runWrangler([
      "d1",
      "migrations",
      "apply",
      remoteDatabase,
      "--remote",
      "--config",
      remoteConfig,
    ]);

    console.log(
      "[backup] Replacing cloud backup data from the local snapshot.",
    );
    await runWrangler([
      "d1",
      "execute",
      remoteDatabase,
      "--remote",
      "--file",
      restorePath,
      "--yes",
      "--config",
      remoteConfig,
    ]);
    console.log("[backup] Local D1 snapshot uploaded to the cloud backup.");
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

export async function restoreCloudD1ToLocal({ confirm = false } = {}) {
  if (!confirm) {
    throw new Error(
      "This operation replaces the local primary database. Re-run with --confirm after checking both Wrangler configurations.",
    );
  }

  const localConfig = configPath(
    "LOCAL_WRANGLER_CONFIG",
    "apps/worker/wrangler.local.toml",
  );
  const remoteConfig = configPath(
    "REMOTE_WRANGLER_CONFIG",
    "wrangler.private.toml",
  );
  const localDatabase = process.env.LOCAL_D1_NAME?.trim() || "DB";
  const remoteDatabase = process.env.REMOTE_D1_NAME?.trim() || "DB";
  const workingDirectory = await mkdtemp(
    join(tmpdir(), "taiwan-fin-hub-restore-"),
  );
  const remoteExportPath = join(workingDirectory, "cloud-data.sql");
  const restorePath = join(workingDirectory, "restore.sql");

  try {
    console.log("[restore] Applying migrations to the local primary database.");
    await runWrangler([
      "d1",
      "migrations",
      "apply",
      localDatabase,
      "--local",
      "--config",
      localConfig,
    ]);

    console.log("[restore] Exporting the cloud backup data.");
    await runWrangler([
      "d1",
      "export",
      remoteDatabase,
      "--remote",
      "--no-schema",
      "--output",
      remoteExportPath,
      "--skip-confirmation",
      "--config",
      remoteConfig,
    ]);

    const remoteExport = await readFile(remoteExportPath, "utf8");
    if (!remoteExport.trim()) {
      throw new Error(
        "The cloud backup export was empty; local D1 was not changed.",
      );
    }
    await writeFile(restorePath, buildRestoreSql(remoteExport), "utf8");

    console.log(
      "[restore] Replacing local primary data from the cloud snapshot.",
    );
    await runWrangler([
      "d1",
      "execute",
      localDatabase,
      "--local",
      "--file",
      restorePath,
      "--yes",
      "--config",
      localConfig,
    ]);
    console.log("[restore] Cloud backup restored to local D1.");
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await backupLocalD1({ confirm: process.argv.includes("--confirm") });
  } catch (error) {
    console.error(
      `[backup] ${error instanceof Error ? error.message : "Backup failed."}`,
    );
    process.exitCode = 1;
  }
}
