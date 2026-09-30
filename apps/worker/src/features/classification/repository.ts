import {
  createDrizzle,
  classificationCategories as categories,
  classificationMerchants as merchants,
  classificationMerchantRules as merchantRules,
  classificationMerchantProductRules as productRules,
  classificationOverrides as overrides,
  classificationRules as rules,
} from "@taiwan-fin-hub/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { ConsolidationGroup } from "./consolidation";

export type ClassificationOverrideRow = Awaited<
  ReturnType<typeof listClassificationOverrides>
>[number];
export type ClassificationRuleMatchRow = Awaited<
  ReturnType<typeof listEnabledClassificationRules>
>[number];
export type ClassificationMerchantRow = Awaited<
  ReturnType<typeof listClassificationMerchants>
>[number];
export type ClassificationMerchantRuleMatchRow = Awaited<
  ReturnType<typeof listEnabledClassificationMerchantRules>
>[number];
export type ClassificationMerchantProductRuleMatchRow = Awaited<
  ReturnType<typeof listEnabledClassificationMerchantProductRules>
>[number];

export async function listClassificationOverrides(
  db: D1Database,
  transactionIds: string[],
  targetType: "bank_transaction" | "invoice_item" = "bank_transaction",
) {
  return (
    createDrizzle(db)
      .select({
        target_id: overrides.targetId,
        category_id: overrides.categoryId,
        label: categories.label,
        behavior: categories.behavior,
      })
      .from(overrides)
      .innerJoin(categories, eq(categories.id, overrides.categoryId))
      // Keep one bound JSON array, including for large transaction lists.
      .where(
        and(
          eq(overrides.targetType, targetType),
          sql`${overrides.targetId} IN (SELECT value FROM json_each(${JSON.stringify(transactionIds)}))`,
        ),
      )
      .all()
  );
}

export async function listEnabledClassificationRules(db: D1Database) {
  return createDrizzle(db)
    .select({
      id: rules.id,
      category_id: rules.categoryId,
      label: categories.label,
      target_type: rules.targetType,
      field: rules.field,
      operator: rules.operator,
      pattern: rules.pattern,
      behavior: categories.behavior,
      is_system: rules.isSystem,
      excluded_from_calculation: rules.excludedFromCalculation,
    })
    .from(rules)
    .innerJoin(categories, eq(categories.id, rules.categoryId))
    .where(eq(rules.enabled, 1))
    .orderBy(desc(rules.priority), desc(rules.updatedAt), rules.id)
    .all();
}

export async function listClassificationCategories(db: D1Database) {
  return createDrizzle(db)
    .select({
      id: categories.id,
      label: categories.label,
      sortOrder: categories.sortOrder,
      isSystem: categories.isSystem,
      behavior: categories.behavior,
    })
    .from(categories)
    .orderBy(categories.sortOrder, categories.id)
    .all();
}

export async function findClassificationCategory(
  db: D1Database,
  categoryId: string,
) {
  return (
    (await createDrizzle(db)
      .select({
        id: categories.id,
        label: categories.label,
        sortOrder: categories.sortOrder,
        isSystem: categories.isSystem,
        behavior: categories.behavior,
      })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1)
      .get()) ?? null
  );
}

export async function updateClassificationCategory(
  db: D1Database,
  categoryId: string,
  label: string,
  now: string,
) {
  const result = await createDrizzle(db)
    .update(categories)
    .set({ label, updatedAt: now })
    .where(and(eq(categories.id, categoryId), eq(categories.isSystem, 0)))
    .run();
  return result.meta.changes === 1;
}

export async function updateClassificationCategoryOrder(
  db: D1Database,
  categoryIds: string[],
  now: string,
) {
  const database = createDrizzle(db);
  const statements = categoryIds.map((categoryId, index) =>
    database
      .update(categories)
      .set({ sortOrder: index + 1, updatedAt: now })
      .where(eq(categories.id, categoryId)),
  );
  const [first, ...rest] = statements;
  if (first) await database.batch([first, ...rest]);
}

export async function countClassificationCategoryReferences(
  db: D1Database,
  categoryId: string,
) {
  const database = createDrizzle(db);
  const [ruleCount, overrideCount, merchantCount, productRuleCount] =
    await Promise.all([
      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(rules)
        .where(eq(rules.categoryId, categoryId))
        .get(),
      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(overrides)
        .where(eq(overrides.categoryId, categoryId))
        .get(),
      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(merchants)
        .where(eq(merchants.defaultCategoryId, categoryId))
        .get(),
      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(productRules)
        .where(eq(productRules.categoryId, categoryId))
        .get(),
    ]);
  return [ruleCount, overrideCount, merchantCount, productRuleCount].reduce(
    (total, row) => total + Number(row?.count ?? 0),
    0,
  );
}

