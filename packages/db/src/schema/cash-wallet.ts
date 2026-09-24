import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cashWalletSettings = sqliteTable(
  "cash_wallet_settings",
  {
    id: text("id").notNull().primaryKey(),
    openingBalance: integer("opening_balance")
      .notNull()
      .default(sql`0`),
    currency: text("currency")
      .notNull()
      .default(sql`'TWD'`),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("cash_wallet_settings_check_1", sql`id = 'default'`),
    check("cash_wallet_settings_check_2", sql`currency = 'TWD'`),
  ],
);
