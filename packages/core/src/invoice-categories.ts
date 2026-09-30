import type { ClassificationBehavior } from "./activity-types";
import type { InvoiceLineType } from "./index";

export interface InvoiceCategoryLine {
  id?: string;
  description?: string;
  amount: number;
  /** Effective cash amount after provider-side redemption or points usage. */
  paidAmount?: number;
  settlement?: InvoiceLineSettlement;
  lineType?: InvoiceLineType;
  classification?: {
    categoryId: string;
    label: string;
    behavior?: ClassificationBehavior;
  };
}

export type InvoiceLineSettlement = "paid" | "redeemed";

export interface InvoiceLineSettlementResult {
  paidAmount: number;
  settlement: InvoiceLineSettlement;
}

/**
 * Detect provider payloads where an item is listed at its face value but the
 * invoice total excludes it because it was redeemed with points or a voucher.
 *
 * This intentionally only marks a line as redeemed when the positive item
 * amounts have a best subset that reconciles exactly with the invoice total
 * after allowances/refunds. The subset that keeps the most ordinary items is
 * preferred; ties remain ambiguous and keep their original amounts.
 */
export function resolveInvoiceLineSettlements(
  invoiceAmount: number,
  items: readonly InvoiceCategoryLine[] = [],
): InvoiceLineSettlementResult[] {
  const result: InvoiceLineSettlementResult[] = items.map((item) => ({
    paidAmount: Math.max(0, item.amount),
    settlement: "paid" as const,
  }));
  const positive = items
    .map((item, index) => ({ item, index, amount: Math.round(item.amount) }))
    .filter(
      (entry) =>
        entry.amount > 0 &&
        (entry.item.lineType === undefined ||
          entry.item.lineType === "item" ||
          entry.item.lineType === "fee"),
    );
  if (positive.length === 0) return result;

  const adjustments = items
    .filter((item) => Number.isFinite(item.amount) && item.amount < 0)
    .reduce((sum, item) => sum + Math.round(item.amount), 0);
  const target = Math.round(Math.abs(invoiceAmount) - adjustments);
  const positiveTotal = positive.reduce((sum, entry) => sum + entry.amount, 0);
  if (target < 0 || positiveTotal <= target) return result;

  const subset = bestSubsetForTarget(
    positive.map((entry) => entry.amount),
    target,
  );
  if (!subset || subset.size === positive.length) return result;

  positive.forEach((entry, position) => {
    if (subset.has(position)) return;
    result[entry.index] = { paidAmount: 0, settlement: "redeemed" };
  });
  return result;
}

function bestSubsetForTarget(values: number[], target: number) {
  const paths = new Map<number, { count: number; path: string | null }>([
    [0, { count: 0, path: "" }],
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const next = new Map(paths);
    for (const [sum, state] of paths) {
      if (state.path === null) continue;
      const nextSum = sum + value;
      if (nextSum > target) continue;
      const nextPath = state.path ? `${state.path},${index}` : `${index}`;
      const nextState = { count: state.count + 1, path: nextPath };
      const previous = next.get(nextSum);
      if (!previous || previous.count < nextState.count) {
        next.set(nextSum, nextState);
      } else if (
        previous.count === nextState.count &&
        previous.path !== nextState.path
      ) {
        next.set(nextSum, { count: nextState.count, path: null });
      }
    }
    paths.clear();
    for (const [sum, state] of next) paths.set(sum, state);
  }
  const state = paths.get(target);
  if (!state || state.path === null) return undefined;
  if (state.path === "") return new Set<number>();
  return new Set(state.path.split(",").map(Number));
}

export interface InvoiceCategoryPart {
  itemId?: string;
  description?: string;
  categoryId: string;
  category: string;
  amount: number;
  behavior: ClassificationBehavior;
}

const uncategorized = (amount: number): InvoiceCategoryPart => ({
  categoryId: "other",
  category: "未分類",
  amount,
  behavior: "normal",
});

/**
 * Allocate the paid amount by positive invoice line items. Discounts reduce
 * items proportionally; missing item value stays visibly uncategorized.
 */
export function allocateInvoiceCategories(
  invoiceAmount: number,
  paidAmount: number,
  items: readonly InvoiceCategoryLine[] = [],
): InvoiceCategoryPart[] {
  const target = Math.max(0, Math.round(Math.abs(paidAmount)));
  const invoiceTotal = Math.max(0, Math.abs(invoiceAmount));
  const settlements = resolveInvoiceLineSettlements(invoiceAmount, items);
  const positive = items
    .map((item, index) => ({ item, settlement: settlements[index]! }))
    .filter(
      (item) =>
        Number.isFinite(item.item.amount) &&
        item.settlement.paidAmount > 0 &&
        (item.item.lineType === undefined ||
          item.item.lineType === "item" ||
          item.item.lineType === "fee"),
    );
  const itemTotal = positive.reduce(
    (sum, item) => sum + item.settlement.paidAmount,
    0,
  );
  if (target === 0) return [];
  if (invoiceTotal === 0 || itemTotal === 0) return [uncategorized(target)];

  const scale = itemTotal > invoiceTotal ? invoiceTotal / itemTotal : 1;
  const weights = positive.map((item) => item.settlement.paidAmount * scale);
  const missing = Math.max(0, invoiceTotal - itemTotal);
  if (missing > 0) weights.push(missing);

  const provisional = weights.map((weight, index) => {
    const exact = (weight / invoiceTotal) * target;
    return { index, floor: Math.floor(exact), fraction: exact % 1 };
  });
  const amounts = provisional.map(({ floor }) => floor);
  const remainder = target - amounts.reduce((sum, value) => sum + value, 0);
  for (const { index } of [...provisional]
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    .slice(0, remainder)) {
    amounts[index]! += 1;
  }

  const parts = positive.map((entry, index): InvoiceCategoryPart => ({
    itemId: entry.item.id,
    description: entry.item.description,
    categoryId: entry.item.classification?.categoryId ?? "other",
    category: entry.item.classification?.label ?? "未分類",
    amount: amounts[index] ?? 0,
    behavior: entry.item.classification?.behavior ?? "normal",
  }));
  if (missing > 0) parts.push(uncategorized(amounts.at(-1) ?? 0));
  return parts.filter((part) => part.amount > 0);
}

export function countedInvoiceAmount(parts: readonly InvoiceCategoryPart[]) {
  return parts.reduce(
    (sum, part) => sum + (part.behavior === "normal" ? part.amount : 0),
    0,
  );
}
