export type ClassificationResult = {
  categoryId: string;
  label: string;
  behavior: ClassificationBehavior;
  source:
    | "override"
    | "user_rule"
    | "system_rule"
    | "auto_transfer"
    | "auto_offset"
    | "fallback";
  ruleId?: string;
  /** @deprecated Derived from behavior for older API consumers. */
  excludedFromCalculation?: boolean;
};

export type ClassificationBehavior =
  "normal" | "asset_transfer" | "cash_withdrawal" | "excluded";

export type ClassifiedTransaction = {
  id: string;
  description?: string | null;
  counterparty?: string | null;
  sourceId: string;
  amount?: number;
  accountType?: string | null;
};

export function matchesClassificationRule(
  rule: { field: string; operator: string; pattern: string },
  transaction: ClassifiedTransaction,
) {
  // Connectors do not agree on which column contains the merchant memo:
  // some put it in description, others put it in counterparty. Keep
  // source_id exact, but let the human-facing fields share their text so a
  // valid rule does not silently become ineffective after a connector sync.
  const descriptionText = [transaction.description, transaction.counterparty]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const counterpartyText = [transaction.counterparty, transaction.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const anyText = [
    transaction.description,
    transaction.counterparty,
    transaction.sourceId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const text =
    rule.field === "description"
      ? descriptionText
      : rule.field === "counterparty"
        ? counterpartyText
        : rule.field === "source_id"
          ? transaction.sourceId.toLowerCase()
          : anyText;

  if (rule.operator === "contains")
    return text.includes(rule.pattern.toLowerCase());
  if (rule.operator === "equals") return text === rule.pattern.toLowerCase();
  if (rule.operator === "starts_with")
    return text.startsWith(rule.pattern.toLowerCase());
  if (rule.operator === "regex") {
    try {
      return new RegExp(rule.pattern, "i").test(text);
    } catch {
      return false;
    }
  }
  return false;
}

export async function resolveClassifications(
  db: D1Database,
  transactions: ClassifiedTransaction[],
): Promise<Map<string, ClassificationResult>> {
  if (transactions.length === 0) return new Map();

  // URL paths normalize backslashes, so compare override ids in their normalized form.
  const normalizeId = (id: string) => id.replace(/\\/g, "/");
  const transactionIds = [
    ...new Set(
      transactions.flatMap((transaction) => [
        transaction.id,
        normalizeId(transaction.id),
      ]),
    ),
  ];
  const [overrides, rules] = await Promise.all([
    listClassificationOverrides(db, transactionIds),
    listEnabledClassificationRules(db),
  ]);

  const overrideMap = new Map(
    overrides.map((override) => [normalizeId(override.target_id), override]),
  );
  const result = new Map<string, ClassificationResult>();

  for (const transaction of transactions) {
    const override = overrideMap.get(normalizeId(transaction.id));
    const overrideIsValidCashWithdrawal =
      override?.behavior !== "cash_withdrawal" ||
      (typeof transaction.amount === "number" &&
        transaction.amount < 0 &&
        transaction.accountType !== "credit");
    if (override && overrideIsValidCashWithdrawal) {
      const behavior = (override.behavior ??
        "normal") as ClassificationBehavior;
      result.set(transaction.id, {
        categoryId: override.category_id,
        label: override.label,
        behavior,
        source: "override",
        excludedFromCalculation: behavior !== "normal",
      });
      continue;
    }

    let matched: ClassificationResult | undefined;
    for (const rule of rules) {
      if (rule.target_type && rule.target_type !== "bank_transaction") continue;
      if (
        rule.id === "system:bank:other-income-keywords" &&
        !(
          typeof transaction.amount === "number" &&
          Number.isFinite(transaction.amount) &&
          transaction.amount > 0
        )
      )
        continue;
      if (!matchesClassificationRule(rule, transaction)) continue;
      if (
        rule.behavior === "cash_withdrawal" &&
        (!(typeof transaction.amount === "number" && transaction.amount < 0) ||
          transaction.accountType === "credit")
      )
        continue;
      const behavior = (rule.behavior ??
        (rule.excluded_from_calculation === 1
          ? "excluded"
          : "normal")) as ClassificationBehavior;
      matched = {
        categoryId: rule.category_id,
        label: rule.label,
        behavior,
        source: rule.is_system ? "system_rule" : "user_rule",
        ruleId: rule.id,
        excludedFromCalculation: behavior !== "normal",
      };
      break;
    }
    result.set(
      transaction.id,
      matched ?? {
        categoryId: "other",
        label: "未分類",
        behavior: "normal",
        source: "fallback",
        excludedFromCalculation: false,
      },
    );
  }

  return result;
}

export class ClassificationCategoryExistsError extends Error {}
export class ClassificationCategoryNotFoundError extends Error {}
export class ClassificationRuleNotFoundError extends Error {}
export class ClassificationRuleOrderError extends Error {}

export async function getClassificationCategories(db: D1Database) {
  const rows = await listClassificationCategories(db);
  return rows.map((row) => ({ ...row, isSystem: Boolean(row.isSystem) }));
}

export async function createClassificationCategory(
  db: D1Database,
  label: string,
) {
  if (await findCategoryByLabel(db, label))
    throw new ClassificationCategoryExistsError();
  const id = `user:${crypto.randomUUID()}`;
  const sortOrder = await nextCategorySortOrder(db);
  await insertClassificationCategory(db, {
    id,
    label,
    sortOrder,
    now: new Date().toISOString(),
  });
  return { id, label, sortOrder, isSystem: false, behavior: "normal" as const };
}

export async function getClassificationRules(db: D1Database) {
  const rows = await listClassificationRules(db);
  return rows.map((row) => ({
    ...row,
    enabled: Boolean(row.enabled),
    isSystem: Boolean(row.isSystem),
    excludedFromCalculation: row.behavior !== "normal",
  }));
}

export async function reorderClassificationRules(
  db: D1Database,
  ruleIds: string[],
) {
  const editableRuleIds = await listEditableClassificationRuleIds(db);
  const editableRuleIdSet = new Set(editableRuleIds);
  if (
    ruleIds.length !== editableRuleIds.length ||
    new Set(ruleIds).size !== ruleIds.length ||
    ruleIds.some((ruleId) => !editableRuleIdSet.has(ruleId))
  ) {
    throw new ClassificationRuleOrderError();
  }

  await updateClassificationRuleOrder(db, ruleIds, new Date().toISOString());
}

export function setClassificationOverride(
  db: D1Database,
  targetType: string,
  targetId: string,
  categoryId: string,
) {
  return upsertClassificationOverride(db, {
    targetType,
    targetId,
    categoryId,
    now: new Date().toISOString(),
  });
}

export function removeClassificationOverride(
  db: D1Database,
  targetType: string,
  targetId: string,
) {
  return deleteClassificationOverride(db, targetType, targetId);
}

export type CreateClassificationRuleInput = {
  categoryId: string;
  targetType?: string;
  field: string;
  operator: string;
  pattern: string;
  priority?: number;
  description?: string;
};

export async function createClassificationRule(
  db: D1Database,
  input: CreateClassificationRuleInput,
) {
  if (!(await classificationCategoryExists(db, input.categoryId))) {
    throw new ClassificationCategoryNotFoundError();
  }
  const id = `user:${crypto.randomUUID()}`;
  await insertClassificationRule(db, {
    id,
    categoryId: input.categoryId,
    targetType: input.targetType ?? null,
    field: input.field,
    operator: input.operator,
    pattern: input.pattern,
    priority: input.priority ?? 200,
    description: input.description ?? null,
    now: new Date().toISOString(),
  });
  return id;
}

export async function editClassificationRule(
  db: D1Database,
  ruleId: string,
  input: Parameters<typeof updateClassificationRule>[2],
) {
  if (
    input.categoryId &&
    !(await classificationCategoryExists(db, input.categoryId))
  ) {
    throw new ClassificationCategoryNotFoundError();
  }
  if (
    !(await updateClassificationRule(
      db,
      ruleId,
      input,
      new Date().toISOString(),
    ))
  ) {
    throw new ClassificationRuleNotFoundError();
  }
}

export async function removeClassificationRule(db: D1Database, ruleId: string) {
  if (!(await deleteClassificationRule(db, ruleId))) {
    throw new ClassificationRuleNotFoundError();
  }
}
import {
  classificationCategoryExists,
  deleteClassificationOverride,
  deleteClassificationRule,
  findCategoryByLabel,
  insertClassificationCategory,
  insertClassificationRule,
  listClassificationCategories,
  listEditableClassificationRuleIds,
  listClassificationOverrides,
  listClassificationRules,
  listEnabledClassificationRules,
  nextCategorySortOrder,
  updateClassificationRule,
  updateClassificationRuleOrder,
  upsertClassificationOverride,
} from "./repository";
