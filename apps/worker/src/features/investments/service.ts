import {
  listInvestmentTransactions,
  listInvestmentTransactionsInRange,
  listLatestInvestmentPositions,
  findInvestmentPositionById,
  deleteInvestmentTransactionAmount,
  upsertInvestmentPositionCost,
  upsertInvestmentTransactionAmount,
  type InvestmentPageCursor,
  type TransactionPageCursor,
} from "./repository";
import type { MonthDateRange } from "../../platform/month-range";
import { getManualInvestmentHoldings } from "../manual-assets/service";

export async function getInvestmentPage(
  db: D1Database,
  limit: number,
  cursor?: InvestmentPageCursor,
) {
  const rows = await listLatestInvestmentPositions(db, limit + 1, cursor);
  const costedRows = rows.map((row) => ({
    ...row,
    costBasis:
      row.quantity != null && row.costPerShare != null
        ? Math.round(row.quantity * row.costPerShare)
        : null,
  }));
  const manualRows = (await getManualInvestmentHoldings(db)).filter((row) =>
    isAfterCursor(row, cursor),
  );
  const allRows = [...costedRows, ...manualRows].sort(comparePositions);
  const hasMore = allRows.length > limit;
  const positions = allRows.slice(0, limit);
  return { hasMore, positions, last: positions.at(-1) };
}

export async function setInvestmentPositionCost(
  db: D1Database,
  id: string,
  costPerShare: number,
) {
  const position = await findInvestmentPositionById(db, id);
  if (!position) return false;
  const suffix = `:${position.asOfDate}`;
  if (!position.sourceId.endsWith(suffix)) return false;
  await upsertInvestmentPositionCost(db, {
    connectorId: position.connectorId,
    holdingKey: position.sourceId.slice(0, -suffix.length),
    costPerShare,
    currency: position.currency,
  });
  return true;
}

export function setInvestmentTransactionAmount(
  db: D1Database,
  transactionId: string,
  amount: number,
  options?: {
    source?: "manual" | "historical-close";
    referencePrice?: number;
    priceDate?: string;
    provider?: string;
  },
) {
  return upsertInvestmentTransactionAmount(db, {
    transactionId,
    amount,
    ...options,
  });
}

export function clearInvestmentTransactionAmount(
  db: D1Database,
  transactionId: string,
) {
  return deleteInvestmentTransactionAmount(db, transactionId);
}

function comparePositions(
  left: { asOfDate: string; assetType: string; name: string; id: string },
  right: { asOfDate: string; assetType: string; name: string; id: string },
) {
  return (
    right.asOfDate.localeCompare(left.asOfDate) ||
    left.assetType.localeCompare(right.assetType) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

function isAfterCursor(
  row: { asOfDate: string; assetType: string; name: string; id: string },
  cursor?: InvestmentPageCursor,
) {
  if (!cursor) return true;
  return (
    row.asOfDate < cursor.asOfDate ||
    (row.asOfDate === cursor.asOfDate &&
      (row.assetType > cursor.assetType ||
        (row.assetType === cursor.assetType &&
          (row.name > cursor.name ||
            (row.name === cursor.name && row.id > cursor.id)))))
  );
}

export async function getInvestmentTransactionPage(
  db: D1Database,
  limit: number,
  cursor?: TransactionPageCursor,
) {
  const rows = await listInvestmentTransactions(db, limit + 1, cursor);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    hasMore,
    last,
    transactions: page.map(
      ({
        effectiveDate: _effectiveDate,
        updatedAt: _updatedAt,
        ...transaction
      }) => transaction,
    ),
  };
}

export async function getInvestmentTransactionsRange(
  db: D1Database,
  range: MonthDateRange,
  days?: string[],
) {
  const rows = await listInvestmentTransactionsInRange(db, range, days);
  return rows.map(
    ({
      effectiveDate: _effectiveDate,
      updatedAt: _updatedAt,
      ...transaction
    }) => transaction,
  );
}
