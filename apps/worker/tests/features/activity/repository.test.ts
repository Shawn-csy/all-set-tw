import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1 } from "../../../../../packages/db/testing/d1";
import {
  findMappingTransaction,
  listInvoicePaymentAccounts,
  listInvoicePaymentAccountRules,
  listInvoiceTransactionPreferences,
} from "../../../src/features/activity/repository";
import {
  linkInvoiceToTransaction,
  MappingPaymentAccountConflictError,
  markInvoiceAsCashPayment,
  rememberInvoicePaymentAccount,
} from "../../../src/features/activity/service";
import {
  getInvoiceDetail,
  getInvoicesRange,
} from "../../../src/features/invoices/service";

describe("activity repository on D1", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  beforeAll(async () => {
    harness = await createTestD1();
    const db = harness.binding;
    await db
      .prepare(
        "INSERT INTO bank_accounts (id, connector_id, source_id, account_type, created_at, updated_at) VALUES ('card', 'test', 'card', 'credit', 't', 't')",
      )
      .run();
    for (const [id, status, matched] of [
      ["posted", "posted", null],
      ["pending", "pending", null],
      ["matched-pending", "pending", "posted"],
      ["matched-posted", "posted", "matched-posted"],
    ] as const) {
      await db
        .prepare(
          "INSERT INTO bank_transactions (id, connector_id, source_id, account_id, posted_date, amount, currency, status, matched_transaction_id, created_at, updated_at) VALUES (?, 'test', ?, 'card', '2026-07-13', -35, 'TWD', ?, ?, 't', 't')",
        )
        .bind(id, id, status, matched)
        .run();
    }
    for (const id of [
      "posted",
      "pending",
      "matched-pending",
      "matched-posted",
      "separate",
    ]) {
      await db.batch([
        db
          .prepare(
            "INSERT INTO invoices (id, connector_id, source_id, invoice_date, amount, created_at, updated_at) VALUES (?, 'einvoice', ?, '2026-07-13', 35, 'created', 'updated')",
          )
          .bind(id, id),
        db
          .prepare(
            "INSERT INTO invoice_transaction_preferences VALUES (?, ?, ?, 'created', 'updated')",
          )
          .bind(
            id,
            id === "separate" ? null : id,
            id === "separate" ? "separate" : "linked",
          ),
      ]);
    }
  }, 60_000);
  afterAll(async () => {
    await harness?.mf.dispose();
  });

  it("loads mapping aliases and excludes only matched pending transactions", async () => {
    for (const id of ["posted", "pending", "matched-posted"]) {
      expect(await findMappingTransaction(harness.binding, id)).toEqual({
        id,
        postedDate: "2026-07-13",
        authorizedAt: null,
        amount: -35,
        currency: "TWD",
        description: null,
        counterparty: null,
        accountType: "credit",
        accountId: "card",
      });
    }
    expect(
      await findMappingTransaction(harness.binding, "matched-pending"),
    ).toBeNull();
    expect(await findMappingTransaction(harness.binding, "missing")).toBeNull();
  });

  it("keeps separate NULL preferences and filters only the correlated matched pending row", async () => {
    expect(await listInvoiceTransactionPreferences(harness.binding)).toEqual(
      ["matched-posted", "pending", "posted", "separate"].map((id) => ({
        invoiceId: id,
        transactionId: id === "separate" ? null : id,
        decision: id === "separate" ? "separate" : "linked",
        createdAt: "created",
        updatedAt: "updated",
        invoiceSellerName: null,
        transactionAccountId: id === "separate" ? null : "card",
      })),
    );
  });

  it("persists the invoice's card, clears cash atomically, and learns from a linked card", async () => {
    const db = harness.binding;
    await db
      .prepare(
        "INSERT INTO invoices (id, connector_id, source_id, invoice_date, seller_name, amount, created_at, updated_at) VALUES ('card-choice', 'einvoice', 'card-choice', '2026-07-13', 'Spotify AB', 35, 't', 't')",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO invoice_line_items (id, invoice_id, connector_id, invoice_source_id, source_id, line_number, description, amount, created_at, updated_at) VALUES ('card-choice-item', 'card-choice', 'einvoice', 'card-choice', 'card-choice-item', 1, 'Premium Individual', 35, 't', 't')",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO classification_rules (id, category_id, target_type, field, operator, pattern, priority, enabled, is_system, source, created_at, updated_at) VALUES ('item-rule', 'food', 'invoice_item', 'description', 'regex', 'Premium', 200, 1, 0, 'user', 't', 't')",
      )
      .run();
    expect(
      (await getInvoiceDetail(db, "card-choice")).items[0]?.classification,
    ).toMatchObject({ categoryId: "food", source: "user_rule" });
    expect(
      (
        await getInvoicesRange(db, { from: "2026-07-01", to: "2026-08-01" })
      ).find((row) => row.id === "card-choice")?.paymentMatchKey,
    ).toBe("item:spotifyab:premiumindividual");
    await db
      .prepare(
        "INSERT INTO classification_overrides (id, target_type, target_id, category_id, created_at, updated_at) VALUES ('override:invoice_item:card-choice-item', 'invoice_item', 'card-choice-item', 'shopping', 't', 't')",
      )
      .run();
    expect(
      (await getInvoiceDetail(db, "card-choice")).items[0]?.classification,
    ).toMatchObject({
      categoryId: "shopping",
      label: "購物",
      source: "override",
    });
    expect(
      (
        await getInvoicesRange(db, { from: "2026-07-01", to: "2026-08-01" })
      ).find((row) => row.id === "card-choice")?.items[0]?.classification,
    ).toMatchObject({ categoryId: "shopping", label: "購物" });
    await db
      .prepare(
        "INSERT INTO bank_transactions (id, connector_id, source_id, account_id, posted_date, amount, currency, status, created_at, updated_at) VALUES ('card-choice-txn', 'test', 'card-choice-txn', 'card', '2026-07-13', -35, 'TWD', 'posted', 't', 't')",
      )
      .run();

    await markInvoiceAsCashPayment(db, "card-choice");
    await rememberInvoicePaymentAccount(db, "card-choice", "card");
    expect(
      (await listInvoicePaymentAccountRules(db)).find(
        (row) => row.matchKey === "item:spotifyab:premiumindividual",
      ),
    ).toMatchObject({ accountId: "card" });
    expect(await listInvoicePaymentAccounts(db)).toContainEqual(
      expect.objectContaining({ invoiceId: "card-choice", accountId: "card" }),
    );
    expect(
      (await listInvoiceTransactionPreferences(db)).find(
        (row) => row.invoiceId === "card-choice",
      ),
    ).toBeUndefined();

    await markInvoiceAsCashPayment(db, "card-choice");
    expect(
      (await listInvoicePaymentAccounts(db)).some(
        (row) => row.invoiceId === "card-choice",
      ),
    ).toBe(false);
    await rememberInvoicePaymentAccount(db, "card-choice", "card");

    await linkInvoiceToTransaction(db, "card-choice", "card-choice-txn");
    expect(
      (await listInvoiceTransactionPreferences(db)).find(
        (row) => row.invoiceId === "card-choice",
      ),
    ).toMatchObject({ transactionId: "card-choice-txn", decision: "linked" });
    expect(
      (await listInvoicePaymentAccounts(db)).find(
        (row) => row.invoiceId === "card-choice",
      ),
    ).toMatchObject({ accountId: "card" });

    await db
      .prepare(
        "INSERT INTO bank_accounts (id, connector_id, source_id, account_type, created_at, updated_at) VALUES ('other-card', 'test', 'other-card', 'credit', 't', 't')",
      )
      .run();
    await expect(
      rememberInvoicePaymentAccount(db, "card-choice", "other-card"),
    ).rejects.toBeInstanceOf(MappingPaymentAccountConflictError);

    await expect(markInvoiceAsCashPayment(db, "card-choice")).rejects.toThrow();
  });
});
