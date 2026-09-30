import {
  activityCashFlow,
  isInvestmentCashFlow,
  type ActivityItem,
} from "@taiwan-fin-hub/core";

export interface RecurringExpense {
  key: string;
  scope: "item" | "category" | "investment";
  title: string;
  category: string;
  averageAmount: number;
  latestAmount: number;
  occurrences: number;
  monthCount: number;
  stability: number;
  monthlyAmounts: Record<string, number>;
  details: RecurringExpenseDetail[];
}

export interface RecurringExpenseDetail {
  id: string;
  date: string;
  title: string;
  subtitle: string;
  amount: number;
}

export interface MonthlyExpenseBreakdown {
  month: string;
  totalAmount: number;
  investmentExpenseAmount: number;
  recurringInvestmentAmount: number;
  extraInvestmentAmount: number;
  investmentIncomeAmount: number;
  netInvestmentAmount: number;
  totalOutflow: number;
  fixedAmount: number;
  baselineAmount: number;
  extraAmount: number;
  fixedCount: number;
  extraCount: number;
  salaryAmount: number;
  salaryBaseAmount: number;
  surplusAmount: number | null;
  overBudget: boolean;
}

export interface ExpenseCategoryTotal {
  category: string;
  amount: number;
  count: number;
  details: RecurringExpenseDetail[];
}

export interface RecurringExpenseAnalysis {
  months: string[];
  recurringExpenses: RecurringExpense[];
  monthly: MonthlyExpenseBreakdown[];
  extraCategories: ExpenseCategoryTotal[];
  baselineAmount: number;
  investmentBaselineAmount: number;
  fixedInvestmentExpenses: RecurringExpense[];
  salaryReferenceAmount: number;
  totalAmount: number;
}

type ExpenseAmount = (item: ActivityItem) => number | undefined;

interface ExpenseEntry {
  item: ActivityItem;
  month: string;
  amount: number;
  key: string;
}

interface ExpenseGroup {
  key: string;
  title: string;
  category: string;
  monthlyAmounts: Map<string, number>;
  entries: ExpenseEntry[];
}

const BASELINE_CATEGORIES = new Set([
  "餐飲",
  "居住",
  "生活繳費",
  "交通",
  "醫療",
  "保險",
  "教育",
  "軟體服務",
]);

function normalizeExpenseTitle(title: string) {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/[\s\-_/．。・,，.]/gu, "")
    .trim();
}

function expenseMonth(date: string) {
  return date.slice(0, 7);
}

function isOrdinaryExpense(item: ActivityItem) {
  return (
    !item.excludedFromCalculation &&
    !isInvestmentCashFlow(item) &&
    activityCashFlow(item) === "expense" &&
    (item.source === "bank" ||
      item.source === "card" ||
      item.source === "invoice")
  );
}

function isInvestmentExpense(item: ActivityItem) {
  return (
    !item.excludedFromCalculation &&
    isInvestmentCashFlow(item) &&
    activityCashFlow(item) === "expense"
  );
}

function isInvestmentIncome(item: ActivityItem) {
  return (
    !item.excludedFromCalculation &&
    isInvestmentCashFlow(item) &&
    activityCashFlow(item) === "income"
  );
}

function categoryContributions(entry: ExpenseEntry) {
  if (entry.item.categoryParts?.length) {
    return entry.item.categoryParts
      .filter((part) => part.behavior === "normal" && part.amount > 0)
      .map((part) => ({
        category: part.category || "未分類",
        amount: part.amount,
        description: part.description,
      }));
  }
  return [
    {
      category: entry.item.category || "未分類",
      amount: entry.amount,
      description: undefined,
    },
  ];
}

function categoryKey(category: string) {
  return `category:${normalizeExpenseTitle(category)}`;
}

