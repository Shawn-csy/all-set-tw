import {
  createDrizzle,
  investmentTransactionAmountOverrides,
  investmentPositionCostOverrides,
  investmentPositions,
  investmentTransactions,
} from "@taiwan-fin-hub/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { MonthDateRange } from "../../platform/month-range";

const amountOverride = alias(
  investmentTransactionAmountOverrides,
  "amount_override",
);

const investmentTransactionColumns = {
  id: investmentTransactions.id,
  connectorId: investmentTransactions.connectorId,
  accountId: investmentTransactions.accountId,
  sourceId: investmentTransactions.sourceId,
  brokerNo: investmentTransactions.brokerNo,
  brokerAccount: investmentTransactions.brokerAccount,
  brokerName: investmentTransactions.brokerName,
  symbol: investmentTransactions.symbol,
  name: investmentTransactions.name,
  assetType: investmentTransactions.assetType,
  tradeDate: investmentTransactions.tradeDate,
  postedDate: investmentTransactions.postedDate,
  transactionCode: investmentTransactions.transactionCode,
  transactionName: investmentTransactions.transactionName,
  quantity: investmentTransactions.quantity,
  price: investmentTransactions.price,
  amount: sql<
    number | null
  >`COALESCE(${amountOverride.amount}, ${investmentTransactions.amount})`.as(
    "amount",
  ),
  rawAmount: investmentTransactions.amount,
  amountSource: sql<"synced" | "manual" | "historical-close" | "missing">`CASE
    WHEN ${amountOverride.amount} IS NOT NULL
      AND ${amountOverride.source} = 'historical-close'
      THEN 'historical-close'
    WHEN ${amountOverride.amount} IS NOT NULL THEN 'manual'
    WHEN ${investmentTransactions.amount} IS NOT NULL THEN 'synced'
    ELSE 'missing'
  END`.as("amountSource"),
  amountReferencePrice: amountOverride.referencePrice,
  amountPriceDate: amountOverride.priceDate,
  amountProvider: amountOverride.provider,
  currency: investmentTransactions.currency,
  effectiveDate: sql<string>`${investmentTransactions.effectiveDate}`,
  updatedAt: investmentTransactions.updatedAt,
};

export type InvestmentPageCursor = {
  asOfDate: string;
  assetType: string;
  name: string;
  id: string;
};

export type TransactionPageCursor = {
  effectiveDate: string;
  updatedAt: string;
  id: string;
};

export type InvestmentPositionRow = {
  id: string;
  connectorId: string;
  sourceId: string;
  assetType: string;
  symbol: string | null;
  name: string;
  quantity: number | null;
  marketValue: number | null;
  cashBalance: number | null;
  currency: string;
  asOfDate: string;
  costPerShare: number | null;
};

export async function listLatestInvestmentPositions(
  db: D1Database,
  limit: number,
  cursor?: InvestmentPageCursor,
) {
  return createDrizzle(db)
    .select({
      id: investmentPositions.id,
      connectorId: investmentPositions.connectorId,
      sourceId: investmentPositions.sourceId,
      assetType: investmentPositions.assetType,
      symbol: investmentPositions.symbol,
      name: investmentPositions.name,
      quantity: investmentPositions.quantity,
      marketValue: investmentPositions.marketValue,
      cashBalance: investmentPositions.cashBalance,
      currency: investmentPositions.currency,
      asOfDate: investmentPositions.asOfDate,
      costPerShare: investmentPositionCostOverrides.costPerShare,
    })
    .from(investmentPositions)
    .leftJoin(
      investmentPositionCostOverrides,
      and(
        eq(
          investmentPositionCostOverrides.connectorId,
          investmentPositions.connectorId,
        ),
        eq(
          investmentPositionCostOverrides.holdingKey,
          sql`substr(${investmentPositions.sourceId}, 1, length(${investmentPositions.sourceId}) - length(${investmentPositions.asOfDate}) - 1)`,
        ),
      ),
    )
    .where(
      and(
        // Latest as_of_date is per connector + asset type, not a global max.
        eq(
          investmentPositions.asOfDate,
          sql`(
            SELECT MAX(p2.as_of_date)
            FROM investment_positions p2
            WHERE p2.connector_id = ${investmentPositions.connectorId}
              AND p2.asset_type = ${investmentPositions.assetType}
          )`,
        ),
        cursor
          ? sql`(
              ${investmentPositions.asOfDate} < ${cursor.asOfDate}
              OR (
                ${investmentPositions.asOfDate} = ${cursor.asOfDate}
                AND (${investmentPositions.assetType}, ${investmentPositions.name}, ${investmentPositions.id})
                  > (${cursor.assetType}, ${cursor.name}, ${cursor.id})
              )
            )`
          : undefined,
      ),
    )
    .orderBy(
      desc(investmentPositions.asOfDate),
      asc(investmentPositions.assetType),
      asc(investmentPositions.name),
      asc(investmentPositions.id),
    )
    .limit(limit)
    .all();
}

