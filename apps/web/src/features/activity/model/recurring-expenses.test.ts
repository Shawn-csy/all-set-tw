import { describe, expect, it } from "vitest";
import type { ActivityItem } from "@taiwan-fin-hub/core";
import { analyzeRecurringExpenses } from "./recurring-expenses";

function item(
  id: string,
  date: string,
  title: string,
  amount: number,
  category = "居住",
): ActivityItem {
  return {
    id,
    source: "bank",
    date,
    title,
    subtitle: "銀行",
    amount,
    currency: "TWD",
    category,
    status: "posted",
  };
}

describe("recurring expense analysis", () => {
  it("detects stable expenses and separates monthly extras", () => {
    const months = ["2026-04", "2026-05", "2026-06", "2026-07"];
    const items = [
      item("rent-04", "2026-04-01", "房東租金", -10000),
      item("rent-05", "2026-05-01", "房東租金", -10000),
      item("rent-06", "2026-06-01", "房東租金", -10000),
      item("rent-07", "2026-07-01", "房東租金", -10000),
      item("food-06", "2026-06-12", "餐廳", -800, "餐飲"),
      item("food-07", "2026-07-12", "餐廳", -1200, "餐飲"),
    ];

    const analysis = analyzeRecurringExpenses(items, months, (entry) =>
      Math.abs(entry.amount ?? 0),
    );

    expect(analysis.recurringExpenses[0]).toMatchObject({
      title: "房東租金",
      averageAmount: 10000,
      occurrences: 4,
    });
    expect(analysis.baselineAmount).toBe(10000);
    expect(analysis.monthly[2]).toMatchObject({
      month: "2026-06",
      totalAmount: 10800,
      fixedAmount: 10000,
      extraAmount: 800,
    });
    expect(analysis.extraCategories).toMatchObject([
      { category: "餐飲", amount: 2000, count: 2 },
    ]);
  });

  it("does not treat investment cash flow as living expense", () => {
    const investment = item(
      "investment",
      "2026-06-10",
      "複委託轉帳",
      -50000,
      "投資",
    );
    investment.cashFlowType = "investment_expense";

    const analysis = analyzeRecurringExpenses(
      [investment],
      ["2026-06"],
      (entry) => Math.abs(entry.amount ?? 0),
    );

    expect(analysis.totalAmount).toBe(0);
    expect(analysis.recurringExpenses).toHaveLength(0);
  });

  it("treats a stable category as a recurring baseline", () => {
    const months = [
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ];
    const items = months.map((month, index) =>
      item(
        `food-${month}`,
        `${month}-12`,
        `餐廳 ${index + 1}`,
        -[9200, 9800, 10100, 9600, 10500, 9900][index]!,
        "餐飲",
      ),
    );

    const analysis = analyzeRecurringExpenses(items, months, (entry) =>
      Math.abs(entry.amount ?? 0),
    );

    const foodBaseline = analysis.recurringExpenses.find(
      (expense) => expense.scope === "category" && expense.title === "餐飲",
    );
    expect(foodBaseline).toMatchObject({ averageAmount: 9850 });
    expect(foodBaseline?.details).toHaveLength(6);
    expect(analysis.monthly.at(-1)).toMatchObject({
      fixedAmount: 9900,
      extraAmount: 0,
    });
    expect(analysis.extraCategories).toHaveLength(0);
  });

  it("compares ordinary and investment outflow with the salary baseline", () => {
    const months = ["2026-04", "2026-05", "2026-06"];
    const items = months.flatMap((month, index) => {
      const salary = item(
        `salary-${month}`,
        `${month}-01`,
        "薪資入帳",
        50000,
        "薪資",
      );
      const investment = item(
        `invest-${month}`,
        `${month}-05`,
        "定期定額投資",
        -10000,
        "投資",
      );
      investment.cashFlowType = "investment_expense";
      const expense = item(
        `expense-${month}`,
        `${month}-10`,
        `額外消費 ${index}`,
        -45000,
        "購物",
      );
      if (month !== "2026-06") return [salary, investment, expense];
      const oneTimeInvestment = item(
        "one-time-investment",
        "2026-06-20",
        "複委託單筆買進",
        -40000,
        "投資",
      );
      oneTimeInvestment.cashFlowType = "investment_expense";
      const redemption = item(
        "redemption",
        "2026-06-21",
        "贖回基金",
        30000,
        "投資",
      );
      redemption.cashFlowType = "investment_income";
      return [salary, investment, expense, oneTimeInvestment, redemption];
    });

    const analysis = analyzeRecurringExpenses(
      items,
      months,
      (entry) => Math.abs(entry.amount ?? 0),
      (entry) => Math.abs(entry.amount ?? 0),
    );

    expect(analysis.salaryReferenceAmount).toBe(50000);
    expect(analysis.fixedInvestmentExpenses[0]).toMatchObject({
      title: "定期定額投資",
      averageAmount: 10000,
      scope: "investment",
    });
    expect(analysis.monthly[2]).toMatchObject({
      totalOutflow: 65000,
      investmentExpenseAmount: 50000,
      recurringInvestmentAmount: 10000,
      extraInvestmentAmount: 40000,
      investmentIncomeAmount: 30000,
      netInvestmentAmount: 20000,
      overBudget: true,
      surplusAmount: -15000,
    });
  });
});
