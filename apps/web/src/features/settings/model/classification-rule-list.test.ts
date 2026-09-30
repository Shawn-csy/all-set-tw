import { describe, expect, it } from "vitest";
import type { ClassificationRuleRow } from "@/data/classification/types";
import {
  findRuleConflicts,
  groupRulesByCategory,
  moveRuleWithinTarget,
  rulesForTarget,
} from "./classification-rule-list";

function rule(
  id: string,
  targetType: string,
  pattern: string,
  categoryId = "food",
): ClassificationRuleRow {
  return {
    id,
    targetType,
    pattern,
    categoryId,
    field: "description",
    operator: "contains",
    priority: 200,
    enabled: true,
    isSystem: false,
    behavior: "normal",
    excludedFromCalculation: false,
  };
}

describe("classification rule list", () => {
  it("separates bank and invoice rules and searches the selected source", () => {
    const rows = [
      rule("bank", "bank_transaction", "卡費"),
      rule("invoice", "invoice_item", "Spotify Premium", "software"),
    ];
    expect(rulesForTarget(rows, "invoice_item").map(({ id }) => id)).toEqual([
      "invoice",
    ]);
    expect(rulesForTarget(rows, "bank_transaction", "spotify")).toEqual([]);
  });

  it("flags the same active condition assigned to different categories", () => {
    const rows = [
      rule("first", "invoice_item", "Spotify Premium", "software"),
      rule("second", "invoice_item", "spotify premium", "entertainment"),
      rule("bank", "bank_transaction", "Spotify Premium", "entertainment"),
    ];
    const conflicts = findRuleConflicts(rows);
    expect(conflicts.get("second")).toEqual({
      kind: "different_category",
      winnerId: "first",
      count: 2,
    });
    expect(conflicts.has("bank")).toBe(false);
  });

  it("reorders only within one source without dropping other rule ids", () => {
    const rows = [
      rule("invoice-a", "invoice_item", "A"),
      rule("bank", "bank_transaction", "B"),
      rule("invoice-c", "invoice_item", "C"),
    ];
    expect(moveRuleWithinTarget(rows, "invoice_item", "invoice-c", -1)).toEqual(
      ["invoice-c", "bank", "invoice-a"],
    );
    expect(
      moveRuleWithinTarget(rows, "invoice_item", "invoice-a", -1),
    ).toBeNull();
  });

  it("groups invoice rules by the configured category order", () => {
    const rows = [
      rule("travel-2", "invoice_item", "Hotel", "travel"),
      rule("food", "invoice_item", "Lunch"),
      rule("travel-1", "invoice_item", "Flight", "travel"),
    ];
    expect(
      groupRulesByCategory(rows, [
        { id: "food", label: "餐飲" },
        { id: "travel", label: "旅遊" },
      ]).map((group) => [group.label, group.rules.map(({ id }) => id)]),
    ).toEqual([
      ["餐飲", ["food"]],
      ["旅遊", ["travel-2", "travel-1"]],
    ]);
  });
});
