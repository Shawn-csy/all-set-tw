export type ClassificationResult = {
  categoryId: string;
  label: string;
  behavior: ClassificationBehavior;
  source:
    | "override"
    | "user_rule"
    | "system_rule"
    | "merchant_product_rule"
    | "merchant_default"
    | "auto_transfer"
    | "auto_offset"
    | "fallback";
  ruleId?: string;
  merchantId?: string;
  merchantRuleId?: string;
  /** @deprecated Derived from behavior for older API consumers. */
  excludedFromCalculation?: boolean;
};

export type ClassificationBehavior =
  "normal" | "asset_transfer" | "cash_withdrawal" | "excluded";

export type ClassifiedTransaction = {
  id: string;
  description?: string | null;
  counterparty?: string | null;
  merchantName?: string | null;
  /** Explicit merchant selected for an invoice; takes precedence over text rules. */
  merchantId?: string | null;
  sourceId: string;
  amount?: number;
  accountType?: string | null;
};

export type ClassificationTargetType = "bank_transaction" | "invoice_item";

export function normalizeMerchantName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/\s+/g, " ")
    .trim();
}

type TextRule = { field: string; operator: string; pattern: string };

function normalizeClassificationText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-TW");
}

function matchesTextRule(rule: TextRule, transaction: ClassifiedTransaction) {
  const values = {
    merchant_name:
      transaction.merchantName ??
      transaction.counterparty ??
      transaction.description,
    description: transaction.description,
    counterparty: transaction.counterparty,
    source_id: transaction.sourceId,
  };
  const text =
    rule.field === "any_text"
      ? [
          transaction.merchantName,
          transaction.description,
          transaction.counterparty,
          transaction.sourceId,
        ]
          .filter(Boolean)
          .join(" ")
      : (values[rule.field as keyof typeof values] ?? "");
  const normalizedText = normalizeClassificationText(text);
  const normalizedPattern = normalizeClassificationText(rule.pattern);

  if (rule.operator === "contains")
    return normalizedText.includes(normalizedPattern);
  if (rule.operator === "equals") return normalizedText === normalizedPattern;
  if (rule.operator === "starts_with")
    return normalizedText.startsWith(normalizedPattern);
  if (rule.operator === "regex") {
    try {
      return new RegExp(rule.pattern, "i").test(text);
    } catch {
      return false;
    }
  }
  return false;
}

