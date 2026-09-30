import { describe, expect, it } from "vitest";
import type { NetWorthHistoryRow } from "@/data/assets/types";
import {
  buildMonthlyInvestmentPerformance,
  summarizeMonthlyInvestmentPerformance,
} from "./monthly-performance";

describe("monthly investment performance", () => {
  it("uses each month's latest stock and fund snapshots and calculates changes", () => {
    const rows: NetWorthHistoryRow[] = [
      { date: "2026-01-30", netWorth: 100, assetType: "stock", source: "tdcc" },
      { date: "2026-01-30", netWorth: 50, assetType: "fund", source: "tdcc" },
      { date: "2026-01-31", netWorth: 120, assetType: "stock", source: "tdcc" },
      { date: "2026-02-27", netWorth: 130, assetType: "stock", source: "tdcc" },
      { date: "2026-02-27", netWorth: 60, assetType: "fund", source: "tdcc" },
    ];

    expect(buildMonthlyInvestmentPerformance(rows)).toEqual([
      {
        month: "2026-01",
        date: "2026-01-31",
        periodStartDate: null,
        marketValue: 170,
        changeAmount: null,
        changeRate: null,
        cashFlowAmount: 0,
        adjustedChangeAmount: null,
        adjustedChangeRate: null,
        baselineAddedValue: 150,
      },
      {
        month: "2026-02",
        date: "2026-02-27",
        periodStartDate: "2026-01-31",
        marketValue: 190,
        changeAmount: 20,
        changeRate: (20 / 170) * 100,
        cashFlowAmount: 0,
        adjustedChangeAmount: 20,
        adjustedChangeRate: (20 / 170) * 100,
        baselineAddedValue: 0,
      },
    ]);
  });

  it("includes manually tracked stocks and excludes unrelated assets", () => {
    const rows: NetWorthHistoryRow[] = [
      {
        date: "2026-01-31",
        netWorth: 100,
        assetType: "stock",
        source: "tdcc",
        seriesId: "stock",
      },
      {
        date: "2026-01-31",
        netWorth: 120,
        assetType: "stock",
        source: "manual",
        seriesId: "manual:two",
      },
      {
        date: "2026-01-31",
        netWorth: 80,
        assetType: "stock",
        source: "manual",
        seriesId: "manual:one",
      },
      {
        date: "2026-01-31",
        netWorth: 900,
        assetType: "deposit",
        source: "bank",
      },
    ];

    const point = buildMonthlyInvestmentPerformance(rows)[0];
    expect(point?.marketValue).toBe(300);
    expect(point?.baselineAddedValue).toBe(300);
  });

  it("returns no rate when the previous valuation is zero", () => {
    const points = buildMonthlyInvestmentPerformance([
      { date: "2026-01-31", netWorth: 0, assetType: "stock", source: "tdcc" },
      { date: "2026-02-28", netWorth: 50, assetType: "stock", source: "tdcc" },
    ]);

    expect(points[1]?.changeAmount).toBe(50);
    expect(points[1]?.changeRate).toBeNull();
    expect(points[1]?.adjustedChangeRate).toBeNull();
  });

  it("removes investment cash flow from monthly return", () => {
    const rows: NetWorthHistoryRow[] = [
      { date: "2026-01-31", netWorth: 100, assetType: "stock", source: "tdcc" },
      { date: "2026-02-28", netWorth: 130, assetType: "stock", source: "tdcc" },
    ];

    const points = buildMonthlyInvestmentPerformance(rows, [
      {
        id: "buy",
        connectorId: "tdcc",
        accountId: "account",
        sourceId: "source",
        tradeDate: "2026-02-14T00:00:00.000Z",
        transactionName: "買進",
        amount: -20,
        currency: "TWD",
      },
    ]);

    expect(points[1]?.changeAmount).toBe(30);
    expect(points[1]?.cashFlowAmount).toBe(20);
    expect(points[1]?.adjustedChangeAmount).toBe(10);
    expect(points[1]?.adjustedChangeRate).toBeCloseTo((10 / 110) * 100);
  });

  it("treats a newly appearing holding as a baseline instead of profit", () => {
    const rows: NetWorthHistoryRow[] = [
      { date: "2026-01-31", netWorth: 100, assetType: "stock", source: "tdcc" },
      { date: "2026-02-28", netWorth: 120, assetType: "stock", source: "tdcc" },
      {
        date: "2026-02-28",
        netWorth: 200,
        assetType: "stock",
        source: "manual",
        seriesId: "manual:one",
      },
    ];

    const points = buildMonthlyInvestmentPerformance(rows);
    expect(points[1]?.marketValue).toBe(320);
    expect(points[1]?.baselineAddedValue).toBe(200);
    expect(points[1]?.adjustedChangeAmount).toBe(20);
    expect(points[1]?.adjustedChangeRate).toBeCloseTo((20 / 300) * 100);
  });

  it("annualizes the cash-flow-adjusted period return", () => {
    const rows: NetWorthHistoryRow[] = [
      { date: "2025-12-31", netWorth: 100, assetType: "stock", source: "tdcc" },
      { date: "2026-06-30", netWorth: 110, assetType: "stock", source: "tdcc" },
    ];
    const summary = summarizeMonthlyInvestmentPerformance(
      buildMonthlyInvestmentPerformance(rows),
    );

    expect(summary.returnRate).toBeCloseTo(10);
    expect(summary.periodDays).toBe(181);
    expect(summary.annualizedReturnRate).toBeCloseTo(
      (Math.pow(1.1, 365.2425 / 181) - 1) * 100,
    );
  });
});
