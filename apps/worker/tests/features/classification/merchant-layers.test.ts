import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestD1 } from "../../../../../packages/db/testing/d1";
import { resolveClassifications } from "../../../src/features/classification/service";

describe("merchant classification layers", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;

  beforeAll(async () => {
    harness = await createTestD1();
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  beforeEach(async () => {
    const db = harness.binding;
    await db.batch([
      db.prepare("DELETE FROM classification_merchant_product_rules"),
      db.prepare("DELETE FROM classification_merchant_rules"),
      db.prepare("DELETE FROM classification_merchants"),
      db.prepare(
        "INSERT OR IGNORE INTO classification_categories (id, label, sort_order, is_system, created_at, updated_at, behavior) VALUES ('test:food', '測試商家餐飲', 900, 0, '2026-09-25', '2026-09-25', 'normal')",
      ),
      db.prepare(
        "INSERT OR IGNORE INTO classification_categories (id, label, sort_order, is_system, created_at, updated_at, behavior) VALUES ('test:retail', '測試商家一般消費', 901, 0, '2026-09-25', '2026-09-25', 'normal')",
      ),
    ]);
  });

  it("matches the merchant first, then applies only that merchant's product rule", async () => {
    const db = harness.binding;
    await db.batch([
      db.prepare(
        "INSERT INTO classification_merchants (id, name, normalized_name, default_category_id, created_at, updated_at) VALUES ('merchant:seven', '7-ELEVEN', '7-eleven', 'test:retail', '2026-09-25', '2026-09-25')",
      ),
      db.prepare(
        "INSERT INTO classification_merchants (id, name, normalized_name, default_category_id, created_at, updated_at) VALUES ('merchant:family', 'FamilyMart', 'familymart', 'test:food', '2026-09-25', '2026-09-25')",
      ),
      db.prepare(
        "INSERT INTO classification_merchant_rules (id, merchant_id, target_type, field, operator, pattern, priority, created_at, updated_at) VALUES ('merchant-rule:seven', 'merchant:seven', 'bank_transaction', 'merchant_name', 'contains', '7-eleven', 200, '2026-09-25', '2026-09-25')",
      ),
      db.prepare(
        "INSERT INTO classification_merchant_rules (id, merchant_id, target_type, field, operator, pattern, priority, created_at, updated_at) VALUES ('merchant-rule:family', 'merchant:family', 'bank_transaction', 'merchant_name', 'contains', 'familymart', 200, '2026-09-25', '2026-09-25')",
      ),
      db.prepare(
        "INSERT INTO classification_merchant_product_rules (id, merchant_id, category_id, target_type, field, operator, pattern, priority, created_at, updated_at) VALUES ('product-rule:seven-coffee', 'merchant:seven', 'test:food', 'bank_transaction', 'description', 'contains', 'coffee', 200, '2026-09-25', '2026-09-25')",
      ),
      db.prepare(
        "INSERT INTO classification_merchant_product_rules (id, merchant_id, category_id, target_type, field, operator, pattern, priority, created_at, updated_at) VALUES ('product-rule:family-coffee', 'merchant:family', 'test:retail', 'bank_transaction', 'description', 'contains', 'coffee', 200, '2026-09-25', '2026-09-25')",
      ),
    ]);

    const results = await resolveClassifications(db, [
      {
        id: "seven-coffee",
        sourceId: "source-1",
        merchantName: "7-ELEVEN 台北店",
        description: "Coffee",
      },
      {
        id: "seven-tea",
        sourceId: "source-2",
        counterparty: "7-ELEVEN 台北店",
        description: "Tea",
      },
      {
        id: "family-coffee",
        sourceId: "source-3",
        merchantName: "FamilyMart 台北店",
        description: "Coffee",
      },
    ]);

    expect(results.get("seven-coffee")).toMatchObject({
      categoryId: "test:food",
      source: "merchant_product_rule",
      merchantId: "merchant:seven",
      merchantRuleId: "merchant-rule:seven",
    });
    expect(results.get("seven-tea")).toMatchObject({
      categoryId: "test:retail",
      source: "merchant_default",
      merchantId: "merchant:seven",
    });
    expect(results.get("family-coffee")).toMatchObject({
      categoryId: "test:retail",
      source: "merchant_product_rule",
      merchantId: "merchant:family",
    });
  });

  it("uses an explicit merchant before text-based merchant rules", async () => {
    const db = harness.binding;
    await db.batch([
      db.prepare(
        "INSERT INTO classification_merchants (id, name, normalized_name, default_category_id, created_at, updated_at) VALUES ('merchant:explicit', '手動商家', '手動商家', 'test:food', '2026-09-25', '2026-09-25')",
      ),
      db.prepare(
        "INSERT INTO classification_merchants (id, name, normalized_name, default_category_id, created_at, updated_at) VALUES ('merchant:text', '文字商家', '文字商家', 'test:retail', '2026-09-25', '2026-09-25')",
      ),
      db.prepare(
        "INSERT INTO classification_merchant_rules (id, merchant_id, target_type, field, operator, pattern, priority, created_at, updated_at) VALUES ('merchant-rule:text', 'merchant:text', 'invoice_item', 'merchant_name', 'equals', '原始名稱', 500, '2026-09-25', '2026-09-25')",
      ),
    ]);

    const result = await resolveClassifications(
      db,
      [
        {
          id: "invoice-line-explicit",
          sourceId: "line-1",
          merchantId: "merchant:explicit",
          merchantName: "原始名稱",
          description: "商品",
        },
      ],
      "invoice_item",
    );

    expect(result.get("invoice-line-explicit")).toMatchObject({
      categoryId: "test:food",
      source: "merchant_default",
      merchantId: "merchant:explicit",
    });
  });
});
