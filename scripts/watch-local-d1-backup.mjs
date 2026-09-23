import { backupLocalD1 } from "./backup-local-d1.mjs";

const intervalMinutes = Number(process.env.LOCAL_BACKUP_INTERVAL_MINUTES || 30);
const intervalMs = Math.max(5, intervalMinutes) * 60_000;

let running = false;

async function runBackup() {
  if (running) return;
  running = true;
  try {
    await backupLocalD1({ confirm: true });
  } catch (error) {
    console.error(
      `[backup-watch] ${error instanceof Error ? error.message : "Backup failed."}`,
    );
  } finally {
    running = false;
  }
}

console.log(
  `[backup-watch] Backing up local D1 every ${Math.max(5, intervalMinutes)} minutes.`,
);
await runBackup();
setInterval(() => void runBackup(), intervalMs);
