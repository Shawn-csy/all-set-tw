import { pathToFileURL } from "node:url";
import { restoreCloudD1ToLocal } from "./backup-local-d1.mjs";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await restoreCloudD1ToLocal({
      confirm: process.argv.includes("--confirm"),
    });
  } catch (error) {
    console.error(
      `[restore] ${error instanceof Error ? error.message : "Restore failed."}`,
    );
    process.exitCode = 1;
  }
}
