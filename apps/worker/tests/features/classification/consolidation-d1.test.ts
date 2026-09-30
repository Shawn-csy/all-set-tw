import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1 } from "../../../../../packages/db/testing/d1";
import {
  consolidateClassificationRules,
  createClassificationRule,
  editClassificationRule,
} from "../../../src/features/classification/service";
import { listClassificationRules } from "../../../src/features/classification/repository";

describe("classification consolidation on D1", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  beforeAll(async () => {
    harness = await createTestD1();
  }, 60_000);
  afterAll(async () => {
    await harness?.mf.dispose();
  });

  it("stores one regex per destination, retires duplicates, and is idempotent", async () => {
    const db = harness.binding;
    for (const [id, category, pattern, priority] of [
      ["test:food-1", "food", "牛奶", 400],
      ["test:other", "entertainment", "Spotify", 300],
      ["test:other-conflict", "software", "Spotify", 300],
      ["test:food-2", "food", "豆漿", 200],
    ] as const) {
      await db
        .prepare(
          "INSERT INTO classification_rules (id, category_id, target_type, field, operator, pattern, priority, enabled, is_system, source, created_at, updated_at) VALUES (?, ?, 'invoice_item', 'description', 'contains', ?, ?, 1, 0, 'user', '2020-01-01', '2020-01-01')",
        )
        .bind(id, category, pattern, priority)
        .run();
    }
    expect(await consolidateClassificationRules(db)).toMatchObject({
      mergedGroups: 1,
      removedRules: 1,
    });
    const rows = (await listClassificationRules(db)).filter((row) =>
      row.id.startsWith("test:"),
    );
    expect(rows.map(({ id }) => id)).toEqual([
      "test:food-1",
      "test:other",
      "test:other-conflict",
    ]);
    expect(rows[0]).toMatchObject({
      operator: "regex",
      pattern: "(?:牛奶|豆漿)",
      priority: 400,
    });
    expect(rows[1]?.categoryId).not.toBe(rows[2]?.categoryId);
    expect(await consolidateClassificationRules(db)).toMatchObject({
      mergedGroups: 0,
      removedRules: 0,
    });

    await createClassificationRule(db, {
      categoryId: "food",
      targetType: "invoice_item",
      field: "description",
      operator: "regex",
      pattern: "(?:新商品)",
      priority: 300,
      description: "由活動頁建立",
    });
    const afterCreate = await listClassificationRules(db);
    const foodRules = afterCreate.filter(
      (row) =>
        row.categoryId === "food" &&
        row.targetType === "invoice_item" &&
        row.isSystem === 0 &&
        row.pattern.includes("新商品"),
    );
    expect(foodRules).toHaveLength(1);
    expect(foodRules[0]).toMatchObject({
      operator: "regex",
      pattern: "(?:牛奶|豆漿|新商品)",
      description: "由活動頁建立",
    });
  });

  it("merges into the destination category after editing a rule", async () => {
    const db = harness.binding;
    for (const [id, category, pattern, priority] of [
      ["test:edit-food", "food", "milk", 400],
      ["test:edit-software", "software", "headphones", 300],
    ] as const) {
      await db
        .prepare(
          "INSERT INTO classification_rules (id, category_id, target_type, field, operator, pattern, priority, enabled, is_system, source, created_at, updated_at) VALUES (?, ?, 'bank_transaction', 'any_text', 'contains', ?, ?, 1, 0, 'user', '2021-01-01', '2021-01-01')",
        )
        .bind(id, category, pattern, priority)
        .run();
    }

    await editClassificationRule(db, "test:edit-software", {
      categoryId: "food",
    });
    const rows = (await listClassificationRules(db)).filter((row) =>
      row.id.startsWith("test:edit-"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "test:edit-food",
      categoryId: "food",
      operator: "regex",
      pattern: "(?:milk|headphones)",
    });
  });
});