function recurringExpenseFromGroup(
  group: ExpenseGroup,
  months: string[],
  minimumOccurrences: number,
  maximumStability: number,
  scope: RecurringExpense["scope"],
  details: RecurringExpenseDetail[],
): RecurringExpense | null {
  const values = [...group.monthlyAmounts.values()];
  const total = values.reduce((sum, amount) => sum + amount, 0);
  const averageAmount = total / values.length;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const stability =
    averageAmount === 0 ? 0 : (maximum - minimum) / averageAmount;
  if (values.length < minimumOccurrences || stability > maximumStability)
    return null;
  const latestMonth = [...group.monthlyAmounts.keys()].sort().at(-1);
  return {
    key: group.key,
    scope,
    title: group.title,
    category: group.category,
    averageAmount,
    latestAmount:
      latestMonth == null
        ? averageAmount
        : (group.monthlyAmounts.get(latestMonth) ?? averageAmount),
    occurrences: values.length,
    monthCount: months.length,
    stability,
    monthlyAmounts: Object.fromEntries(group.monthlyAmounts),
    details,
  };
}

function detailTitle(entry: ExpenseEntry, description?: string) {
  if (description?.trim()) return description.trim();
  const productNames = (entry.item.categoryParts ?? [])
    .filter((part) => part.behavior === "normal" && part.description?.trim())
    .map((part) => part.description!.trim());
  if (productNames.length === 1) return productNames[0]!;
  if (productNames.length > 1)
    return `${productNames[0]} 等 ${productNames.length} 項`;
  return entry.item.title;
}

function detailSubtitle(entry: ExpenseEntry) {
  return [entry.item.title, entry.item.subtitle].filter(Boolean).join(" · ");
}

