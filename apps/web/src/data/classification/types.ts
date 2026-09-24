export interface ClassificationRuleRow {
  id: string;
  categoryId: string;
  targetType: string;
  field: string;
  operator: string;
  pattern: string;
  priority: number;
  enabled: boolean;
  isSystem: boolean;
  behavior: ClassificationBehavior;
  /** @deprecated Derived from the category behavior for older clients. */
  excludedFromCalculation: boolean;
  description?: string;
  createdAt?: string;
}

export type ClassificationBehavior =
  "normal" | "asset_transfer" | "cash_withdrawal" | "excluded";

export interface ClassificationCategoryRow {
  id: string;
  label: string;
  sortOrder: number;
  isSystem: boolean;
  behavior: ClassificationBehavior;
}
