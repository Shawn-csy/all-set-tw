import {
  createDrizzle,
  bankAccounts,
  bankTransactions,
  invoicePaymentAccounts,
  invoicePaymentAccountRules,
  invoiceTransactionPreferences,
  invoices,
} from "@taiwan-fin-hub/db";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

const bankTx = alias(bankTransactions, "bank_tx");
const account = alias(bankAccounts, "account");
const mappingTx = alias(bankTransactions, "mapping_tx");

export type InvoiceTransactionPreferenceRow = {
  invoiceId: string;
  transactionId: string | null;
  decision: "linked" | "separate" | "cash";
  createdAt: string;
  updatedAt: string;
  invoiceSellerName: string | null;
  transactionAccountId: string | null;
};

export type MappingInvoiceRow = {
  id: string;
  invoiceDate: string;
  sellerName: string | null;
};

export type MappingTransactionRow = {
  id: string;
  postedDate: string | null;
  authorizedAt: string | null;
  amount: number;
  currency: string;
  accountType: string | null;
  accountId: string;
};

export type InvoicePaymentAccountRuleRow = {
  matchKey: string;
  accountId: string;
  updatedAt: string;
};

export type InvoicePaymentAccountRow = {
  invoiceId: string;
  accountId: string;
  updatedAt: string;
};

export async function listInvoiceTransactionPreferences(db: D1Database) {
  const drizzle = createDrizzle(db);
  return drizzle
    .select({
      invoiceId: invoiceTransactionPreferences.invoiceId,
      transactionId: invoiceTransactionPreferences.transactionId,
      decision: sql<
        "linked" | "separate" | "cash"
      >`${invoiceTransactionPreferences.decision}`,
      createdAt: invoiceTransactionPreferences.createdAt,
      updatedAt: invoiceTransactionPreferences.updatedAt,
      invoiceSellerName: invoices.sellerName,
      transactionAccountId: mappingTx.accountId,
    })
    .from(invoiceTransactionPreferences)
    .leftJoin(
      invoices,
      eq(invoices.id, invoiceTransactionPreferences.invoiceId),
    )
    .leftJoin(
      mappingTx,
      eq(mappingTx.id, invoiceTransactionPreferences.transactionId),
    )
    .where(
      notExists(
        drizzle
          .select({ id: bankTx.id })
          .from(bankTx)
          .where(
            and(
              eq(bankTx.id, invoiceTransactionPreferences.transactionId),
              eq(bankTx.status, "pending"),
              isNotNull(bankTx.matchedTransactionId),
            ),
          ),
      ),
    )
    .orderBy(
      desc(invoiceTransactionPreferences.updatedAt),
      asc(invoiceTransactionPreferences.invoiceId),
    )
    .all();
}

