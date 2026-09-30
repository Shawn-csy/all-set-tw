import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/sqlite-core";

// SQL migrations remain authoritative for schema shape and constraints.

export const classificationCategories = sqliteTable(
  "classification_categories",
  {
    id: text("id").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order")
      .notNull()
      .default(sql`0`),
    isSystem: integer("is_system")
      .notNull()
      .default(sql`1`),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    behavior: text("behavior")
      .notNull()
      .default(sql`'normal'`),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_classification_categories_behavior").on(table.behavior),
    uniqueIndex("idx_classification_categories_label_nocase").on(
      sql`label COLLATE NOCASE`,
    ),
    check(
      "classification_categories_check_behavior",
      sql`behavior IN ('normal', 'asset_transfer', 'cash_withdrawal', 'excluded')`,
    ),
  ],
);

export const classificationOverrides = sqliteTable(
  "classification_overrides",
  {
    id: text("id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    categoryId: text("category_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_classification_overrides_category").on(table.categoryId),
    unique().on(table.targetType, table.targetId),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [classificationCategories.id],
    }),
  ],
);

export const classificationRules = sqliteTable(
  "classification_rules",
  {
    id: text("id").notNull(),
    categoryId: text("category_id").notNull(),
    targetType: text("target_type"),
    field: text("field").notNull(),
    operator: text("operator").notNull(),
    pattern: text("pattern").notNull(),
    priority: integer("priority")
      .notNull()
      .default(sql`100`),
    enabled: integer("enabled")
      .notNull()
      .default(sql`1`),
    isSystem: integer("is_system")
      .notNull()
      .default(sql`0`),
    source: text("source")
      .notNull()
      .default(sql`'user'`),
    description: text("description"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    excludedFromCalculation: integer("excluded_from_calculation")
      .notNull()
      .default(sql`0`),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_classification_rules_category").on(table.categoryId),
    index("idx_classification_rules_enabled_priority").on(
      table.enabled,
      table.targetType,
      table.priority,
    ),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [classificationCategories.id],
    }),
    check(
      "classification_rules_check_1",
      sql`excluded_from_calculation IN (0, 1)`,
    ),
  ],
);

export const classificationMerchants = sqliteTable(
  "classification_merchants",
  {
    id: text("id").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    defaultCategoryId: text("default_category_id"),
    isSystem: integer("is_system")
      .notNull()
      .default(sql`0`),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    uniqueIndex("idx_classification_merchants_normalized_name").on(
      sql`normalized_name COLLATE NOCASE`,
    ),
    index("idx_classification_merchants_default_category").on(
      table.defaultCategoryId,
    ),
    foreignKey({
      columns: [table.defaultCategoryId],
      foreignColumns: [classificationCategories.id],
    }),
    check("classification_merchants_check_is_system", sql`is_system IN (0, 1)`),
  ],
);

export const classificationMerchantRules = sqliteTable(
  "classification_merchant_rules",
  {
    id: text("id").notNull(),
    merchantId: text("merchant_id").notNull(),
    targetType: text("target_type"),
    field: text("field").notNull(),
    operator: text("operator").notNull(),
    pattern: text("pattern").notNull(),
    priority: integer("priority")
      .notNull()
      .default(sql`100`),
    enabled: integer("enabled")
      .notNull()
      .default(sql`1`),
    isSystem: integer("is_system")
      .notNull()
      .default(sql`0`),
    source: text("source")
      .notNull()
      .default(sql`'user'`),
    description: text("description"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_classification_merchant_rules_merchant_priority").on(
      table.merchantId,
      table.enabled,
      table.targetType,
      table.priority,
    ),
    foreignKey({
      columns: [table.merchantId],
      foreignColumns: [classificationMerchants.id],
    }),
    check(
      "classification_merchant_rules_check_enabled",
      sql`enabled IN (0, 1)`,
    ),
    check(
      "classification_merchant_rules_check_is_system",
      sql`is_system IN (0, 1)`,
    ),
    check(
      "classification_merchant_rules_check_target_type",
      sql`target_type IS NULL OR target_type IN ('bank_transaction', 'invoice_item')`,
    ),
    check(
      "classification_merchant_rules_check_field",
      sql`field IN ('merchant_name', 'description', 'counterparty', 'any_text', 'source_id')`,
    ),
    check(
      "classification_merchant_rules_check_operator",
      sql`operator IN ('contains', 'equals', 'starts_with', 'regex')`,
    ),
  ],
);

export const classificationMerchantProductRules = sqliteTable(
  "classification_merchant_product_rules",
  {
    id: text("id").notNull(),
    merchantId: text("merchant_id").notNull(),
    categoryId: text("category_id").notNull(),
    targetType: text("target_type"),
    field: text("field").notNull(),
    operator: text("operator").notNull(),
    pattern: text("pattern").notNull(),
    priority: integer("priority")
      .notNull()
      .default(sql`100`),
    enabled: integer("enabled")
      .notNull()
      .default(sql`1`),
    isSystem: integer("is_system")
      .notNull()
      .default(sql`0`),
    source: text("source")
      .notNull()
      .default(sql`'user'`),
    description: text("description"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_classification_merchant_product_rules_lookup").on(
      table.merchantId,
      table.enabled,
      table.targetType,
      table.priority,
    ),
    index("idx_classification_merchant_product_rules_category").on(
      table.categoryId,
    ),
    foreignKey({
      columns: [table.merchantId],
      foreignColumns: [classificationMerchants.id],
    }),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [classificationCategories.id],
    }),
    check(
      "classification_merchant_product_rules_check_enabled",
      sql`enabled IN (0, 1)`,
    ),
    check(
      "classification_merchant_product_rules_check_is_system",
      sql`is_system IN (0, 1)`,
    ),
    check(
      "classification_merchant_product_rules_check_target_type",
      sql`target_type IS NULL OR target_type IN ('bank_transaction', 'invoice_item')`,
    ),
    check(
      "classification_merchant_product_rules_check_field",
      sql`field IN ('description', 'counterparty', 'any_text', 'source_id')`,
    ),
    check(
      "classification_merchant_product_rules_check_operator",
      sql`operator IN ('contains', 'equals', 'starts_with', 'regex')`,
    ),
  ],
);
