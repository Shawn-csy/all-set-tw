import { backupLocalD1 } from "./backup-local-d1.mjs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const intervalMinutes = Number(process.env.LOCAL_BACKUP_INTERVAL_MINUTES || 30);
const intervalMs = Math.max(5, intervalMinutes) * 60_000;
const statusPath =
  process.env.LOCAL_BACKUP_STATUS_PATH?.trim() ||
  "/workspace/apps/worker/.wrangler/backup-status.json";

let running = false;

async function runBackup() {
  if (running) return;
  running = true;
  const startedAt = Date.now();
  await updateStatus({
    status: "running",
    lastAttemptAt: new Date(startedAt).toISOString(),
  });
  try {
    await backupLocalD1({ confirm: true });
    await updateStatus({
      status: "ok",
      lastSuccessAt: new Date().toISOString(),
      lastDurationMs: Date.now() - startedAt,
      lastError: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backup failed.";
    await updateStatus({
      status: "error",
      lastFailureAt: new Date().toISOString(),
      lastDurationMs: Date.now() - startedAt,
      lastError: message.replace(/\s+/g, " ").slice(0, 300),
    });
    console.error(`[backup-watch] ${message}`);
  } finally {
    running = false;
  }
}

console.log(
  `[backup-watch] Backing up local D1 every ${Math.max(5, intervalMinutes)} minutes.`,
);
await runBackup();
setInterval(() => void runBackup(), intervalMs);

async function updateStatus(patch) {
  try {
    let current = {};
    try {
      current = JSON.parse(await readFile(statusPath, "utf8"));
    } catch {
      // The first run starts without a status file.
    }
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await mkdir(dirname(statusPath), { recursive: true });
    const temporaryPath = `${statusPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(next)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, statusPath);
  } catch (error) {
    console.error(
      `[backup-watch] Could not update backup status: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
