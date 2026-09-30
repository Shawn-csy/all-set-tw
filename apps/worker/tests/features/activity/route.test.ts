import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../src/platform/env";
import { activityRoutes } from "../../../src/features/activity/route";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";

type Preference = {
  invoiceId: string;
  transactionId: string | null;
  decision: "linked" | "separate" | "cash";
  createdAt: string;
  updatedAt: string;
};

type PaymentRule = {
  matchKey: string;
  accountId: string;
  updatedAt: string;
};

function createDb() {
  const invoices = new Map([
    [
      "invoice-1",
      {
        id: "invoice-1",
        invoiceDate: "2026-07-06T04:39:18.000Z",
        sellerName: "Spotify AB",
      },
    ],
    [
      "invoice-2",
      { id: "invoice-2", invoiceDate: "2026-07-06", sellerName: "Other" },
    ],
  ]);
  const transactions = new Map([
    [
      "transaction-1",
      {
        id: "transaction-1",
        postedDate: "2026-07-07",
        authorizedAt: "2026-07-06",
        amount: 37,
        currency: "TWD",
        accountType: "credit",
        accountId: "card",
      },
    ],
    [
      "transaction-other-day",
      {
        id: "transaction-other-day",
        postedDate: "2026-07-07",
        authorizedAt: null,
        amount: -50,
        currency: "TWD",
        accountType: "checking",
        accountId: "checking",
      },
    ],
    [
      "card-bill-settlement",
      {
        id: "card-bill-settlement",
        postedDate: "2026-07-06",
        authorizedAt: "2026-07-06",
        amount: -298,
        currency: "TWD",
        accountType: "checking",
        accountId: "checking",
        description: "繳富邦信用卡款",
        counterparty: null,
      },
    ],
    [
      "transaction-next-taipei-day",
      {
        id: "transaction-next-taipei-day",
        postedDate: "2026-07-06T16:00:00.000Z",
        authorizedAt: "2026-07-06T16:00:00.000Z",
        amount: 50,
        currency: "TWD",
        accountType: "credit",
        accountId: "card",
      },
    ],
    [
      "transaction-far-day",
      {
        id: "transaction-far-day",
        postedDate: "2026-07-20",
        authorizedAt: "2026-07-20",
        amount: 50,
        currency: "TWD",
        accountType: "credit",
        accountId: "card",
      },
    ],
  ]);
  const preferences = new Map<string, Preference>();
  const paymentRules = new Map<string, PaymentRule>();
  const paymentAccounts = new Map<
    string,
    { invoiceId: string; accountId: string; updatedAt: string }
  >();

  const db = {
    prepare(query: string) {
      const sql = query.replaceAll('"', "").toUpperCase();
      let values: unknown[] = [];
      return {
        bind(...nextValues: unknown[]) {
          values = nextValues;
          return this;
        },
        async raw() {
          if (
            sql.includes("FROM BANK_TRANSACTIONS") &&
            !sql.includes("FROM INVOICE_TRANSACTION_PREFERENCES")
          ) {
            const row = transactions.get(String(values[0]));
            return row
              ? [
                  [
                    row.id,
                    row.postedDate,
                    row.authorizedAt,
                    row.amount,
                    row.currency,
                    "description" in row ? row.description : null,
                    "counterparty" in row ? row.counterparty : null,
                    row.accountType,
                    row.accountId,
                  ],
                ]
              : [];
          }
          if (sql.includes("FROM INVOICE_LINE_ITEMS")) return [];
          if (sql.includes("FROM INVOICE_PAYMENT_ACCOUNTS"))
            return Array.from(paymentAccounts.values()).map((row) => [
              row.invoiceId,
              row.accountId,
              row.updatedAt,
            ]);
          if (sql.includes("FROM INVOICE_PAYMENT_ACCOUNT_RULES"))
            return Array.from(paymentRules.values()).map((row) => [
              row.matchKey,
              row.accountId,
              row.updatedAt,
            ]);
          if (
            sql.includes("FROM INVOICE_TRANSACTION_PREFERENCES") &&
            !sql.includes("INSERT") &&
            !sql.includes("TRANSACTION_ID = ?")
          ) {
            return Array.from(preferences.values()).map((preference) => [
              preference.invoiceId,
              preference.transactionId,
              preference.decision,
              preference.createdAt,
              preference.updatedAt,
            ]);
          }
          const row = await this.first();
          return row ? [Object.values(row)] : [];
        },
        async first() {
          if (sql.includes("FROM INVOICES"))
            return invoices.get(String(values[0])) ?? null;
          if (sql.includes("FROM BANK_ACCOUNTS"))
            return String(values[0]) === "card"
              ? { id: "card", accountType: "credit" }
              : null;
          if (sql.includes("FROM BANK_TX") || sql.includes("BANK_TX."))
            return transactions.get(String(values[0])) ?? null;
          if (
            sql.includes("FROM INVOICE_TRANSACTION_PREFERENCES") &&
            sql.includes("INVOICE_ID = ?")
          )
            return preferences.get(String(values[0])) ?? null;
          if (
            sql.includes("INVOICE_TRANSACTION_PREFERENCES") &&
            sql.includes("TRANSACTION_ID = ?")
          ) {
            const linked = Array.from(preferences.values()).find(
              (preference) =>
                preference.decision === "linked" &&
                preference.transactionId === values[0],
            );
            return linked ? { invoiceId: linked.invoiceId } : null;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM INVOICE_LINE_ITEMS")) return { results: [] };
          if (sql.includes("FROM INVOICE_PAYMENT_ACCOUNTS"))
            return { results: Array.from(paymentAccounts.values()) };
          if (sql.includes("FROM INVOICE_PAYMENT_ACCOUNT_RULES"))
            return { results: Array.from(paymentRules.values()) };
          return { results: Array.from(preferences.values()) };
        },
        async run() {
          if (sql.startsWith("DELETE FROM INVOICE_PAYMENT_ACCOUNTS")) {
            paymentAccounts.delete(String(values[0]));
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM INVOICE_TRANSACTION_PREFERENCES")) {
            const existing = preferences.get(String(values[0]));
            if (
              existing?.decision === "cash" ||
              existing?.decision === "separate"
            )
              preferences.delete(String(values[0]));
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO INVOICE_PAYMENT_ACCOUNTS")) {
            const [invoiceId, accountId, _createdAt, updatedAt] =
              values as string[];
            paymentAccounts.set(invoiceId, { invoiceId, accountId, updatedAt });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INVOICE_PAYMENT_ACCOUNT_RULES")) {
            const [matchKey, accountId, _createdAt, updatedAt] = values as [
              string,
              string,
              string,
              string,
            ];
            paymentRules.set(matchKey, { matchKey, accountId, updatedAt });
            return { meta: { changes: 1 } };
          }
          const [invoiceId, transactionId, decision, createdAt, updatedAt] =
            sql.includes("INSERT INTO INVOICE_TRANSACTION_PREFERENCES") &&
            values.length < 5
              ? sql.includes("VALUES (?, NULL, 'CASH'")
                ? [values[0], null, "cash", values[1], values[2]]
                : [values[0], values[1], "linked", values[2], values[3]]
              : values;
          const previous = preferences.get(String(invoiceId));
          preferences.set(String(invoiceId), {
            invoiceId: String(invoiceId),
            transactionId: transactionId as string | null,
            decision: decision as Preference["decision"],
            createdAt: previous?.createdAt ?? String(createdAt),
            updatedAt: String(updatedAt),
          });
          return { meta: { changes: 1 } };
        },
      };
    },
  } as unknown as D1Database;
  Object.assign(db, {
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      for (const statement of statements) await statement.run();
      return [];
    },
  });
  return { db, preferences, paymentRules, paymentAccounts };
}

