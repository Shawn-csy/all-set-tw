import { describe, expect, it } from "vitest";
import {
  BACKUP_TABLES,
  buildBackupClearSql,
  buildRestoreSql,
} from "./backup-local-d1.mjs";

describe("local D1 backup", () => {
  it("clears only application tables", () => {
    const sql = buildBackupClearSql();
    expect(sql).toContain('DELETE FROM "bank_transactions";');
    expect(sql).toContain('DELETE FROM "connector_settings";');
    expect(sql).not.toContain("d1_migrations");
    expect(BACKUP_TABLES).toHaveLength(31);
  });

  it("prepends the clear transaction to a local data export", () => {
    const sql = buildRestoreSql(
      "INSERT INTO invoices (id) VALUES ('invoice-1');",
    );
    expect(sql.indexOf('DELETE FROM "invoices";')).toBeLessThan(
      sql.indexOf("INSERT INTO invoices"),
    );
    expect(sql).toContain("PRAGMA foreign_keys = ON;");
  });
});
