import {
  findPaymentAccount,
  findLinkedInvoiceId,
  findInvoiceTransactionPreference,
  findMappingInvoice,
  findMappingTransaction,
  saveInvoiceCashPayment,
  saveInvoiceLinkedTransaction,
  saveInvoicePaymentAccount,
  upsertInvoiceTransactionPreference,
} from "./repository";
import {
  invoicePaymentMatchKey,
  isInvoicePaymentExpense,
} from "@taiwan-fin-hub/core";
import { listInvoiceItems } from "../invoices/repository";

export class MappingInvoiceNotFoundError extends Error {}
export class MappingTransactionNotFoundError extends Error {}
export class MappingTransactionUnavailableError extends Error {}
export class MappingDateMismatchError extends Error {}
export class MappingTransactionNotExpenseError extends Error {}
export class MappingInvoiceAlreadyLinkedError extends Error {}
export class MappingPaymentAccountNotFoundError extends Error {}
export class MappingPaymentAccountConflictError extends Error {}

const taipeiDayFormatter = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function financialDay(value?: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const parts = Object.fromEntries(
    taipeiDayFormatter
      .formatToParts(parsed)
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function linkInvoiceToTransaction(
  db: D1Database,
  invoiceId: string,
  transactionId: string,
) {
  const [invoice, transaction, items] = await Promise.all([
    findMappingInvoice(db, invoiceId),
    findMappingTransaction(db, transactionId),
    listInvoiceItems(db, [invoiceId]),
  ]);
  if (!invoice) throw new MappingInvoiceNotFoundError();
  if (!transaction) throw new MappingTransactionNotFoundError();

  const invoiceDay = financialDay(invoice.invoiceDate);
  const transactionDay = financialDay(
    transaction.authorizedAt ?? transaction.postedDate?.slice(0, 10),
  );
  if (!invoiceDay || !transactionDay || invoiceDay !== transactionDay)
    throw new MappingDateMismatchError();

  const isExpense = isInvoicePaymentExpense(transaction);
  if (!isExpense) throw new MappingTransactionNotExpenseError();

  const linkedInvoiceId = await findLinkedInvoiceId(db, transactionId);
  if (linkedInvoiceId && linkedInvoiceId !== invoiceId)
    throw new MappingTransactionUnavailableError();

  const now = new Date().toISOString();
  const matchKey = invoicePaymentMatchKey(
    invoice.sellerName,
    items.map((item) => item.description),
  );
  await saveInvoiceLinkedTransaction(db, {
    invoiceId,
    transactionId,
    accountId: transaction.accountId,
    isCard: transaction.accountType === "credit",
    matchKey,
    now,
  });
  return {
    invoiceId,
    transactionId,
    decision: "linked" as const,
    updatedAt: now,
  };
}

export async function rememberInvoicePaymentAccount(
  db: D1Database,
  invoiceId: string,
  accountId: string,
) {
  const [invoice, account, items] = await Promise.all([
    findMappingInvoice(db, invoiceId),
    findPaymentAccount(db, accountId),
    listInvoiceItems(db, [invoiceId]),
  ]);
  if (!invoice) throw new MappingInvoiceNotFoundError();
  if (!account) throw new MappingPaymentAccountNotFoundError();

  const preference = await findInvoiceTransactionPreference(db, invoiceId);
  if (preference?.decision === "linked" && preference.transactionId) {
    const transaction = await findMappingTransaction(
      db,
      preference.transactionId,
    );
    if (transaction?.accountId !== account.id)
      throw new MappingPaymentAccountConflictError();
  }

  const matchKey = invoicePaymentMatchKey(
    invoice.sellerName,
    items.map((item) => item.description),
  );
  const now = new Date().toISOString();
  await saveInvoicePaymentAccount(db, {
    invoiceId,
    matchKey,
    accountId: account.id,
    now,
  });
  return { invoiceId, matchKey, accountId: account.id, updatedAt: now };
}

export async function keepInvoiceSeparate(db: D1Database, invoiceId: string) {
  if (!(await findMappingInvoice(db, invoiceId)))
    throw new MappingInvoiceNotFoundError();

  const now = new Date().toISOString();
  await upsertInvoiceTransactionPreference(db, {
    invoiceId,
    transactionId: null,
    decision: "separate",
    now,
  });
  return {
    invoiceId,
    transactionId: null,
    decision: "separate" as const,
    updatedAt: now,
  };
}

export async function markInvoiceAsCashPayment(
  db: D1Database,
  invoiceId: string,
) {
  if (!(await findMappingInvoice(db, invoiceId)))
    throw new MappingInvoiceNotFoundError();
  const preference = await findInvoiceTransactionPreference(db, invoiceId);
  if (preference?.decision === "linked" && preference.transactionId) {
    throw new MappingInvoiceAlreadyLinkedError();
  }

  const now = new Date().toISOString();
  await saveInvoiceCashPayment(db, invoiceId, now);
  return {
    invoiceId,
    transactionId: null,
    decision: "cash" as const,
    updatedAt: now,
  };
}
