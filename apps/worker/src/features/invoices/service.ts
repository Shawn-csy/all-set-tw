import {
  deleteInvoiceMerchantOverride,
  findInvoice,
  listInvoiceItems,
  listInvoices,
  listInvoicesInRange,
  upsertInvoiceMerchantOverride,
  type InvoicePageCursor,
  type InvoiceRow,
} from "./repository";
import type { MonthDateRange } from "../../platform/month-range";
import { invoicePaymentMatchKey } from "@taiwan-fin-hub/core";
import { resolveClassifications } from "../classification/service";
import { findClassificationMerchant } from "../classification/service";

export class InvoiceNotFoundError extends Error {}
export class InvoiceMerchantNotFoundError extends Error {}

export async function getInvoicePage(
  db: D1Database,
  limit: number,
  cursor?: InvoicePageCursor,
) {
  const rows = await listInvoices(db, limit + 1, cursor);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    hasMore,
    last: page.at(-1),
    invoices: page.map(presentInvoiceSummary),
  };
}

export async function getInvoicesRange(
  db: D1Database,
  range: MonthDateRange,
  days?: string[],
) {
  const rows = await listInvoicesInRange(db, range, days);
  const items = await classifyInvoiceItems(
    db,
    await listInvoiceItems(
      db,
      rows.map((row) => row.id),
    ),
  );
  const itemsByInvoice = new Map<string, typeof items>();
  for (const item of items) {
    const current = itemsByInvoice.get(item.invoiceId) ?? [];
    current.push(item);
    itemsByInvoice.set(item.invoiceId, current);
  }
  return rows.map((row) => {
    const invoiceItems = itemsByInvoice.get(row.id) ?? [];
    return {
      ...presentInvoiceSummary(row),
      paymentMatchKey: invoicePaymentMatchKey(
        row.sellerName,
        invoiceItems.map((item) => item.description),
      ),
      items: invoiceItems.map(({ invoiceId: _invoiceId, ...item }) => item),
    };
  });
}

/** Month-filtered list responses are summaries; load line items only for detail/activity views. */
export async function getInvoiceSummaryRange(
  db: D1Database,
  range: MonthDateRange,
  days?: string[],
) {
  const rows = await listInvoicesInRange(db, range, days);
  return rows.map(presentInvoiceSummary);
}

export async function getInvoiceDetail(db: D1Database, invoiceId: string) {
  const invoice = await findInvoice(db, invoiceId);
  if (!invoice) throw new InvoiceNotFoundError();
  const items = await classifyInvoiceItems(
    db,
    await listInvoiceItems(db, [invoiceId]),
  );
  return presentInvoice(
    invoice,
    items.map(({ invoiceId: _invoiceId, ...item }) => item),
  );
}

export async function setInvoiceMerchant(
  db: D1Database,
  invoiceId: string,
  merchantId: string,
) {
  const [invoice, merchant] = await Promise.all([
    findInvoice(db, invoiceId),
    findClassificationMerchant(db, merchantId),
  ]);
  if (!invoice) throw new InvoiceNotFoundError();
  if (!merchant) throw new InvoiceMerchantNotFoundError();
  await upsertInvoiceMerchantOverride(db, {
    invoiceId,
    merchantId,
    now: new Date().toISOString(),
  });
  return { invoiceId, merchantId, merchantName: merchant.name };
}

export async function clearInvoiceMerchant(db: D1Database, invoiceId: string) {
  if (!(await findInvoice(db, invoiceId))) throw new InvoiceNotFoundError();
  await deleteInvoiceMerchantOverride(db, invoiceId);
  return { invoiceId, merchantId: null, merchantName: null };
}

async function classifyInvoiceItems(
  db: D1Database,
  items: Awaited<ReturnType<typeof listInvoiceItems>>,
) {
  if (items.length === 0) return [];
  const classifications = await resolveClassifications(
    db,
    items
      .filter((item) => item.lineType === "item" || item.lineType === "fee")
      .map((item) => ({
        id: item.id,
        sourceId: item.sourceId,
        merchantId: item.merchantId,
        merchantName: item.merchantName,
        description: item.description,
        amount: -Math.abs(item.amount),
      })),
    "invoice_item",
  );
  return items.map((item) => ({
    ...item,
    classification: classifications.get(item.id),
  }));
}

function presentInvoice<T extends Omit<InvoiceRow, "updatedAt"> | InvoiceRow>(
  invoice: T,
  items: Omit<
    Awaited<ReturnType<typeof classifyInvoiceItems>>[number],
    "invoiceId"
  >[],
) {
  return {
    ...presentInvoiceSummary(invoice),
    items,
  };
}

function presentInvoiceSummary<
  T extends Omit<InvoiceRow, "updatedAt"> | InvoiceRow,
>(invoice: T) {
  const {
    updatedAt: _updatedAt,
    classificationMerchantId,
    classificationMerchantName,
    ...presented
  } = invoice as InvoiceRow;
  return {
    ...presented,
    invoiceNumber: invoice.invoiceNumber ?? undefined,
    sellerName: invoice.sellerName ?? undefined,
    classificationMerchant:
      classificationMerchantId && classificationMerchantName
        ? {
            id: classificationMerchantId,
            name: classificationMerchantName,
          }
        : undefined,
  };
}
