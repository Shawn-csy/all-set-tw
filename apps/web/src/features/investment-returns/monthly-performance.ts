import type { NetWorthHistoryRow } from "@/data/assets/types";
import type { InvestmentTransactionRow } from "@/data/investments/types";
import { classifyInvestmentTransaction } from "@/data/investments/transaction-kind";

export interface MonthlyInvestmentPerformance {
  month: string;
  date: string;
  periodStartDate: string | null;
  marketValue: number;
  changeAmount: number | null;
  changeRate: number | null;
  cashFlowAmount: number;
  adjustedChangeAmount: number | null;
  adjustedChangeRate: number | null;
  baselineAddedValue: number;
}

export interface InvestmentPeriodPerformance {
  returnRate: number | null;
  annualizedReturnRate: number | null;
  periodDays: number | null;
  gainAmount: number | null;
  cashFlowAmount: number;
  baselineAddedValue: number;
  calculatedMonthCount: number;
}

type CurrencyConverter = (amount: number, currency: string) => number;

interface MonthlyCashFlow {
  date: string;
  amount: number;
}

/**
 * Builds monthly investment performance with modified-Dietz style cash-flow
 * adjustment. Newly appearing series are treated as a data baseline, so a
 * manually added holding cannot be mistaken for investment profit.
 */
export function buildMonthlyInvestmentPerformance(
  rows: NetWorthHistoryRow[],
  transactions: InvestmentTransactionRow[] = [],
  toTwd: CurrencyConverter = (amount) => amount,
): MonthlyInvestmentPerformance[] {
  const investments = rows
    .filter((row) => row.assetType === "stock" || row.assetType === "fund")
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));
  const latestBySeries = new Map<string, number>();
  const seenSeries = new Set<string>();
  const byDate = new Map<
    string,
    { selectedTotal: number; baselineAddedValue: number }
  >();

  for (const row of investments) {
    const seriesKey = `${row.source}:${row.seriesId ?? row.assetType}`;
    const isNewSeries = !seenSeries.has(seriesKey);
    seenSeries.add(seriesKey);
    latestBySeries.set(seriesKey, row.netWorth);
    const existing = byDate.get(row.date) ?? {
      selectedTotal: 0,
      baselineAddedValue: 0,
    };
    existing.selectedTotal = [...latestBySeries.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    if (isNewSeries) existing.baselineAddedValue += row.netWorth;
    byDate.set(row.date, existing);
  }

  const monthEnds = new Map<
    string,
    { date: string; selectedTotal: number; baselineAddedValue: number }
  >();
  for (const [date, point] of byDate) {
    const month = date.slice(0, 7);
    const existing = monthEnds.get(month);
    monthEnds.set(month, {
      date,
      selectedTotal: point.selectedTotal,
      baselineAddedValue:
        (existing?.baselineAddedValue ?? 0) + point.baselineAddedValue,
    });
  }

  const cashFlowsByMonth = new Map<string, MonthlyCashFlow[]>();
  for (const transaction of transactions) {
    const date = (transaction.tradeDate ?? transaction.postedDate)?.slice(
      0,
      10,
    );
    if (
      !date ||
      transaction.amount == null ||
      !Number.isFinite(transaction.amount)
    )
      continue;
    const kind = classifyInvestmentTransaction(transaction);
    if (kind === "other") continue;
    const amount = toTwd(Math.abs(transaction.amount), transaction.currency);
    if (!Number.isFinite(amount)) continue;
    const signedAmount =
      kind === "buy"
        ? amount
        : kind === "sell" || kind === "redemption" || kind === "income"
          ? -amount
          : 0;
    const month = date.slice(0, 7);
    const flows = cashFlowsByMonth.get(month) ?? [];
    flows.push({ date, amount: signedAmount });
    cashFlowsByMonth.set(month, flows);
  }

  let previousValue: number | undefined;
  let previousDate: string | undefined;
  return [...monthEnds.entries()].map(([month, point]) => {
    const changeAmount =
      previousValue === undefined ? null : point.selectedTotal - previousValue;
    const changeRate =
      previousValue === undefined || previousValue === 0
        ? null
        : (changeAmount! / Math.abs(previousValue)) * 100;

    const cashFlows = cashFlowsByMonth.get(month) ?? [];
    const cashFlowAmount = cashFlows.reduce(
      (sum, flow) => sum + flow.amount,
      0,
    );
    let adjustedChangeAmount: number | null = null;
    let adjustedChangeRate: number | null = null;
    if (previousValue !== undefined && previousDate) {
      const startValue = previousValue + point.baselineAddedValue;
      const periodStart = Date.parse(`${previousDate}T00:00:00Z`);
      const periodEnd = Date.parse(`${point.date}T00:00:00Z`);
      const periodLength = periodEnd - periodStart;
      const weightedCashFlow =
        periodLength > 0
          ? cashFlows.reduce((sum, flow) => {
              const flowTime = Date.parse(`${flow.date}T00:00:00Z`);
              const weight = Math.max(
                0,
                Math.min(1, (periodEnd - flowTime) / periodLength),
              );
              return sum + flow.amount * weight;
            }, 0)
          : cashFlowAmount;
      adjustedChangeAmount = point.selectedTotal - startValue - cashFlowAmount;
      const adjustedBasis = startValue + weightedCashFlow;
      adjustedChangeRate =
        adjustedBasis === 0
          ? null
          : (adjustedChangeAmount / Math.abs(adjustedBasis)) * 100;
    }

    const periodStartDate = previousDate ?? null;
    previousValue = point.selectedTotal;
    previousDate = point.date;

    return {
      month,
      date: point.date,
      periodStartDate,
      marketValue: point.selectedTotal,
      changeAmount,
      changeRate,
      cashFlowAmount,
      adjustedChangeAmount,
      adjustedChangeRate,
      baselineAddedValue: point.baselineAddedValue,
    };
  });
}

export function summarizeMonthlyInvestmentPerformance(
  points: MonthlyInvestmentPerformance[],
): InvestmentPeriodPerformance {
  let factor = 1;
  let gainAmount = 0;
  let calculatedMonthCount = 0;
  let cashFlowAmount = 0;
  let baselineAddedValue = 0;
  let firstPeriodStartDate: string | null = null;
  let lastPeriodEndDate: string | null = null;

  for (const point of points) {
    cashFlowAmount += point.cashFlowAmount;
    baselineAddedValue += point.baselineAddedValue;
    if (point.adjustedChangeRate == null) continue;
    factor *= 1 + point.adjustedChangeRate / 100;
    gainAmount += point.adjustedChangeAmount ?? 0;
    calculatedMonthCount += 1;
    firstPeriodStartDate ??= point.periodStartDate;
    lastPeriodEndDate = point.date;
  }

  const periodDays =
    firstPeriodStartDate && lastPeriodEndDate
      ? Math.max(
          0,
          (Date.parse(`${lastPeriodEndDate}T00:00:00Z`) -
            Date.parse(`${firstPeriodStartDate}T00:00:00Z`)) /
            86_400_000,
        )
      : null;
  const returnRate = calculatedMonthCount > 0 ? (factor - 1) * 100 : null;
  const annualizedReturnRate =
    returnRate != null && periodDays != null && periodDays > 0
      ? (Math.pow(factor, 365.2425 / periodDays) - 1) * 100
      : null;

  return {
    returnRate,
    annualizedReturnRate,
    periodDays,
    gainAmount: calculatedMonthCount > 0 ? gainAmount : null,
    cashFlowAmount,
    baselineAddedValue,
    calculatedMonthCount,
  };
}
