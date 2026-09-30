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

export type ClassificationTargetType = "bank_transaction" | "invoice_item";

export interface ClassificationMerchantRow {
  id: string;
  name: string;
  normalizedName: string;
  defaultCategoryId?: string | null;
  defaultCategoryLabel?: string | null;
  defaultCategoryBehavior?: ClassificationBehavior | null;
  isSystem: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClassificationMerchantRuleRow {
  id: string;
  merchantId: string;
  merchantName: string;
  targetType?: ClassificationTargetType | null;
  field: string;
  operator: string;
  pattern: string;
  priority: number;
  enabled: boolean;
  isSystem: boolean;
  source: string;
  description?: string | null;
}

export interface ClassificationMerchantProductRuleRow extends ClassificationMerchantRuleRow {
  categoryId: string;
  categoryLabel: string;
  categoryBehavior: ClassificationBehavior;
}

export interface ClassificationMerchantsResponse {
  merchants: ClassificationMerchantRow[];
  merchantRules: ClassificationMerchantRuleRow[];
  productRules: ClassificationMerchantProductRuleRow[];
}