export async function findMappingInvoice(db: D1Database, invoiceId: string) {
  return (
    (await createDrizzle(db)
      .select({
        id: invoices.id,
        invoiceDate: invoices.invoiceDate,
        sellerName: invoices.sellerName,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .get()) ?? null
  );
}

export async function findMappingTransaction(
  db: D1Database,
  transactionId: string,
) {
  return (
    (await createDrizzle(db)
      .select({
        id: bankTx.id,
        postedDate: bankTx.postedDate,
        authorizedAt: bankTx.authorizedAt,
        amount: bankTx.amount,
        currency: bankTx.currency,
        description: bankTx.description,
        counterparty: bankTx.counterparty,
        accountType: account.accountType,
        accountId: bankTx.accountId,
      })
      .from(bankTx)
      .innerJoin(account, eq(account.id, bankTx.accountId))
      .where(
        and(
          eq(bankTx.id, transactionId),
          or(ne(bankTx.status, "pending"), isNull(bankTx.matchedTransactionId)),
        ),
      )
      .get()) ?? null
  );
}

export async function listInvoicePaymentAccountRules(db: D1Database) {
  return createDrizzle(db)
    .select({
      matchKey: invoicePaymentAccountRules.matchKey,
      accountId: invoicePaymentAccountRules.accountId,
      updatedAt: invoicePaymentAccountRules.updatedAt,
    })
    .from(invoicePaymentAccountRules)
    .orderBy(desc(invoicePaymentAccountRules.updatedAt))
    .all();
}

export async function listInvoicePaymentAccounts(db: D1Database) {
  return createDrizzle(db)
    .select({
      invoiceId: invoicePaymentAccounts.invoiceId,
      accountId: invoicePaymentAccounts.accountId,
      updatedAt: invoicePaymentAccounts.updatedAt,
    })
    .from(invoicePaymentAccounts)
    .all();
}

/** Keep the invoice's actual card, reusable rule and old cash decision in sync. */
export async function saveInvoicePaymentAccount(
  db: D1Database,
  input: {
    invoiceId: string;
    accountId: string;
    matchKey: string;
    now: string;
  },
) {
  const statements = [
    db
      .prepare(
        `INSERT INTO invoice_payment_accounts (invoice_id, account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(invoice_id) DO UPDATE SET account_id = excluded.account_id,
         updated_at = excluded.updated_at`,
      )
      .bind(input.invoiceId, input.accountId, input.now, input.now),
  ];
  if (input.matchKey) {
    statements.push(
      db
        .prepare(
          `INSERT INTO invoice_payment_account_rules (match_key, account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(match_key) DO UPDATE SET account_id = excluded.account_id,
           updated_at = excluded.updated_at`,
        )
        .bind(input.matchKey, input.accountId, input.now, input.now),
    );
  }
  statements.push(
    db
      .prepare(
        `DELETE FROM invoice_transaction_preferences
       WHERE invoice_id = ? AND decision IN ('cash', 'separate')`,
      )
      .bind(input.invoiceId),
  );
  await db.batch(statements);
}

export async function saveInvoiceCashPayment(
  db: D1Database,
  invoiceId: string,
  now: string,
) {
  await db.batch([
    db
      .prepare(
        `INSERT INTO invoice_transaction_preferences
       (invoice_id, transaction_id, decision, created_at, updated_at)
       VALUES (?, NULL, 'cash', ?, ?)
       ON CONFLICT(invoice_id) DO UPDATE SET transaction_id = NULL,
         decision = 'cash', updated_at = excluded.updated_at`,
      )
      .bind(invoiceId, now, now),
    db
      .prepare("DELETE FROM invoice_payment_accounts WHERE invoice_id = ?")
      .bind(invoiceId),
  ]);
}

export async function saveInvoiceLinkedTransaction(
  db: D1Database,
  input: {
    invoiceId: string;
    transactionId: string;
    accountId: string;
    isCard: boolean;
    matchKey: string;
    now: string;
  },
) {
  const statements = [
    db
      .prepare(
        `INSERT INTO invoice_transaction_preferences
       (invoice_id, transaction_id, decision, created_at, updated_at)
       VALUES (?, ?, 'linked', ?, ?)
       ON CONFLICT(invoice_id) DO UPDATE SET transaction_id = excluded.transaction_id,
         decision = 'linked', updated_at = excluded.updated_at`,
      )
      .bind(input.invoiceId, input.transactionId, input.now, input.now),
  ];
  if (input.isCard) {
    statements.push(
      db
        .prepare(
          `INSERT INTO invoice_payment_accounts (invoice_id, account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(invoice_id) DO UPDATE SET account_id = excluded.account_id,
           updated_at = excluded.updated_at`,
        )
        .bind(input.invoiceId, input.accountId, input.now, input.now),
    );
    if (input.matchKey) {
      statements.push(
        db
          .prepare(
            `INSERT INTO invoice_payment_account_rules (match_key, account_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(match_key) DO UPDATE SET account_id = excluded.account_id,
             updated_at = excluded.updated_at`,
          )
          .bind(input.matchKey, input.accountId, input.now, input.now),
      );
    }
  } else {
    statements.push(
      db
        .prepare("DELETE FROM invoice_payment_accounts WHERE invoice_id = ?")
        .bind(input.invoiceId),
    );
  }
  await db.batch(statements);
}

export async function findPaymentAccount(db: D1Database, accountId: string) {
  return (
    (await createDrizzle(db)
      .select({
        id: bankAccounts.id,
        accountType: bankAccounts.accountType,
      })
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, accountId),
          eq(bankAccounts.accountType, "credit"),
          isNull(bankAccounts.canonicalAccountId),
          isNull(bankAccounts.inactiveAt),
        ),
      )
      .get()) ?? null
  );
}

export async function upsertInvoicePaymentAccountRule(
  db: D1Database,
  input: { matchKey: string; accountId: string; now: string },
) {
  await createDrizzle(db)
    .insert(invoicePaymentAccountRules)
    .values({
      matchKey: input.matchKey,
      accountId: input.accountId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: invoicePaymentAccountRules.matchKey,
      set: {
        accountId: input.accountId,
        updatedAt: input.now,
      },
    })
    .run();
}

export async function findLinkedInvoiceId(
  db: D1Database,
  transactionId: string,
) {
  const row = await createDrizzle(db)
    .select({
      invoiceId: invoiceTransactionPreferences.invoiceId,
    })
    .from(invoiceTransactionPreferences)
    .where(
      and(
        eq(invoiceTransactionPreferences.transactionId, transactionId),
        eq(invoiceTransactionPreferences.decision, "linked"),
      ),
    )
    .get();
  return row?.invoiceId;
}

export async function findInvoiceTransactionPreference(
  db: D1Database,
  invoiceId: string,
) {
  return (
    (await createDrizzle(db)
      .select({
        transactionId: invoiceTransactionPreferences.transactionId,
        decision: sql<"linked" | "separate" | "cash">`
          ${invoiceTransactionPreferences.decision}
        `,
      })
      .from(invoiceTransactionPreferences)
      .where(eq(invoiceTransactionPreferences.invoiceId, invoiceId))
      .get()) ?? null
  );
}

export async function upsertInvoiceTransactionPreference(
  db: D1Database,
  input: {
    invoiceId: string;
    transactionId: string | null;
    decision: "linked" | "separate" | "cash";
    now: string;
  },
) {
  await createDrizzle(db)
    .insert(invoiceTransactionPreferences)
    .values({
      invoiceId: input.invoiceId,
      transactionId: input.transactionId,
      decision: input.decision,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: invoiceTransactionPreferences.invoiceId,
      set: {
        transactionId: input.transactionId,
        decision: input.decision,
        updatedAt: input.now,
      },
    })
    .run();
}