describe("activity invoice transaction mappings", () => {
  it("rejects a card bill settlement even when manually selected", async () => {
    const { db, preferences } = createDb();
    const response = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: "card-bill-settlement" }),
      },
      { DB: db } as Env,
    );
    expect(response.status).toBe(400);
    expect(preferences.size).toBe(0);
  });

  it("links an invoice to a same-day expense and lists the preference", async () => {
    const { db } = createDb();
    const response = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: "transaction-1" }),
      },
      { DB: db } as Env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      invoiceId: "invoice-1",
      transactionId: "transaction-1",
      decision: "linked",
    });

    const list = await activityRoutes.request(
      "/activity/invoice-mappings",
      {},
      { DB: db } as Env,
    );
    await expect(list.json()).resolves.toEqual([
      expect.objectContaining({
        invoiceId: "invoice-1",
        transactionId: "transaction-1",
        decision: "linked",
      }),
    ]);
  });

  it("keeps a previously linked invoice separate", async () => {
    const { db, preferences } = createDb();
    preferences.set("invoice-1", {
      invoiceId: "invoice-1",
      transactionId: "transaction-1",
      decision: "linked",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
    });

    const response = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      { method: "DELETE" },
      { DB: db } as Env,
    );
    expect(response.status).toBe(200);
    expect(preferences.get("invoice-1")).toMatchObject({
      transactionId: null,
      decision: "separate",
    });
  });

  it("marks an invoice as cash paid without linking a transaction", async () => {
    const { db, preferences } = createDb();
    const response = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: "cash" }),
      },
      { DB: db } as Env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      invoiceId: "invoice-1",
      transactionId: null,
      decision: "cash",
    });
    expect(preferences.get("invoice-1")).toMatchObject({
      transactionId: null,
      decision: "cash",
    });
  });

  it("rejects invalid, far-away, and already-used mappings", async () => {
    const { db, preferences } = createDb();
    const invalid = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: "" }),
      },
      { DB: db } as Env,
    );
    expect(invalid.status).toBe(400);

    const crossDay = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: "transaction-other-day" }),
      },
      { DB: db } as Env,
    );
    expect(crossDay.status).toBe(400);

    const crossTaipeiDay = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: "transaction-next-taipei-day",
        }),
      },
      { DB: db } as Env,
    );
    expect(crossTaipeiDay.status).toBe(400);

    const farDay = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: "transaction-far-day" }),
      },
      { DB: db } as Env,
    );
    expect(farDay.status).toBe(400);

    preferences.set("invoice-2", {
      invoiceId: "invoice-2",
      transactionId: "transaction-1",
      decision: "linked",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
    });
    const unavailable = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: "transaction-1" }),
      },
      { DB: db } as Env,
    );
    expect(unavailable.status).toBe(409);
  });

  it("remembers the invoice's credit card without linking a transaction", async () => {
    const { db, paymentRules, paymentAccounts } = createDb();
    const response = await activityRoutes.request(
      "/activity/invoice-mappings/invoice-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentAccountId: "card" }),
      },
      { DB: db } as Env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      matchKey: "spotifyab",
      accountId: "card",
      invoiceId: "invoice-1",
    });
    expect(paymentAccounts.get("invoice-1")).toMatchObject({
      accountId: "card",
    });
    expect(paymentRules.get("spotifyab")).toMatchObject({
      accountId: "card",
    });
  });

  it("passes unexpected errors to the parent API error handler", async () => {
    const api = honoFactory.createApp();
    api.route("/", activityRoutes);
    api.onError(apiErrorResponse);
    const unexpected = new Error("D1 query failed");
    const db = {
      prepare() {
        throw unexpected;
      },
    } as unknown as D1Database;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await api.request("/activity/invoice-mappings", {}, {
      DB: db,
    } as Env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    expect(errorLog).toHaveBeenCalledWith("[api] unhandled error:", unexpected);
    errorLog.mockRestore();
  });
});
