import {
  fetchHistoricalClose,
  type MarketDataFetcher,
} from "@taiwan-fin-hub/connectors";
import {
  listInvestmentTransactions,
  listInvestmentTransactionsInRange,
  listInvestmentTransactionsThrough,
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
  fetcher?: MarketDataFetcher,
) {
  let rows = await listInvestmentTransactions(db, limit + 1, cursor);
  if (fetcher && (await fillMissingHistoricalAmounts(db, rows, fetcher)) > 0) {
    rows = await listInvestmentTransactions(db, limit + 1, cursor);
  }
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
  fetcher?: MarketDataFetcher,
) {
  let rows = await listInvestmentTransactionsInRange(db, range, days);
  if (fetcher && (await fillMissingHistoricalAmounts(db, rows, fetcher)) > 0) {
    rows = await listInvestmentTransactionsInRange(db, range, days);
  }
  const realizedProfitById = await calculateRealizedProfits(
    db,
    range.to,
    fetcher,
  );
  return rows.map(
    ({
      effectiveDate: _effectiveDate,
      updatedAt: _updatedAt,
      ...transaction
    }) => ({
      ...transaction,
      realizedProfit: realizedProfitById.get(transaction.id) ?? null,
    }),
  );
}

type InvestmentTransactionHistoryRow = Awaited<
  ReturnType<typeof listInvestmentTransactionsThrough>
>[number];

async function calculateRealizedProfits(
  db: D1Database,
  to: string,
  fetcher?: MarketDataFetcher,
) {
  let history = await listInvestmentTransactionsThrough(db, to);
  if (fetcher && (await fillMissingHistoricalAmounts(db, history, fetcher)) > 0)
    history = await listInvestmentTransactionsThrough(db, to);
  const lotsByKey = new Map<string, CostLot[]>();
  const realizedProfitById = new Map<string, number>();

  for (const transaction of history) {
    const kind = investmentTransactionKind(transaction);
    const quantity =
      transaction.quantity == null ? undefined : Math.abs(transaction.quantity);
    const amount =
      transaction.amount == null ? undefined : Math.abs(transaction.amount);
    if (quantity == null || !Number.isFinite(quantity) || quantity <= 0)
      continue;

    const key = investmentCostKey(transaction);
    const lots = lotsByKey.get(key) ?? [];
    if (kind === "buy") {
      lots.push({
        quantity,
        cost: amount == null || !Number.isFinite(amount) ? null : amount,
      });
      lotsByKey.set(key, lots);
      continue;
    }
    if (kind !== "sell") continue;

    let remaining = quantity;
    let cost = 0;
    let costKnown = true;
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0]!;
      const consumed = Math.min(remaining, lot.quantity);
      if (lot.cost == null) {
        costKnown = false;
      } else {
        cost += lot.cost * (consumed / lot.quantity);
      }
      lot.quantity -= consumed;
      remaining -= consumed;
      if (lot.quantity <= 0.00000001) lots.shift();
    }
    if (amount != null && costKnown && remaining <= 0.00000001) {
      realizedProfitById.set(transaction.id, Math.round(amount - cost));
    }
    if (lots.length > 0 || remaining > 0) lotsByKey.set(key, lots);
    else lotsByKey.delete(key);
  }

  return realizedProfitById;
}

type CostLot = { quantity: number; cost: number | null };

function investmentCostKey(
  transaction: Pick<
    InvestmentTransactionHistoryRow,
    "accountId" | "symbol" | "name" | "currency"
  >,
) {
  return `${transaction.accountId}:${transaction.symbol ?? transaction.name ?? "unknown"}:${transaction.currency}`;
}

function investmentTransactionKind(
  transaction: Pick<
    InvestmentTransactionHistoryRow,
    "transactionCode" | "transactionName"
  >,
) {
  const text = `${transaction.transactionName ?? ""} ${transaction.transactionCode ?? ""}`;
  const code = transaction.transactionCode?.trim();
  if (/股利|股息|配息|除權息|利息|dividend|interest/i.test(text))
    return "income";
  if (code === "600" || /買賣相抵/u.test(text)) return "other";
  if (
    code === "123" ||
    /賣|卖|出售|贖回|赎回|回贖|sell|redemption|redeem/i.test(text)
  )
    return "sell";
  if (code === "113" || /買|买|申購|申购|purchase|buy/i.test(text))
    return "buy";
  return "other";
}

type InvestmentTransactionCandidate = {
  id: string;
  connectorId: string;
  symbol: string | null;
  tradeDate: string | null;
  postedDate: string | null;
  transactionCode: string | null;
  transactionName: string | null;
  quantity: number | null;
  amount: number | null;
  rawAmount: number | null;
};

/**
 * TDCC trade history often has no cash amount and reports `1` as a price
 * placeholder. Fill that gap with a clearly labelled historical-close
 * estimate so the returns page does not require hand entry for every trade.
 */
async function fillMissingHistoricalAmounts(
  db: D1Database,
  rows: InvestmentTransactionCandidate[],
  fetcher: MarketDataFetcher,
) {
  const candidates = rows.filter(isHistoricalAmountCandidate);
  const groups = new Map<string, { symbol: string; tradeDate: string }>();
  for (const row of candidates) {
    const symbol = row.symbol?.trim();
    const tradeDate = investmentTradeDate(row);
    if (!symbol || !tradeDate) continue;
    groups.set(`${symbol}:${tradeDate}`, { symbol, tradeDate });
  }

  const quotes = new Map<
    string,
    Awaited<ReturnType<typeof fetchHistoricalClose>>
  >();
  const entries = [...groups.entries()];
  let nextIndex = 0;
  const workerCount = Math.min(6, entries.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < entries.length) {
        const index = nextIndex;
        nextIndex += 1;
        const [key, group] = entries[index]!;
        quotes.set(
          key,
          await fetchHistoricalClose(group.symbol, group.tradeDate, fetcher),
        );
      }
    }),
  );

  let filled = 0;
  for (const row of candidates) {
    const symbol = row.symbol?.trim();
    const tradeDate = investmentTradeDate(row);
    if (!symbol || !tradeDate || row.quantity == null) continue;
    const quote = quotes.get(`${symbol}:${tradeDate}`);
    if (!quote) continue;
    const amount = Math.round(Math.abs(row.quantity) * quote.price);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (
      await upsertInvestmentTransactionAmount(db, {
        transactionId: row.id,
        amount,
        source: "historical-close",
        referencePrice: quote.price,
        priceDate: quote.tradeDate,
        provider: quote.provider,
      })
    ) {
      filled += 1;
    }
  }
  return filled;
}

function investmentTradeDate(row: {
  tradeDate: string | null;
  postedDate: string | null;
}) {
  return (row.tradeDate ?? row.postedDate)?.slice(0, 10);
}

function isHistoricalAmountCandidate(row: InvestmentTransactionCandidate) {
  if (
    row.connectorId !== "tdcc" ||
    row.amount != null ||
    row.rawAmount != null ||
    row.quantity == null ||
    !Number.isFinite(row.quantity) ||
    row.quantity === 0
  ) {
    return false;
  }
  const code = row.transactionCode?.trim();
  if (code === "113" || code === "123") return true;
  return /買|賣|贖回|回贖|buy|sell|redemption|redeem/i.test(
    `${row.transactionName ?? ""} ${row.transactionCode ?? ""}`,
  );
}
