import {
  bankTransactions,
  cashWalletSettings,
  createDrizzle,
  invoiceTransactionPreferences,
  invoices,
} from "@taiwan-fin-hub/db";
import { eq, sql } from "drizzle-orm";
import { resolveClassifications } from "../classification/service";

export async function getCashWallet(db: D1Database) {
  const database = createDrizzle(db);
  const [settings, transactions, expense] = await Promise.all([
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
        id: bankTransactions.id,
        sourceId: bankTransactions.sourceId,
        description: bankTransactions.description,
        counterparty: bankTransactions.counterparty,
        amount: bankTransactions.amount,
        accountType: sql<string | null>`(
          SELECT account_type FROM bank_accounts
          WHERE bank_accounts.id = ${bankTransactions.accountId}
        )`,
      })
      .from(bankTransactions)
      .where(eq(bankTransactions.status, "posted"))
      .all(),
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
  const classificationMap = await resolveClassifications(
    db,
    transactions.map((transaction) => ({
      id: transaction.id,
      sourceId: transaction.sourceId,
      description: transaction.description,
      counterparty: transaction.counterparty,
      amount: transaction.amount,
      accountType: transaction.accountType,
    })),
  );
  const cashWithdrawals = transactions.reduce((total, transaction) => {
    const classification = classificationMap.get(transaction.id);
    if (
      classification?.behavior !== "cash_withdrawal" ||
      transaction.accountType === "credit" ||
      transaction.amount >= 0
    )
      return total;
    return total + Math.abs(transaction.amount);
  }, 0);
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
