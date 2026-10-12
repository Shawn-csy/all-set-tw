import { readFile } from "node:fs/promises";

const statusPath =
  process.env.LOCAL_BACKUP_STATUS_PATH?.trim() ||
  "/workspace/apps/worker/.wrangler/backup-status.json";
const maxAgeMinutes = Math.max(
  5,
  Number(process.env.BACKUP_MAX_AGE_MINUTES || 90),
);

try {
  const status = JSON.parse(await readFile(statusPath, "utf8"));
  const lastSuccessAt = Date.parse(status.lastSuccessAt ?? "");
  const ageMs = Date.now() - lastSuccessAt;
  if (
    status.status !== "ok" ||
    !Number.isFinite(lastSuccessAt) ||
    ageMs < 0 ||
    ageMs > maxAgeMinutes * 60_000
  ) {
    throw new Error(
      `last successful backup is missing or older than ${maxAgeMinutes} minutes`,
    );
  }
} catch (error) {
  console.error(
    `[backup-health] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
