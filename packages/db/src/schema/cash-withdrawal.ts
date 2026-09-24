import {
  foreignKey,
  index,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { bankTransactions } from "./bank";

export const cashWithdrawalPreferences = sqliteTable(
  "cash_withdrawal_preferences",
  {
    transactionId: text("transaction_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.transactionId] }),
    foreignKey({
      columns: [table.transactionId],
      foreignColumns: [bankTransactions.id],
    }),
    index("idx_cash_withdrawal_preferences_updated").on(table.updatedAt),
  ],
);
