import type {
  ClassificationCategoryRow,
  ClassificationRuleRow,
} from "@/data/classification/types";

export type RuleTarget = "bank_transaction" | "invoice_item";

export function editableRules(rules: readonly ClassificationRuleRow[]) {
  return rules.filter((rule) => !rule.isSystem);
}

export function rulesForTarget(
  rules: readonly ClassificationRuleRow[],
  target: RuleTarget,
  search = "",
  categoryLabels: Readonly<Record<string, string>> = {},
) {
  const query = search.trim().toLocaleLowerCase("zh-TW");
  return editableRules(rules).filter(
    (rule) =>
      (rule.targetType === target || !rule.targetType) &&
      (!query ||
        [
          rule.pattern,
          categoryLabels[rule.categoryId],
          rule.categoryId,
          rule.description,
        ]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase("zh-TW").includes(query))),
  );
}

export type ClassificationRuleCategoryGroup = {
  categoryId: string;
  label: string;
  rules: ClassificationRuleRow[];
};

/** Groups visible rules by category while keeping the user's category order. */
export function groupRulesByCategory(
  rules: readonly ClassificationRuleRow[],
  categories: readonly Pick<ClassificationCategoryRow, "id" | "label">[],
) {
  const grouped = new Map<string, ClassificationRuleRow[]>();
  for (const rule of rules) {
    grouped.set(rule.categoryId, [
      ...(grouped.get(rule.categoryId) ?? []),
      rule,
    ]);
  }

  const result: ClassificationRuleCategoryGroup[] = [];
  for (const category of categories) {
    const categoryRules = grouped.get(category.id);
    if (!categoryRules?.length) continue;
    result.push({
      categoryId: category.id,
      label: category.label,
      rules: categoryRules,
    });
    grouped.delete(category.id);
  }

  // Keep the UI resilient if old data contains a rule for a deleted category.
  for (const [categoryId, categoryRules] of grouped) {
    result.push({ categoryId, label: categoryId, rules: categoryRules });
  }
  return result;
}

export interface RuleConflict {
  kind: "duplicate" | "different_category";
  winnerId: string;
  count: number;
}

/** The first enabled rule with the same target, operator and pattern wins. */
export function findRuleConflicts(rules: readonly ClassificationRuleRow[]) {
  const groups = new Map<string, ClassificationRuleRow[]>();
  for (const rule of editableRules(rules)) {
    if (!rule.enabled) continue;
    const key = [
      rule.targetType ?? "all",
      rule.field,
      rule.operator,
      rule.pattern.trim().toLocaleLowerCase("zh-TW"),
    ].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }

  const conflicts = new Map<string, RuleConflict>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const winner = group[0]!;
    const kind = group.some((rule) => rule.categoryId !== winner.categoryId)
      ? "different_category"
      : "duplicate";
    for (const rule of group) {
      conflicts.set(rule.id, {
        kind,
        winnerId: winner.id,
        count: group.length,
      });
    }
  }
  return conflicts;
}

/** Swap neighbors in one source while preserving the full API order. */
export function moveRuleWithinTarget(
  rules: readonly ClassificationRuleRow[],
  target: RuleTarget,
  id: string,
  direction: -1 | 1,
) {
  const all = editableRules(rules);
  const visible = rulesForTarget(rules, target);
  const index = visible.findIndex((rule) => rule.id === id);
  const neighbor = visible[index + direction];
  if (index < 0 || !neighbor) return null;
  const ids = all.map((rule) => rule.id);
  const first = ids.indexOf(id);
  const second = ids.indexOf(neighbor.id);
  [ids[first], ids[second]] = [ids[second]!, ids[first]!];
  return ids;
}
