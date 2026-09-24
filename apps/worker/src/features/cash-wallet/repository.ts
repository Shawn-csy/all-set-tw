import {
  bankTransactions,
  cashWithdrawalPreferences,
  cashWalletSettings,
  createDrizzle,
  invoiceTransactionPreferences,
  invoices,
} from "@taiwan-fin-hub/db";
import { eq, sql } from "drizzle-orm";

export async function getCashWallet(db: D1Database) {
  const database = createDrizzle(db);
  const [settings, withdrawal, expense] = await Promise.all([
    database
      .select({
        openingBalance: cashWalletSettings.openingBalance,
        currency: cashWalletSettings.currency,
        updatedAt: cashWalletSettings.updatedAt,
      })
      .from(cashWalletSettings)
      .where(eq(cashWalletSettings.id, "default"))
      .get(),
    database
      .select({
        total: sql<number>`COALESCE(SUM(ABS(${bankTransactions.amount})), 0)`,
      })
      .from(cashWithdrawalPreferences)
      .innerJoin(
        bankTransactions,
        eq(bankTransactions.id, cashWithdrawalPreferences.transactionId),
      )
      .get(),
    database
      .select({ total: sql<number>`COALESCE(SUM(ABS(${invoices.amount})), 0)` })
      .from(invoiceTransactionPreferences)
      .innerJoin(
        invoices,
        eq(invoices.id, invoiceTransactionPreferences.invoiceId),
      )
      .where(eq(invoiceTransactionPreferences.decision, "cash"))
      .get(),
  ]);
  const openingBalance = settings?.openingBalance ?? 0;
  const cashWithdrawals = Number(withdrawal?.total ?? 0);
  const cashExpenses = Number(expense?.total ?? 0);
  return {
    openingBalance,
    cashWithdrawals,
    cashExpenses,
    balance: openingBalance + cashWithdrawals - cashExpenses,
    currency: settings?.currency ?? "TWD",
    updatedAt: settings?.updatedAt ?? null,
  };
}

export async function setCashWalletOpeningBalance(
  db: D1Database,
  openingBalance: number,
  now: string,
) {
  await createDrizzle(db)
    .insert(cashWalletSettings)
    .values({
      id: "default",
      openingBalance,
      currency: "TWD",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: cashWalletSettings.id,
      set: { openingBalance, updatedAt: now },
    })
    .run();
}