export async function findInvestmentPositionById(db: D1Database, id: string) {
  return createDrizzle(db)
    .select({
      id: investmentPositions.id,
      connectorId: investmentPositions.connectorId,
      sourceId: investmentPositions.sourceId,
      asOfDate: investmentPositions.asOfDate,
      currency: investmentPositions.currency,
    })
    .from(investmentPositions)
    .where(eq(investmentPositions.id, id))
    .get();
}

export async function upsertInvestmentPositionCost(
  db: D1Database,
  input: {
    connectorId: string;
    holdingKey: string;
    costPerShare: number;
    currency: string;
  },
) {
  const now = new Date().toISOString();
  await createDrizzle(db)
    .insert(investmentPositionCostOverrides)
    .values({
      id: `cost:${input.connectorId}:${input.holdingKey}`,
      connectorId: input.connectorId,
      holdingKey: input.holdingKey,
      costPerShare: input.costPerShare,
      currency: input.currency,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        investmentPositionCostOverrides.connectorId,
        investmentPositionCostOverrides.holdingKey,
      ],
      set: {
        costPerShare: input.costPerShare,
        currency: input.currency,
        updatedAt: now,
      },
    })
    .run();
}

export async function upsertInvestmentTransactionAmount(
  db: D1Database,
  input: {
    transactionId: string;
    amount: number;
    source?: "manual" | "historical-close";
    referencePrice?: number;
    priceDate?: string;
    provider?: string;
  },
) {
  const database = createDrizzle(db);
  const transaction = await database
    .select({ id: investmentTransactions.id })
    .from(investmentTransactions)
    .where(eq(investmentTransactions.id, input.transactionId))
    .get();
  if (!transaction) return false;

  const now = new Date().toISOString();
  await database
    .insert(investmentTransactionAmountOverrides)
    .values({
      id: `amount:${input.transactionId}`,
      transactionId: input.transactionId,
      amount: Math.round(input.amount),
      source: input.source ?? "manual",
      referencePrice: input.referencePrice ?? null,
      priceDate: input.priceDate ?? null,
      provider: input.provider ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: investmentTransactionAmountOverrides.transactionId,
      set: {
        amount: Math.round(input.amount),
        source: input.source ?? "manual",
        referencePrice: input.referencePrice ?? null,
        priceDate: input.priceDate ?? null,
        provider: input.provider ?? null,
        updatedAt: now,
      },
    })
    .run();
  return true;
}

export async function deleteInvestmentTransactionAmount(
  db: D1Database,
  transactionId: string,
) {
  const result = await createDrizzle(db)
    .delete(investmentTransactionAmountOverrides)
    .where(
      eq(investmentTransactionAmountOverrides.transactionId, transactionId),
    )
    .run();
  return result.meta.changes > 0;
}

export async function listInvestmentTransactions(
  db: D1Database,
  limit: number,
  cursor?: TransactionPageCursor,
) {
  return createDrizzle(db)
    .select(investmentTransactionColumns)
    .from(investmentTransactions)
    .leftJoin(
      amountOverride,
      eq(amountOverride.transactionId, investmentTransactions.id),
    )
    .where(
      cursor
        ? sql`(${investmentTransactions.effectiveDate}, ${investmentTransactions.updatedAt}, ${investmentTransactions.id}) < (${cursor.effectiveDate}, ${cursor.updatedAt}, ${cursor.id})`
        : undefined,
    )
    .orderBy(
      desc(investmentTransactions.effectiveDate),
      desc(investmentTransactions.updatedAt),
      desc(investmentTransactions.id),
    )
    .limit(limit)
    .all();
}

export async function listInvestmentTransactionsInRange(
  db: D1Database,
  range: MonthDateRange,
  days?: string[],
) {
  return createDrizzle(db)
    .select(investmentTransactionColumns)
    .from(investmentTransactions)
    .leftJoin(
      amountOverride,
      eq(amountOverride.transactionId, investmentTransactions.id),
    )
    .where(
      days
        ? sql`substr(${investmentTransactions.effectiveDate}, 1, 10) IN (SELECT value FROM json_each(${JSON.stringify(days)}))`
        : and(
            sql`${investmentTransactions.effectiveDate} >= ${range.from}`,
            sql`${investmentTransactions.effectiveDate} < ${range.to}`,
          ),
    )
    .orderBy(
      desc(investmentTransactions.effectiveDate),
      desc(investmentTransactions.updatedAt),
      desc(investmentTransactions.id),
    )
    .all();
}
