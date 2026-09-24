import {
  bankAccounts,
  createDrizzle,
  cashWithdrawalPreferences,
  bankTransactionPreferences,
  bankTransactions,
} from "@taiwan-fin-hub/db";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";

export async function bankTransactionExists(
  db: D1Database,
  transactionId: string,
) {
  return Boolean(
    await createDrizzle(db)
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, transactionId),
          sql`(${bankTransactions.status} <> 'pending' OR ${bankTransactions.matchedTransactionId} IS NULL)`,
        ),
      )
      .get(),
  );
}

export async function bankTransactionIsCashWithdrawalCandidate(
  db: D1Database,
  transactionId: string,
) {
  return Boolean(
    await createDrizzle(db)
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.accountId))
      .where(
        and(
          eq(bankTransactions.id, transactionId),
          sql`${bankTransactions.amount} < 0`,
          or(
            isNull(bankAccounts.accountType),
            ne(bankAccounts.accountType, "credit"),
          ),
          sql`(${bankTransactions.status} <> 'pending' OR ${bankTransactions.matchedTransactionId} IS NULL)`,
        ),
      )
      .get(),
  );
}

export async function upsertCalculationPreference(
  db: D1Database,
  transactionId: string,
  excludedFromCalculation: boolean,
  now: string,
) {
  await createDrizzle(db)
    .insert(bankTransactionPreferences)
    .values({
      transactionId,
      excludedFromCalculation: excludedFromCalculation ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: bankTransactionPreferences.transactionId,
      set: {
        excludedFromCalculation: excludedFromCalculation ? 1 : 0,
        updatedAt: now,
      },
    })
    .run();
}

export async function upsertCashWithdrawalPreference(
  db: D1Database,
  transactionId: string,
  cashWithdrawal: boolean,
  now: string,
) {
  const database = createDrizzle(db);
  if (cashWithdrawal) {
    await database
      .insert(cashWithdrawalPreferences)
      .values({ transactionId, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: cashWithdrawalPreferences.transactionId,
        set: { updatedAt: now },
      })
      .run();
    return;
  }
  await database
    .delete(cashWithdrawalPreferences)
    .where(eq(cashWithdrawalPreferences.transactionId, transactionId))
    .run();
}
