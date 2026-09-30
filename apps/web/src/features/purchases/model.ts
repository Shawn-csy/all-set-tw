import type {
  InvoiceLineItemRow,
  InvoiceSummaryRow,
} from "@/data/invoices/types";
import {
  resolveInvoiceLineSettlements,
  type InvoiceLineSettlement,
} from "@taiwan-fin-hub/core";

export type PurchaseLineKind = "item" | "allowance" | "refund" | "fee";

export interface PurchaseLineView {
  invoice: InvoiceSummaryRow;
  line: InvoiceLineItemRow;
  kind: PurchaseLineKind;
  displayAmount: number;
  originalAmount: number;
  settlement: InvoiceLineSettlement;
}

export interface PurchaseItemSummary {
  key: string;
  description: string;
  lineCount: number;
  invoiceCount: number;
  quantity: number;
  amount: number;
  originalAmount: number;
  redeemedCount: number;
  lastPurchasedAt: string;
  averageUnitPrice?: number;
  merchants: string[];
  lines: PurchaseLineView[];
}

export interface PurchaseCategorySummary {
  id: string;
  label: string;
  lineCount: number;
  invoiceCount: number;
  itemCount: number;
  amount: number;
  items: PurchaseItemSummary[];
}

export interface PurchaseChargeSummary {
  description: string;
  count: number;
  amount: number;
  lastAppliedAt: string;
}

export interface InvoiceReconciliation {
  invoice: InvoiceSummaryRow;
  lineTotal: number;
  rawLineTotal: number;
  redeemedAmount: number;
  invoiceTotal: number;
  delta: number;
}

export interface PurchaseAdjustmentSummary {
  description: string;
  kind: "allowance" | "refund";
  count: number;
  amount: number;
  lastAppliedAt: string;
}

export function purchaseLineKind(line: InvoiceLineItemRow): PurchaseLineKind {
  if (line.lineType === "allowance" || line.lineType === "refund")
    return line.lineType;
  if (line.lineType === "fee") return "fee";
  // Legacy rows were stored as item even when the provider returned a
  // negative promotion / points amount.
  if (line.amount < 0) return "allowance";
  return "item";
}

export function purchaseLineDisplayAmount(line: InvoiceLineItemRow) {
  const kind = purchaseLineKind(line);
  return kind === "allowance" || kind === "refund"
    ? Math.abs(line.amount)
    : line.amount;
}

export function flattenPurchaseLines(invoices: InvoiceSummaryRow[]) {
  return invoices.flatMap<PurchaseLineView>((invoice) => {
    const items = invoice.items ?? [];
    const settlements = resolveInvoiceLineSettlements(invoice.amount, items);
    return items.map((line, index) => {
      const kind = purchaseLineKind(line);
      const settlement = settlements[index] ?? {
        paidAmount: Math.max(0, line.amount),
        settlement: "paid" as const,
      };
      return {
        invoice,
        line,
        kind,
        displayAmount:
          kind === "item" || kind === "fee"
            ? settlement.paidAmount
            : purchaseLineDisplayAmount(line),
        originalAmount:
          kind === "item" || kind === "fee" ? Math.max(0, line.amount) : 0,
        settlement: settlement.settlement,
      };
    });
  });
}

function normalizedDescription(description: string) {
  return description.trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-TW");
}

export function aggregatePurchaseItems(lines: PurchaseLineView[]) {
  const summaries = new Map<
    string,
    PurchaseItemSummary & {
      invoiceIds: Set<string>;
      merchantNames: Set<string>;
    }
  >();

  for (const row of lines) {
    if (row.kind !== "item") continue;
    // E-invoice payloads can contain zero-value notes, payment metadata, and
    // carrier fields. They are not useful as purchased products.
    if (row.displayAmount <= 0 && row.settlement !== "redeemed") continue;
    const description = row.line.description.trim().replace(/\s+/gu, " ");
    const key = normalizedDescription(description);
    if (!key) continue;

    const current = summaries.get(key) ?? {
      key,
      description,
      lineCount: 0,
      invoiceCount: 0,
      quantity: 0,
      amount: 0,
      originalAmount: 0,
      redeemedCount: 0,
      lastPurchasedAt: row.invoice.invoiceDate,
      averageUnitPrice: undefined,
      merchants: [],
      lines: [],
      invoiceIds: new Set<string>(),
      merchantNames: new Set<string>(),
    };
    current.lineCount += 1;
    current.invoiceIds.add(row.invoice.id);
    current.quantity +=
      row.line.quantity != null && Number.isFinite(row.line.quantity)
        ? Math.abs(row.line.quantity)
        : 0;
    current.amount += Math.max(0, row.displayAmount);
    current.originalAmount += row.originalAmount;
    if (row.settlement === "redeemed") current.redeemedCount += 1;
    current.lines.push(row);
    const merchant = row.line.merchantName ?? row.invoice.sellerName;
    if (merchant) current.merchantNames.add(merchant);
    if (
      new Date(row.invoice.invoiceDate).getTime() >
      new Date(current.lastPurchasedAt).getTime()
    ) {
      current.lastPurchasedAt = row.invoice.invoiceDate;
    }
    current.averageUnitPrice =
      current.quantity > 0 ? current.amount / current.quantity : undefined;
    summaries.set(key, current);
  }

  return [...summaries.values()]
    .map(({ invoiceIds, merchantNames, ...summary }) => ({
      ...summary,
      invoiceCount: invoiceIds.size,
      merchants: [...merchantNames].sort((a, b) => a.localeCompare(b, "zh-TW")),
    }))
    .sort(
      (a, b) =>
        b.amount - a.amount ||
        b.lineCount - a.lineCount ||
        a.description.localeCompare(b.description, "zh-TW"),
    );
}

