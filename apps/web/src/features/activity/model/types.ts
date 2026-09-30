import type { ActivityItem } from "@taiwan-fin-hub/core";
import type { RuleInputMode } from "@/shared/classification-rule-pattern";
export type { ActivityItem } from "@taiwan-fin-hub/core";

export interface PendingCategoryUpdate {
  item: ActivityItem;
  targetType: "bank_transaction" | "invoice_item";
  targetId: string;
  categoryId: string;
  addRule: boolean;
  pattern: string;
  operator: RuleInputMode;
}

export interface CategoryUpdateInput {
  targetType: "bank_transaction" | "invoice_item";
  targetId: string;
  categoryId: string;
  addRule: boolean;
  pattern: string;
  operator: RuleInputMode;
}

export interface PendingCalculationUpdate {
  item: ActivityItem;
  categoryId: string;
  applyRule: boolean;
  pattern: string;
  operator: "contains" | "equals";
}

export interface CalculationUpdateInput {
  transactionId: string;
  categoryId: string;
  originalCategoryId: string;
  applyRule: boolean;
  ruleId?: string;
  pattern: string;
  operator: "contains" | "equals";
}