export async function deleteClassificationCategory(
  db: D1Database,
  categoryId: string,
) {
  const result = await createDrizzle(db)
    .delete(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.isSystem, 0)))
    .run();
  return result.meta.changes === 1;
}

export async function replaceClassificationCategoryReferences(
  db: D1Database,
  categoryId: string,
  replacementCategoryId: string,
  now: string,
) {
  const database = createDrizzle(db);
  await database.batch([
    database
      .update(rules)
      .set({ categoryId: replacementCategoryId, updatedAt: now })
      .where(eq(rules.categoryId, categoryId)),
    database
      .update(overrides)
      .set({ categoryId: replacementCategoryId, updatedAt: now })
      .where(eq(overrides.categoryId, categoryId)),
    database
      .update(merchants)
      .set({ defaultCategoryId: replacementCategoryId, updatedAt: now })
      .where(eq(merchants.defaultCategoryId, categoryId)),
    database
      .update(productRules)
      .set({ categoryId: replacementCategoryId, updatedAt: now })
      .where(eq(productRules.categoryId, categoryId)),
    database
      .delete(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.isSystem, 0))),
  ]);
}

export async function listClassificationMerchants(db: D1Database) {
  return createDrizzle(db)
    .select({
      id: merchants.id,
      name: merchants.name,
      normalizedName: merchants.normalizedName,
      defaultCategoryId: merchants.defaultCategoryId,
      defaultCategoryLabel: categories.label,
      defaultCategoryBehavior: categories.behavior,
      isSystem: merchants.isSystem,
      createdAt: merchants.createdAt,
      updatedAt: merchants.updatedAt,
    })
    .from(merchants)
    .leftJoin(categories, eq(categories.id, merchants.defaultCategoryId))
    .orderBy(merchants.name, merchants.id)
    .all();
}