export function matchesClassificationRule(
  rule: { field: string; operator: string; pattern: string },
  transaction: ClassifiedTransaction,
) {
  // Connectors do not agree on which column contains the merchant memo:
  // some put it in description, others put it in counterparty. Keep
  // source_id exact, but let the human-facing fields share their text so a
  // valid rule does not silently become ineffective after a connector sync.
  const merchantText = normalizeClassificationText(
    transaction.merchantName ?? "",
  );
  const descriptionText = [transaction.description, transaction.counterparty]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW");
  const counterpartyText = [transaction.counterparty, transaction.description]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW");
  const anyText = [
    transaction.merchantName,
    transaction.description,
    transaction.counterparty,
    transaction.sourceId,
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW");
  const text =
    rule.field === "merchant_name"
      ? merchantText
      : rule.field === "description"
        ? descriptionText
        : rule.field === "counterparty"
          ? counterpartyText
          : rule.field === "source_id"
            ? normalizeClassificationText(transaction.sourceId)
            : anyText;

  const pattern = normalizeClassificationText(rule.pattern);
  if (rule.operator === "contains") return text.includes(pattern);
  if (rule.operator === "equals") return text === pattern;
  if (rule.operator === "starts_with") return text.startsWith(pattern);
  if (rule.operator === "regex") {
    try {
      return new RegExp(pattern, "i").test(text);
    } catch {
      return false;
    }
  }
  return false;
}

export async function resolveClassifications(
  db: D1Database,
  transactions: ClassifiedTransaction[],
  targetType: ClassificationTargetType = "bank_transaction",
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
    listClassificationOverrides(db, transactionIds, targetType),
    listEnabledClassificationRules(db),
  ]);
  let merchants: Awaited<ReturnType<typeof listClassificationMerchants>> = [];
  let merchantRules: Awaited<
    ReturnType<typeof listEnabledClassificationMerchantRules>
  > = [];
  let productRules: Awaited<
    ReturnType<typeof listEnabledClassificationMerchantProductRules>
  > = [];
  try {
    [merchants, merchantRules, productRules] = await Promise.all([
      listClassificationMerchants(db),
      listEnabledClassificationMerchantRules(db),
      listEnabledClassificationMerchantProductRules(db),
    ]);
  } catch {
    // Keep databases created before the merchant-layer migration readable.
    // The legacy classification rules remain the compatibility fallback.
  }

  const overrideMap = new Map(
    overrides.map((override) => [normalizeId(override.target_id), override]),
  );
  const result = new Map<string, ClassificationResult>();
  const merchantById = new Map(
    merchants.map((merchant) => [merchant.id, merchant]),
  );

  for (const transaction of transactions) {
    const override = overrideMap.get(normalizeId(transaction.id));
    const overrideIsValidCashWithdrawal =
      override?.behavior !== "cash_withdrawal" ||
      (targetType === "bank_transaction" &&
        typeof transaction.amount === "number" &&
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

    const forcedMerchant = transaction.merchantId
      ? merchantById.get(transaction.merchantId)
      : undefined;
    const merchantRule = forcedMerchant
      ? undefined
      : merchantRules.find(
          (rule) =>
            (!rule.targetType || rule.targetType === targetType) &&
            matchesTextRule(rule, transaction),
        );
    const merchant =
      forcedMerchant ??
      (merchantRule ? merchantById.get(merchantRule.merchantId) : undefined);
    const productRule = merchant
      ? productRules.find(
          (rule) =>
            rule.merchantId === merchant.id &&
            (!rule.targetType || rule.targetType === targetType) &&
            matchesTextRule(rule, transaction),
        )
      : undefined;

    let matched: ClassificationResult | undefined;
    if (
      productRule &&
      isClassificationBehaviorAllowed(
        productRule.categoryBehavior,
        transaction,
        targetType,
      )
    ) {
      matched = {
        categoryId: productRule.categoryId,
        label: productRule.categoryLabel,
        behavior: productRule.categoryBehavior as ClassificationBehavior,
        source: "merchant_product_rule",
        ruleId: productRule.id,
        merchantId: merchant!.id,
        merchantRuleId: merchantRule?.id,
        excludedFromCalculation: productRule.categoryBehavior !== "normal",
      };
    } else if (
      merchant?.defaultCategoryId &&
      merchant.defaultCategoryLabel &&
      isClassificationBehaviorAllowed(
        merchant.defaultCategoryBehavior,
        transaction,
        targetType,
      )
    ) {
      matched = {
        categoryId: merchant.defaultCategoryId,
        label: merchant.defaultCategoryLabel,
        behavior: merchant.defaultCategoryBehavior as ClassificationBehavior,
        source: "merchant_default",
        merchantId: merchant.id,
        merchantRuleId: merchantRule?.id,
        excludedFromCalculation: merchant.defaultCategoryBehavior !== "normal",
      };
    }

    if (matched) {
      result.set(transaction.id, matched);
      continue;
    }

    for (const rule of rules) {
      if (rule.target_type && rule.target_type !== targetType) continue;
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
        (targetType !== "bank_transaction" ||
          !(typeof transaction.amount === "number" && transaction.amount < 0) ||
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

function isClassificationBehaviorAllowed(
  behavior: string | null | undefined,
  transaction: ClassifiedTransaction,
  targetType: ClassificationTargetType,
) {
  return (
    behavior !== "cash_withdrawal" ||
    (targetType === "bank_transaction" &&
      typeof transaction.amount === "number" &&
      transaction.amount < 0 &&
      transaction.accountType !== "credit")
  );
}

export class ClassificationCategoryExistsError extends Error {}
export class ClassificationCategoryNotFoundError extends Error {}
export class ClassificationCategorySystemError extends Error {}
export class ClassificationCategoryInUseError extends Error {}
export class ClassificationCategoryOrderError extends Error {}
export class ClassificationRuleNotFoundError extends Error {}
export class ClassificationRuleOrderError extends Error {}
export class ClassificationMerchantExistsError extends Error {}
export class ClassificationMerchantNotFoundError extends Error {}
export class ClassificationMerchantRuleNotFoundError extends Error {}

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

export async function editClassificationCategory(
  db: D1Database,
  categoryId: string,
  label: string,
) {
  const category = await findClassificationCategory(db, categoryId);
  if (!category) throw new ClassificationCategoryNotFoundError();
  if (category.isSystem) throw new ClassificationCategorySystemError();
  const duplicate = await findCategoryByLabel(db, label);
  if (duplicate && duplicate.id !== categoryId) {
    throw new ClassificationCategoryExistsError();
  }
  if (
    !(await updateClassificationCategory(
      db,
      categoryId,
      label,
      new Date().toISOString(),
    ))
  ) {
    throw new ClassificationCategoryNotFoundError();
  }
  return { ...category, label, isSystem: false };
}

export async function reorderClassificationCategories(
  db: D1Database,
  categoryIds: string[],
) {
  const categories = await listClassificationCategories(db);
  const expectedIds = new Set(categories.map((category) => category.id));
  if (
    categoryIds.length !== categories.length ||
    new Set(categoryIds).size !== categoryIds.length ||
    categoryIds.some((categoryId) => !expectedIds.has(categoryId))
  ) {
    throw new ClassificationCategoryOrderError();
  }
  await updateClassificationCategoryOrder(
    db,
    categoryIds,
    new Date().toISOString(),
  );
}

export async function removeClassificationCategory(
  db: D1Database,
  categoryId: string,
  replacementCategoryId?: string,
) {
  const category = await findClassificationCategory(db, categoryId);
  if (!category) throw new ClassificationCategoryNotFoundError();
  if (category.isSystem) throw new ClassificationCategorySystemError();
  const replacement = replacementCategoryId
    ? await findClassificationCategory(db, replacementCategoryId)
    : null;
  if (replacementCategoryId && !replacement) {
    throw new ClassificationCategoryNotFoundError();
  }
  if (replacementCategoryId === categoryId) {
    throw new ClassificationCategoryInUseError();
  }
  const now = new Date().toISOString();
  if (replacement) {
    await replaceClassificationCategoryReferences(
      db,
      categoryId,
      replacement.id,
      now,
    );
    return;
  }
  if (await countClassificationCategoryReferences(db, categoryId)) {
    throw new ClassificationCategoryInUseError();
  }
  if (!(await deleteClassificationCategory(db, categoryId))) {
    throw new ClassificationCategoryNotFoundError();
  }
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

export async function getClassificationMerchants(db: D1Database) {
  const [merchantRows, merchantRuleRows, productRuleRows] = await Promise.all([
    listClassificationMerchants(db),
    listClassificationMerchantRules(db),
    listClassificationMerchantProductRules(db),
  ]);
  return {
    merchants: merchantRows.map((row) => ({
      ...row,
      isSystem: Boolean(row.isSystem),
      defaultCategoryBehavior: row.defaultCategoryBehavior ?? "normal",
    })),
    merchantRules: merchantRuleRows.map((row) => ({
      ...row,
      enabled: Boolean(row.enabled),
      isSystem: Boolean(row.isSystem),
    })),
    productRules: productRuleRows.map((row) => ({
      ...row,
      enabled: Boolean(row.enabled),
      isSystem: Boolean(row.isSystem),
    })),
  };
}

export type CreateClassificationMerchantInput = {
  name: string;
  defaultCategoryId?: string | null;
};

export async function createClassificationMerchant(
  db: D1Database,
  input: CreateClassificationMerchantInput,
) {
  const name = input.name.trim();
  const normalizedName = normalizeMerchantName(name);
  if (await findMerchantByNormalizedName(db, normalizedName)) {
    throw new ClassificationMerchantExistsError();
  }
  if (
    input.defaultCategoryId &&
    !(await classificationCategoryExists(db, input.defaultCategoryId))
  ) {
    throw new ClassificationCategoryNotFoundError();
  }
  const id = `merchant:${crypto.randomUUID()}`;
  await insertClassificationMerchant(db, {
    id,
    name,
    normalizedName,
    defaultCategoryId: input.defaultCategoryId ?? null,
    now: new Date().toISOString(),
  });
  return (
    (await findClassificationMerchant(db, id)) ?? {
      id,
      name,
      normalizedName,
      defaultCategoryId: input.defaultCategoryId ?? null,
      isSystem: 0,
    }
  );
}

export async function editClassificationMerchant(
  db: D1Database,
  merchantId: string,
  input: { name?: string; defaultCategoryId?: string | null },
) {
  const merchant = await findClassificationMerchant(db, merchantId);
  if (!merchant) throw new ClassificationMerchantNotFoundError();
  if (
    input.defaultCategoryId &&
    !(await classificationCategoryExists(db, input.defaultCategoryId))
  ) {
    throw new ClassificationCategoryNotFoundError();
  }
  const name = input.name?.trim();
  const normalizedName = name ? normalizeMerchantName(name) : undefined;
  if (
    normalizedName &&
    normalizedName !== merchant.normalizedName &&
    (await findMerchantByNormalizedName(db, normalizedName))
  ) {
    throw new ClassificationMerchantExistsError();
  }
  if (
    !(await updateClassificationMerchant(
      db,
      merchantId,
      {
        name,
        normalizedName,
        defaultCategoryId: input.defaultCategoryId,
      },
      new Date().toISOString(),
    ))
  ) {
    throw new ClassificationMerchantNotFoundError();
  }
}

export type CreateClassificationMerchantRuleInput = {
  merchantId: string;
  targetType?: ClassificationTargetType;
  field: string;
  operator: string;
  pattern: string;
  priority?: number;
  description?: string;
};

export async function createClassificationMerchantRule(
  db: D1Database,
  input: CreateClassificationMerchantRuleInput,
) {
  if (!(await findClassificationMerchant(db, input.merchantId))) {
    throw new ClassificationMerchantNotFoundError();
  }
  const id = `merchant-rule:${crypto.randomUUID()}`;
  await insertClassificationMerchantRule(db, {
    id,
    merchantId: input.merchantId,
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

export type CreateClassificationMerchantProductRuleInput =
  CreateClassificationMerchantRuleInput & { categoryId: string };

export async function createClassificationMerchantProductRule(
  db: D1Database,
  input: CreateClassificationMerchantProductRuleInput,
) {
  if (!(await findClassificationMerchant(db, input.merchantId))) {
    throw new ClassificationMerchantNotFoundError();
  }
  if (!(await classificationCategoryExists(db, input.categoryId))) {
    throw new ClassificationCategoryNotFoundError();
  }
  const id = `merchant-product-rule:${crypto.randomUUID()}`;
  await insertClassificationMerchantProductRule(db, {
    id,
    merchantId: input.merchantId,
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

export async function editClassificationMerchantRule(
  db: D1Database,
  ruleId: string,
  input: Parameters<typeof updateClassificationMerchantRule>[2],
) {
  if (
    input.merchantId &&
    !(await findClassificationMerchant(db, input.merchantId))
  ) {
    throw new ClassificationMerchantNotFoundError();
  }
  if (
    !(await updateClassificationMerchantRule(
      db,
      ruleId,
      input,
      new Date().toISOString(),
    ))
  ) {
    throw new ClassificationMerchantRuleNotFoundError();
  }
}

export async function editClassificationMerchantProductRule(
  db: D1Database,
  ruleId: string,
  input: Parameters<typeof updateClassificationMerchantProductRule>[2],
) {
  if (
    input.merchantId &&
    !(await findClassificationMerchant(db, input.merchantId))
  ) {
    throw new ClassificationMerchantNotFoundError();
  }
  if (
    input.categoryId &&
    !(await classificationCategoryExists(db, input.categoryId))
  ) {
    throw new ClassificationCategoryNotFoundError();
  }
  if (
    !(await updateClassificationMerchantProductRule(
      db,
      ruleId,
      input,
      new Date().toISOString(),
    ))
  ) {
    throw new ClassificationMerchantRuleNotFoundError();
  }
}

export async function removeClassificationMerchantRule(
  db: D1Database,
  ruleId: string,
  kind: "merchant" | "product",
) {
  const removed =
    kind === "merchant"
      ? await deleteClassificationMerchantRule(db, ruleId)
      : await deleteClassificationMerchantProductRule(db, ruleId);
  if (!removed) throw new ClassificationMerchantRuleNotFoundError();
}

export async function consolidateClassificationRules(db: D1Database) {
  const groups = planClassificationRuleConsolidation(
    await listClassificationRules(db),
  );
  await applyClassificationRuleConsolidation(db, groups);
  const retainedRuleIds = Object.fromEntries(
    groups.flatMap((group) =>
      group.removeIds.map((id) => [id, group.keepId] as const),
    ),
  );
  return {
    mergedGroups: groups.length,
    removedRules: groups.reduce(
      (count, group) => count + group.removeIds.length,
      0,
    ),
    retainedRuleIds,
  };
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
  const consolidation = await consolidateClassificationRules(db);
  return consolidation.retainedRuleIds[id] ?? id;
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
  await consolidateClassificationRules(db);
}

export async function removeClassificationRule(db: D1Database, ruleId: string) {
  if (!(await deleteClassificationRule(db, ruleId))) {
    throw new ClassificationRuleNotFoundError();
  }
}
import {
  applyClassificationRuleConsolidation,
  classificationCategoryExists,
  deleteClassificationOverride,
  deleteClassificationRule,
  findCategoryByLabel,
  insertClassificationCategory,
  insertClassificationRule,
  deleteClassificationMerchantProductRule,
  deleteClassificationMerchantRule,
  findClassificationMerchant,
  findMerchantByNormalizedName,
  insertClassificationMerchant,
  insertClassificationMerchantProductRule,
  insertClassificationMerchantRule,
  listClassificationMerchantProductRules,
  listClassificationMerchantRules,
  listClassificationMerchants,
  listEnabledClassificationMerchantProductRules,
  listEnabledClassificationMerchantRules,
  updateClassificationMerchantProductRule,
  updateClassificationMerchantRule,
  updateClassificationMerchant,
  listClassificationCategories,
  findClassificationCategory,
  updateClassificationCategory,
  updateClassificationCategoryOrder,
  countClassificationCategoryReferences,
  deleteClassificationCategory,
  replaceClassificationCategoryReferences,
  listEditableClassificationRuleIds,
  listClassificationOverrides,
  listClassificationRules,
  listEnabledClassificationRules,
  nextCategorySortOrder,
  updateClassificationRule,
  updateClassificationRuleOrder,
  upsertClassificationOverride,
} from "./repository";
import { planClassificationRuleConsolidation } from "./consolidation";

export { findClassificationMerchant };
