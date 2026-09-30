import { describe, expect, it } from "vitest";
import {
  planClassificationRuleConsolidation,
  type ConsolidationCandidate,
} from "../../../src/features/classification/consolidation";
import { matchesClassificationRule } from "../../../src/features/classification/service";

function candidate(
  id: string,
  pattern: string,
  categoryId = "food",
): ConsolidationCandidate {
  return {
    id,
    categoryId,
    targetType: "invoice_item",
    field: "description",
    operator: "contains",
    pattern,
    enabled: 1,
    isSystem: 0,
    source: "user",
  };
}

describe("classification rule consolidation", () => {
  it("combines same-category literals across intervening categories", () => {
    const rows = [
      candidate("first", "牛奶 (A)"),
      candidate("intervening", "Spotify", "software"),
      {
        ...candidate("second", "豆漿+茶"),
        operator: "regex",
        pattern: "(?:豆漿\\+茶|牛奶 \\(A\\))",
      },
      candidate("third", "咖啡"),
    ];
    const groups = planClassificationRuleConsolidation(rows);
    expect(groups).toEqual([
      {
        keepId: "first",
        removeIds: ["second", "third"],
        pattern: "(?:牛奶 \\(A\\)|豆漿\\+茶|咖啡)",
        description: null,
      },
    ]);
    for (const term of ["牛奶 (A)", "豆漿+茶"]) {
      expect(
        matchesClassificationRule(
          {
            field: "description",
            operator: "regex",
            pattern: groups[0]!.pattern,
          },
          { id: "i", sourceId: "invoice", description: `購買${term}` },
        ),
      ).toBe(true);
    }
  });

  it("keeps conflicting destinations separate and preserves notes", () => {
    const rows = [
      candidate("a", "Spotify", "software"),
      candidate("b", "Spotify", "entertainment"),
      candidate("c", "牛奶"),
      candidate("d", "豆漿"),
      candidate("system", "茶"),
      candidate("e", "咖啡"),
    ];
    rows[2]!.priority = 300;
    rows[3]!.priority = 200;
    rows[2]!.description = "來自發票品項";
    rows[3]!.description = "由活動頁建立";
    rows[4]!.isSystem = 1;
    expect(planClassificationRuleConsolidation(rows)).toEqual([
      {
        keepId: "c",
        removeIds: ["d", "e"],
        pattern: "(?:牛奶|豆漿|咖啡)",
        description: "來自發票品項；由活動頁建立",
      },
    ]);
  });

  it("keeps disabled rules separate and starts another bucket at the length limit", () => {
    const rows = [
      candidate("a", "A".repeat(150)),
      candidate("b", "B".repeat(150)),
      candidate("c", "C"),
      candidate("d", "D"),
    ];
    rows[3]!.enabled = 0;
    expect(planClassificationRuleConsolidation(rows, 300)).toEqual([
      {
        keepId: "b",
        removeIds: ["c"],
        pattern: `(?:${"B".repeat(150)}|C)`,
        description: null,
      },
    ]);
  });
});