export async function findMerchantByNormalizedName(
  db: D1Database,
  normalizedName: string,
) {
  return (
    (await createDrizzle(db)
      .select({ id: merchants.id })
      .from(merchants)
      .where(
        sql`${merchants.normalizedName} = ${normalizedName} COLLATE NOCASE`,
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function findClassificationMerchant(
  db: D1Database,
  merchantId: string,
) {
  return (
    (await createDrizzle(db)
      .select({
        id: merchants.id,
        name: merchants.name,
        normalizedName: merchants.normalizedName,
        defaultCategoryId: merchants.defaultCategoryId,
        defaultCategoryLabel: categories.label,
        defaultCategoryBehavior: categories.behavior,
        isSystem: merchants.isSystem,
      })
      .from(merchants)
      .leftJoin(categories, eq(categories.id, merchants.defaultCategoryId))
      .where(eq(merchants.id, merchantId))
      .limit(1)
      .get()) ?? null
  );
}

export async function insertClassificationMerchant(
  db: D1Database,
  input: {
    id: string;
    name: string;
    normalizedName: string;
    defaultCategoryId: string | null;
    now: string;
  },
) {
  await createDrizzle(db)
    .insert(merchants)
    .values({
      id: input.id,
      name: input.name,
      normalizedName: input.normalizedName,
      defaultCategoryId: input.defaultCategoryId,
      isSystem: 0,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();
}

export async function updateClassificationMerchant(
  db: D1Database,
  merchantId: string,
  input: {
    name?: string;
    normalizedName?: string;
    defaultCategoryId?: string | null;
  },
  now: string,
) {
  const result = await createDrizzle(db)
    .update(merchants)
    .set({
      name: input.name,
      normalizedName: input.normalizedName,
      defaultCategoryId: input.defaultCategoryId,
      updatedAt: now,
    })
    .where(and(eq(merchants.id, merchantId), eq(merchants.isSystem, 0)))
    .run();
  return result.meta.changes === 1;
}

export async function deleteClassificationMerchant(
  db: D1Database,
  merchantId: string,
) {
  const result = await createDrizzle(db)
    .delete(merchants)
    .where(and(eq(merchants.id, merchantId), eq(merchants.isSystem, 0)))
    .run();
  return result.meta.changes === 1;
}

export async function listEnabledClassificationMerchantRules(db: D1Database) {
  return createDrizzle(db)
    .select({
      id: merchantRules.id,
      merchantId: merchantRules.merchantId,
      merchantName: merchants.name,
      targetType: merchantRules.targetType,
      field: merchantRules.field,
      operator: merchantRules.operator,
      pattern: merchantRules.pattern,
      priority: merchantRules.priority,
      enabled: merchantRules.enabled,
      isSystem: merchantRules.isSystem,
      source: merchantRules.source,
      description: merchantRules.description,
      createdAt: merchantRules.createdAt,
      updatedAt: merchantRules.updatedAt,
    })
    .from(merchantRules)
    .innerJoin(merchants, eq(merchants.id, merchantRules.merchantId))
    .where(eq(merchantRules.enabled, 1))
    .orderBy(
      desc(merchantRules.priority),
      desc(merchantRules.updatedAt),
      merchantRules.id,
    )
    .all();
}

export async function listClassificationMerchantRules(db: D1Database) {
  return createDrizzle(db)
    .select({
      id: merchantRules.id,
      merchantId: merchantRules.merchantId,
      merchantName: merchants.name,
      targetType: merchantRules.targetType,
      field: merchantRules.field,
      operator: merchantRules.operator,
      pattern: merchantRules.pattern,
      priority: merchantRules.priority,
      enabled: merchantRules.enabled,
      isSystem: merchantRules.isSystem,
      source: merchantRules.source,
      description: merchantRules.description,
      createdAt: merchantRules.createdAt,
      updatedAt: merchantRules.updatedAt,
    })
    .from(merchantRules)
    .innerJoin(merchants, eq(merchants.id, merchantRules.merchantId))
    .orderBy(
      desc(merchantRules.priority),
      desc(merchantRules.updatedAt),
      merchantRules.id,
    )
    .all();
}

export async function listEnabledClassificationMerchantProductRules(
  db: D1Database,
) {
  return createDrizzle(db)
    .select({
      id: productRules.id,
      merchantId: productRules.merchantId,
      merchantName: merchants.name,
      categoryId: productRules.categoryId,
      categoryLabel: categories.label,
      categoryBehavior: categories.behavior,
      targetType: productRules.targetType,
      field: productRules.field,
      operator: productRules.operator,
      pattern: productRules.pattern,
      priority: productRules.priority,
      enabled: productRules.enabled,
      isSystem: productRules.isSystem,
      source: productRules.source,
      description: productRules.description,
      createdAt: productRules.createdAt,
      updatedAt: productRules.updatedAt,
    })
    .from(productRules)
    .innerJoin(merchants, eq(merchants.id, productRules.merchantId))
    .innerJoin(categories, eq(categories.id, productRules.categoryId))
    .where(eq(productRules.enabled, 1))
    .orderBy(
      desc(productRules.priority),
      desc(productRules.updatedAt),
      productRules.id,
    )
    .all();
}

export async function listClassificationMerchantProductRules(db: D1Database) {
  return createDrizzle(db)
    .select({
      id: productRules.id,
      merchantId: productRules.merchantId,
      merchantName: merchants.name,
      categoryId: productRules.categoryId,
      categoryLabel: categories.label,
      categoryBehavior: categories.behavior,
      targetType: productRules.targetType,
      field: productRules.field,
      operator: productRules.operator,
      pattern: productRules.pattern,
      priority: productRules.priority,
      enabled: productRules.enabled,
      isSystem: productRules.isSystem,
      source: productRules.source,
      description: productRules.description,
      createdAt: productRules.createdAt,
      updatedAt: productRules.updatedAt,
    })
    .from(productRules)
    .innerJoin(merchants, eq(merchants.id, productRules.merchantId))
    .innerJoin(categories, eq(categories.id, productRules.categoryId))
    .orderBy(
      desc(productRules.priority),
      desc(productRules.updatedAt),
      productRules.id,
    )
    .all();
}

export async function insertClassificationMerchantRule(
  db: D1Database,
  input: {
    id: string;
    merchantId: string;
    targetType: string | null;
    field: string;
    operator: string;
    pattern: string;
    priority: number;
    description: string | null;
    now: string;
  },
) {
  await createDrizzle(db)
    .insert(merchantRules)
    .values({
      id: input.id,
      merchantId: input.merchantId,
      targetType: input.targetType,
      field: input.field,
      operator: input.operator,
      pattern: input.pattern,
      priority: input.priority,
      enabled: 1,
      isSystem: 0,
      source: "user",
      description: input.description,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();
}

export async function insertClassificationMerchantProductRule(
  db: D1Database,
  input: {
    id: string;
    merchantId: string;
    categoryId: string;
    targetType: string | null;
    field: string;
    operator: string;
    pattern: string;
    priority: number;
    description: string | null;
    now: string;
  },
) {
  await createDrizzle(db)
    .insert(productRules)
    .values({
      id: input.id,
      merchantId: input.merchantId,
      categoryId: input.categoryId,
      targetType: input.targetType,
      field: input.field,
      operator: input.operator,
      pattern: input.pattern,
      priority: input.priority,
      enabled: 1,
      isSystem: 0,
      source: "user",
      description: input.description,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();
}

export async function updateClassificationMerchantRule(
  db: D1Database,
  ruleId: string,
  input: {
    merchantId?: string;
    field?: string;
    operator?: string;
    pattern?: string;
    priority?: number;
    enabled?: boolean;
    description?: string | null;
  },
  now: string,
) {
  const result = await createDrizzle(db)
    .update(merchantRules)
    .set({
      merchantId: input.merchantId,
      field: input.field,
      operator: input.operator,
      pattern: input.pattern,
      priority: input.priority,
      enabled: input.enabled === undefined ? undefined : input.enabled ? 1 : 0,
      description: input.description,
      updatedAt: now,
    })
    .where(and(eq(merchantRules.id, ruleId), eq(merchantRules.isSystem, 0)))
    .run();
  return result.meta.changes === 1;
}

export async function updateClassificationMerchantProductRule(
  db: D1Database,
  ruleId: string,
  input: {
    merchantId?: string;
    categoryId?: string;
    field?: string;
    operator?: string;
    pattern?: string;
    priority?: number;
    enabled?: boolean;
    description?: string | null;
  },
  now: string,
) {
  const result = await createDrizzle(db)
    .update(productRules)
    .set({
      merchantId: input.merchantId,
      categoryId: input.categoryId,
      field: input.field,
      operator: input.operator,
      pattern: input.pattern,
      priority: input.priority,
      enabled: input.enabled === undefined ? undefined : input.enabled ? 1 : 0,
      description: input.description,
      updatedAt: now,
    })
    .where(and(eq(productRules.id, ruleId), eq(productRules.isSystem, 0)))
    .run();
  return result.meta.changes === 1;
}

export async function deleteClassificationMerchantRule(
  db: D1Database,
  ruleId: string,
) {
  const result = await createDrizzle(db)
    .delete(merchantRules)
    .where(and(eq(merchantRules.id, ruleId), eq(merchantRules.isSystem, 0)))
    .run();
  return result.meta.changes === 1;
}

export async function deleteClassificationMerchantProductRule(
  db: D1Database,
  ruleId: string,
) {
  const result = await createDrizzle(db)
    .delete(productRules)
    .where(and(eq(productRules.id, ruleId), eq(productRules.isSystem, 0)))
    .run();
  return result.meta.changes === 1;
}

export async function findCategoryByLabel(db: D1Database, label: string) {
  return (
    (await createDrizzle(db)
      .select({ id: categories.id })
      .from(categories)
      .where(sql`${categories.label} = ${label} COLLATE NOCASE`)
      .limit(1)
      .get()) ?? null
  );
}

export async function nextCategorySortOrder(db: D1Database) {
  const row = await createDrizzle(db)
    .select({
      sortOrder: sql<number>`COALESCE(MAX(${categories.sortOrder}), 0) + 1`,
    })
    .from(categories)
    .get();
  return Number(row?.sortOrder ?? 1);
}

export async function insertClassificationCategory(
  db: D1Database,
  input: { id: string; label: string; sortOrder: number; now: string },
) {
  await createDrizzle(db)
    .insert(categories)
    .values({
      id: input.id,
      label: input.label,
      sortOrder: input.sortOrder,
      isSystem: 0,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();
}

export async function listClassificationRules(db: D1Database) {
  return createDrizzle(db)
    .select({
      id: rules.id,
      categoryId: rules.categoryId,
      targetType: rules.targetType,
      field: rules.field,
      operator: rules.operator,
      pattern: rules.pattern,
      priority: rules.priority,
      enabled: rules.enabled,
      isSystem: rules.isSystem,
      source: rules.source,
      description: rules.description,
      behavior: categories.behavior,
      excludedFromCalculation: rules.excludedFromCalculation,
    })
    .from(rules)
    .innerJoin(categories, eq(categories.id, rules.categoryId))
    .orderBy(desc(rules.priority), desc(rules.updatedAt), rules.id)
    .all();
}

export async function listEditableClassificationRuleIds(db: D1Database) {
  const rows = await createDrizzle(db)
    .select({ id: rules.id })
    .from(rules)
    .where(eq(rules.isSystem, 0))
    .orderBy(desc(rules.priority), desc(rules.updatedAt), rules.id)
    .all();
  return rows.map((row) => row.id);
}

export async function updateClassificationRuleOrder(
  db: D1Database,
  ruleIds: string[],
  now: string,
) {
  const database = createDrizzle(db);
  const topPriority = 1000 + ruleIds.length;
  const [first, ...rest] = ruleIds.map((ruleId, index) =>
    database
      .update(rules)
      .set({ priority: topPriority - index, updatedAt: now })
      .where(and(eq(rules.id, ruleId), eq(rules.isSystem, 0))),
  );
  if (first) await database.batch([first, ...rest]);
}

export async function upsertClassificationOverride(
  db: D1Database,
  input: {
    targetType: string;
    targetId: string;
    categoryId: string;
    now: string;
  },
) {
  await createDrizzle(db)
    .insert(overrides)
    .values({
      id: `override:${input.targetType}:${input.targetId}`,
      targetType: input.targetType,
      targetId: input.targetId,
      categoryId: input.categoryId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [overrides.targetType, overrides.targetId],
      set: { categoryId: input.categoryId, updatedAt: input.now },
    })
    .run();
}

export async function deleteClassificationOverride(
  db: D1Database,
  targetType: string,
  targetId: string,
) {
  await createDrizzle(db)
    .delete(overrides)
    .where(
      and(
        eq(overrides.targetType, targetType),
        eq(overrides.targetId, targetId),
      ),
    )
    .run();
}

export async function findClassificationOverride(
  db: D1Database,
  targetType: string,
  targetId: string,
) {
  return (
    (await createDrizzle(db)
      .select({ categoryId: overrides.categoryId })
      .from(overrides)
      .where(
        and(
          eq(overrides.targetType, targetType),
          eq(overrides.targetId, targetId),
        ),
      )
      .get()) ?? null
  );
}

export async function classificationCategoryExists(
  db: D1Database,
  categoryId: string,
) {
  return Boolean(
    await createDrizzle(db)
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .get(),
  );
}

export async function insertClassificationRule(
  db: D1Database,
  input: {
    id: string;
    categoryId: string;
    targetType: string | null;
    field: string;
    operator: string;
    pattern: string;
    priority: number;
    description: string | null;
    now: string;
  },
) {
  await createDrizzle(db)
    .insert(rules)
    .values({
      id: input.id,
      categoryId: input.categoryId,
      targetType: input.targetType,
      field: input.field,
      operator: input.operator,
      pattern: input.pattern,
      priority: input.priority,
      enabled: 1,
      isSystem: 0,
      source: "user",
      description: input.description,
      // Kept at the schema boundary for migration compatibility. The
      // category behavior is the source of truth for new rules.
      excludedFromCalculation: 0,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();
}

export async function updateClassificationRule(
  db: D1Database,
  ruleId: string,
  input: {
    categoryId?: string;
    operator?: string;
    pattern?: string;
    priority?: number;
    enabled?: boolean;
    description?: string | null;
  },
  now: string,
) {
  const result = await createDrizzle(db)
    .update(rules)
    .set({
      categoryId: input.categoryId || undefined,
      operator: input.operator,
      pattern: input.pattern,
      priority: input.priority,
      enabled: input.enabled === undefined ? undefined : input.enabled ? 1 : 0,
      description: input.description,
      updatedAt: now,
    })
    .where(and(eq(rules.id, ruleId), eq(rules.isSystem, 0)))
    .run();
  return result.meta.changes === 1;
}

export async function deleteClassificationRule(db: D1Database, ruleId: string) {
  const result = await createDrizzle(db)
    .delete(rules)
    .where(and(eq(rules.id, ruleId), eq(rules.isSystem, 0)))
    .run();
  return result.meta.changes === 1;
}

/** D1 batch commits the retained regex and retired rules atomically. */
export async function applyClassificationRuleConsolidation(
  db: D1Database,
  groups: readonly ConsolidationGroup[],
) {
  const statements = groups.flatMap((group) => [
    db
      .prepare(
        "UPDATE classification_rules SET operator = 'regex', pattern = ?, description = ? WHERE id = ? AND is_system = 0 AND source = 'user' AND operator IN ('contains', 'regex')",
      )
      .bind(group.pattern, group.description, group.keepId),
    ...group.removeIds.map((id) =>
      db
        .prepare(
          "DELETE FROM classification_rules WHERE id = ? AND is_system = 0 AND source = 'user' AND operator IN ('contains', 'regex')",
        )
        .bind(id),
    ),
  ]);
  if (statements.length > 0) await db.batch(statements);
}