export function analyzeRecurringExpenses(
  items: ActivityItem[],
  months: string[],
  amountOf: ExpenseAmount,
  salaryAmountOf?: ExpenseAmount,
): RecurringExpenseAnalysis {
  const monthSet = new Set(months);
  const groups = new Map<string, ExpenseGroup>();
  const entries: ExpenseEntry[] = [];

  for (const item of items) {
    if (!isOrdinaryExpense(item)) continue;
    const month = expenseMonth(item.date);
    if (!monthSet.has(month)) continue;
    const amount = amountOf(item);
    const key = normalizeExpenseTitle(item.title);
    if (!key || amount == null || !Number.isFinite(amount) || amount <= 0)
      continue;
    const entry = { item, month, amount, key };
    entries.push(entry);
    const group = groups.get(key) ?? {
      key,
      title: item.title,
      category: item.category,
      monthlyAmounts: new Map<string, number>(),
      entries: [],
    };
    group.monthlyAmounts.set(
      month,
      (group.monthlyAmounts.get(month) ?? 0) + amount,
    );
    group.entries.push(entry);
    groups.set(key, group);
  }

  const minimumOccurrences = Math.max(3, Math.ceil(months.length / 2));
  const recurringItemExpenses = [...groups.values()]
    .map((group) =>
      recurringExpenseFromGroup(
        group,
        months,
        minimumOccurrences,
        0.35,
        "item",
        group.entries.map((entry) => ({
          id: entry.item.id,
          date: entry.item.date,
          title: detailTitle(entry),
          subtitle: detailSubtitle(entry),
          amount: entry.amount,
        })),
      ),
    )
    .filter((expense): expense is RecurringExpense => expense != null);
  const recurringItemKeys = new Set(
    recurringItemExpenses.map((expense) => expense.key),
  );

  const categoryGroups = new Map<string, ExpenseGroup>();
  for (const entry of entries) {
    if (recurringItemKeys.has(entry.key)) continue;
    for (const contribution of categoryContributions(entry)) {
      const key = categoryKey(contribution.category);
      const group = categoryGroups.get(key) ?? {
        key,
        title: contribution.category,
        category: "類別基準",
        monthlyAmounts: new Map<string, number>(),
        entries: [],
      };
      group.monthlyAmounts.set(
        entry.month,
        (group.monthlyAmounts.get(entry.month) ?? 0) + contribution.amount,
      );
      if (!group.entries.includes(entry)) group.entries.push(entry);
      categoryGroups.set(key, group);
    }
  }

  // Basic living categories can be a monthly baseline even when each month
  // uses different merchants. Discretionary categories still need stable
  // monthly amounts, so shopping and entertainment are not over-classified.
  const recurringCategoryExpenses = [...categoryGroups.values()]
    .map((group) =>
      recurringExpenseFromGroup(
        group,
        months,
        minimumOccurrences,
        BASELINE_CATEGORIES.has(group.title) ? Number.POSITIVE_INFINITY : 0.45,
        "category",
        group.entries.flatMap((entry) =>
          categoryContributions(entry)
            .filter(
              (contribution) =>
                categoryKey(contribution.category) === group.key,
            )
            .map((contribution) => ({
              id: `${entry.item.id}:${group.key}`,
              date: entry.item.date,
              title: detailTitle(entry, contribution.description),
              subtitle: detailSubtitle(entry),
              amount: contribution.amount,
            })),
        ),
      ),
    )
    .filter((expense): expense is RecurringExpense => expense != null);
  const recurringCategoryKeys = new Set(
    recurringCategoryExpenses.map((expense) => expense.key),
  );

  const investmentGroups = new Map<string, ExpenseGroup>();
  const investmentEntries: ExpenseEntry[] = [];
  for (const item of items) {
    if (!isInvestmentExpense(item)) continue;
    const month = expenseMonth(item.date);
    if (!monthSet.has(month)) continue;
    const amount = amountOf(item);
    const key = normalizeExpenseTitle(item.title);
    if (!key || amount == null || !Number.isFinite(amount) || amount <= 0)
      continue;
    const entry = { item, month, amount, key };
    investmentEntries.push(entry);
    const group = investmentGroups.get(key) ?? {
      key,
      title: item.title,
      category: "投資",
      monthlyAmounts: new Map<string, number>(),
      entries: [],
    };
    group.monthlyAmounts.set(
      month,
      (group.monthlyAmounts.get(month) ?? 0) + amount,
    );
    group.entries.push(entry);
    investmentGroups.set(key, group);
  }
  const fixedInvestmentExpenses = [...investmentGroups.values()]
    .map((group) =>
      recurringExpenseFromGroup(
        group,
        months,
        minimumOccurrences,
        0.5,
        "investment",
        group.entries.map((entry) => ({
          id: entry.item.id,
          date: entry.item.date,
          title: detailTitle(entry),
          subtitle: detailSubtitle(entry),
          amount: entry.amount,
        })),
      ),
    )
    .filter((expense): expense is RecurringExpense => expense != null);
  const fixedInvestmentKeys = new Set(
    fixedInvestmentExpenses.map((expense) => expense.key),
  );
  const investmentExpenseMonthlyAmounts = new Map<string, number>();
  const recurringInvestmentMonthlyAmounts = new Map<string, number>();
  for (const entry of investmentEntries) {
    investmentExpenseMonthlyAmounts.set(
      entry.month,
      (investmentExpenseMonthlyAmounts.get(entry.month) ?? 0) + entry.amount,
    );
    if (fixedInvestmentKeys.has(entry.key)) {
      recurringInvestmentMonthlyAmounts.set(
        entry.month,
        (recurringInvestmentMonthlyAmounts.get(entry.month) ?? 0) +
          entry.amount,
      );
    }
  }
  const investmentIncomeMonthlyAmounts = new Map<string, number>();
  for (const item of items) {
    if (!isInvestmentIncome(item)) continue;
    const month = expenseMonth(item.date);
    if (!monthSet.has(month)) continue;
    const amount = amountOf(item);
    if (amount == null || !Number.isFinite(amount) || amount <= 0) continue;
    investmentIncomeMonthlyAmounts.set(
      month,
      (investmentIncomeMonthlyAmounts.get(month) ?? 0) + amount,
    );
  }
  const investmentBaselineAmount = fixedInvestmentExpenses.reduce(
    (sum, expense) => sum + expense.averageAmount,
    0,
  );

  const salaryMonthlyAmounts = new Map<string, number>();
  if (salaryAmountOf) {
    for (const item of items) {
      if (
        item.excludedFromCalculation ||
        isInvestmentCashFlow(item) ||
        activityCashFlow(item) !== "income"
      )
        continue;
      const month = expenseMonth(item.date);
      if (!monthSet.has(month)) continue;
      const amount = salaryAmountOf(item);
      if (amount == null || !Number.isFinite(amount) || amount <= 0) continue;
      salaryMonthlyAmounts.set(
        month,
        (salaryMonthlyAmounts.get(month) ?? 0) + amount,
      );
    }
  }
  const salaryValues = [...salaryMonthlyAmounts.values()];
  const salaryReferenceAmount =
    salaryValues.length > 0
      ? salaryValues.reduce((sum, amount) => sum + amount, 0) /
        salaryValues.length
      : 0;

  const recurringExpenses = [
    ...recurringItemExpenses,
    ...recurringCategoryExpenses,
  ].sort((left, right) => right.averageAmount - left.averageAmount);

  const monthly = months.map((month) => {
    const monthEntries = entries.filter((entry) => entry.month === month);
    const totalAmount = monthEntries.reduce(
      (sum, entry) => sum + entry.amount,
      0,
    );
    const investmentExpenseAmount =
      investmentExpenseMonthlyAmounts.get(month) ?? 0;
    const recurringInvestmentAmount =
      recurringInvestmentMonthlyAmounts.get(month) ?? 0;
    const extraInvestmentAmount = Math.max(
      0,
      investmentExpenseAmount - recurringInvestmentAmount,
    );
    const investmentIncomeAmount =
      investmentIncomeMonthlyAmounts.get(month) ?? 0;
    const netInvestmentAmount =
      investmentExpenseAmount - investmentIncomeAmount;
    const fixedEntries = monthEntries.filter((entry) => {
      if (recurringItemKeys.has(entry.key)) return true;
      return categoryContributions(entry).some((contribution) =>
        recurringCategoryKeys.has(categoryKey(contribution.category)),
      );
    });
    const fixedAmount = monthEntries.reduce((sum, entry) => {
      if (recurringItemKeys.has(entry.key)) return sum + entry.amount;
      return (
        sum +
        categoryContributions(entry)
          .filter((contribution) =>
            recurringCategoryKeys.has(categoryKey(contribution.category)),
          )
          .reduce(
            (categorySum, contribution) => categorySum + contribution.amount,
            0,
          )
      );
    }, 0);
    const extraEntries = monthEntries.filter(
      (entry) => !fixedEntries.includes(entry),
    );
    const salaryAmount = salaryMonthlyAmounts.get(month) ?? 0;
    const salaryBaseAmount = salaryAmount || salaryReferenceAmount;
    const totalOutflow = totalAmount + netInvestmentAmount;
    return {
      month,
      totalAmount,
      investmentExpenseAmount,
      recurringInvestmentAmount,
      extraInvestmentAmount,
      investmentIncomeAmount,
      netInvestmentAmount,
      totalOutflow,
      fixedAmount,
      baselineAmount: recurringExpenses.reduce(
        (sum, expense) => sum + expense.averageAmount,
        0,
      ),
      extraAmount: Math.max(0, totalAmount - fixedAmount),
      fixedCount: fixedEntries.length,
      extraCount: extraEntries.length,
      salaryAmount,
      salaryBaseAmount,
      surplusAmount:
        salaryBaseAmount > 0 ? salaryBaseAmount - totalOutflow : null,
      overBudget: salaryBaseAmount > 0 && totalOutflow > salaryBaseAmount,
    };
  });

  const extraCategories = new Map<string, ExpenseCategoryTotal>();
  for (const entry of entries) {
    if (recurringItemKeys.has(entry.key)) continue;
    for (const contribution of categoryContributions(entry)) {
      if (recurringCategoryKeys.has(categoryKey(contribution.category)))
        continue;
      const existing = extraCategories.get(contribution.category) ?? {
        category: contribution.category,
        amount: 0,
        count: 0,
        details: [],
      };
      existing.amount += contribution.amount;
      existing.count += 1;
      existing.details.push({
        id: `${entry.item.id}:${contribution.category}:${existing.count}`,
        date: entry.item.date,
        title: detailTitle(entry, contribution.description),
        subtitle: detailSubtitle(entry),
        amount: contribution.amount,
      });
      extraCategories.set(contribution.category, existing);
    }
  }

  return {
    months,
    recurringExpenses,
    monthly,
    extraCategories: [...extraCategories.values()].sort(
      (left, right) => right.amount - left.amount,
    ),
    baselineAmount: recurringExpenses.reduce(
      (sum, expense) => sum + expense.averageAmount,
      0,
    ),
    investmentBaselineAmount,
    fixedInvestmentExpenses,
    salaryReferenceAmount,
    totalAmount: monthly.reduce((sum, point) => sum + point.totalAmount, 0),
  };
}
