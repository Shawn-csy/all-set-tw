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
    expect(sql).toContain("PRAGMA defer_foreign_keys = ON;");
    expect(BACKUP_TABLES).toHaveLength(31);
  });

  it("prepends the clear transaction to a local data export", () => {
    const sql = buildRestoreSql(
      "INSERT INTO invoices (id) VALUES ('invoice-1');",
    );
    expect(sql.indexOf('DELETE FROM "invoices";')).toBeLessThan(
      sql.indexOf("INSERT INTO invoices"),
    );
    expect(sql).toContain("PRAGMA defer_foreign_keys = ON;");
    expect(sql).toContain("PRAGMA foreign_keys = ON;");
  });

  it("does not restore Wrangler-owned metadata rows", () => {
    const sql = buildRestoreSql(
      'INSERT INTO "d1_migrations" (id, name, applied_at) VALUES (1, \'migration\', 1);\n' +
        'INSERT INTO "sqlite_sequence" (name, seq) VALUES (\'invoices\', 1);\n' +
        'INSERT INTO invoices (id) VALUES (\'invoice-1\');',
    );

    expect(sql).not.toContain('INSERT INTO "d1_migrations"');
    expect(sql).not.toContain('INSERT INTO "sqlite_sequence"');
    expect(sql).toContain("INSERT INTO invoices");
  });
});