export function aggregatePurchaseCategories(lines: PurchaseLineView[]) {
  const groups = new Map<
    string,
    { id: string; label: string; lines: PurchaseLineView[] }
  >();

  for (const row of lines) {
    if (
      row.kind !== "item" ||
      (row.displayAmount <= 0 && row.settlement !== "redeemed")
    )
      continue;
    const id = row.line.classification?.categoryId ?? "other";
    const label = row.line.classification?.label ?? "未分類";
    const group = groups.get(id) ?? { id, label, lines: [] };
    group.lines.push(row);
    groups.set(id, group);
  }

  return [...groups.values()]
    .map((group): PurchaseCategorySummary => {
      const items = aggregatePurchaseItems(group.lines);
      const invoiceIds = new Set(group.lines.map((row) => row.invoice.id));
      return {
        id: group.id,
        label: group.label,
        lineCount: group.lines.length,
        invoiceCount: invoiceIds.size,
        itemCount: items.length,
        amount: items.reduce((sum, item) => sum + item.amount, 0),
        items,
      };
    })
    .sort(
      (a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "zh-TW"),
    );
}

export function aggregatePurchaseCharges(lines: PurchaseLineView[]) {
  const summaries = new Map<string, PurchaseChargeSummary>();

  for (const row of lines) {
    if (row.kind !== "fee" || row.displayAmount <= 0) continue;
    const description = row.line.description.trim().replace(/\s+/gu, " ");
    const key = normalizedDescription(description);
    if (!key) continue;
    const current = summaries.get(key) ?? {
      description,
      count: 0,
      amount: 0,
      lastAppliedAt: row.invoice.invoiceDate,
    };
    current.count += 1;
    current.amount += row.displayAmount;
    if (
      new Date(row.invoice.invoiceDate).getTime() >
      new Date(current.lastAppliedAt).getTime()
    ) {
      current.lastAppliedAt = row.invoice.invoiceDate;
    }
    summaries.set(key, current);
  }

  return [...summaries.values()].sort(
    (a, b) =>
      b.amount - a.amount ||
      b.count - a.count ||
      a.description.localeCompare(b.description, "zh-TW"),
  );
}

export function reconcileInvoice(
  invoice: InvoiceSummaryRow,
): InvoiceReconciliation {
  const lines = flattenPurchaseLines([invoice]);
  const lineTotal = lines.reduce(
    (sum, row) =>
      sum +
      (row.kind === "allowance" || row.kind === "refund"
        ? -row.displayAmount
        : row.displayAmount),
    0,
  );
  const rawLineTotal = (invoice.items ?? []).reduce(
    (sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0),
    0,
  );
  return {
    invoice,
    lineTotal,
    rawLineTotal,
    redeemedAmount: lines
      .filter((row) => row.settlement === "redeemed")
      .reduce((sum, row) => sum + row.originalAmount, 0),
    invoiceTotal: invoice.amount,
    delta: lineTotal - invoice.amount,
  };
}

export function aggregatePurchaseAdjustments(lines: PurchaseLineView[]) {
  const summaries = new Map<string, PurchaseAdjustmentSummary>();

  for (const row of lines) {
    if (row.kind !== "allowance" && row.kind !== "refund") continue;
    const description = row.line.description.trim().replace(/\s+/gu, " ");
    const key = `${row.kind}:${normalizedDescription(description)}`;
    const current = summaries.get(key) ?? {
      description,
      kind: row.kind,
      count: 0,
      amount: 0,
      lastAppliedAt: row.invoice.invoiceDate,
    };
    current.count += 1;
    current.amount += row.displayAmount;
    if (
      new Date(row.invoice.invoiceDate).getTime() >
      new Date(current.lastAppliedAt).getTime()
    ) {
      current.lastAppliedAt = row.invoice.invoiceDate;
    }
    summaries.set(key, current);
  }

  return [...summaries.values()].sort(
    (a, b) =>
      b.amount - a.amount ||
      b.count - a.count ||
      a.description.localeCompare(b.description, "zh-TW"),
  );
}
