import { sql } from "drizzle-orm";
import { bankAccounts, bankTransactions } from "./bank";
import { classificationMerchants } from "./classification";
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/sqlite-core";

// SQL migrations remain authoritative for schema shape and constraints.

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").notNull(),
    connectorId: text("connector_id").notNull(),
    sourceId: text("source_id").notNull(),
    invoiceNumber: text("invoice_number"),
    invoiceDate: text("invoice_date").notNull(),
    sellerName: text("seller_name"),
    amount: integer("amount").notNull(),
    rawPayload: text("raw_payload"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_invoices_page").on(
      sql`invoice_date DESC`,
      sql`updated_at DESC`,
      sql`id DESC`,
    ),
    index("idx_invoices_invoice_date").on(table.invoiceDate),
    unique().on(table.connectorId, table.sourceId),
  ],
);

export const invoiceLineItems = sqliteTable(
  "invoice_line_items",
  {
    id: text("id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    connectorId: text("connector_id").notNull(),
    invoiceSourceId: text("invoice_source_id").notNull(),
    sourceId: text("source_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    description: text("description").notNull(),
    quantity: real("quantity"),
    unitPrice: integer("unit_price"),
    amount: integer("amount").notNull(),
    rawPayload: text("raw_payload"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lineType: text("line_type").notNull().default("item"),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_invoice_line_items_invoice_source").on(
      table.connectorId,
      table.invoiceSourceId,
    ),
    index("idx_invoice_line_items_invoice_id").on(table.invoiceId),
    unique().on(table.connectorId, table.invoiceSourceId, table.sourceId),
    foreignKey({
      columns: [table.invoiceId],
      foreignColumns: [invoices.id],
    }).onDelete("cascade"),
    check(
      "invoice_line_items_check_line_type",
      sql`line_type IN ('item', 'allowance', 'refund', 'fee')`,
    ),
  ],
);

export const invoiceTransactionPreferences = sqliteTable(
  "invoice_transaction_preferences",
  {
    invoiceId: text("invoice_id").notNull(),
    transactionId: text("transaction_id"),
    decision: text("decision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.invoiceId] }),
    foreignKey({
      columns: [table.invoiceId],
      foreignColumns: [invoices.id],
    }),
    foreignKey({
      columns: [table.transactionId],
      foreignColumns: [bankTransactions.id],
    }),
    index("idx_invoice_transaction_preferences_transaction").on(
      table.transactionId,
    ),
    uniqueIndex("idx_invoice_transaction_preferences_linked_transaction")
      .on(table.transactionId)
      .where(sql`decision = 'linked'`),
    check(
      "invoice_transaction_preferences_check_1",
      sql`decision IN ('linked', 'separate', 'cash')`,
    ),
    check(
      "invoice_transaction_preferences_check_2",
      sql`
    (decision = 'linked' AND transaction_id IS NOT NULL)
    OR decision IN ('separate', 'cash')
  `,
    ),
  ],
);

export const invoiceMerchantOverrides = sqliteTable(
  "invoice_merchant_overrides",
  {
    invoiceId: text("invoice_id").notNull(),
    merchantId: text("merchant_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.invoiceId] }),
    index("idx_invoice_merchant_overrides_merchant").on(table.merchantId),
    foreignKey({
      columns: [table.invoiceId],
      foreignColumns: [invoices.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.merchantId],
      foreignColumns: [classificationMerchants.id],
    }).onDelete("cascade"),
  ],
);

export const invoicePaymentAccountRules = sqliteTable(
  "invoice_payment_account_rules",
  {
    matchKey: text("match_key").notNull(),
    accountId: text("account_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.matchKey] }),
    index("idx_invoice_payment_account_rules_account").on(table.accountId),
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [bankAccounts.id],
    }),
  ],
);

export const invoicePaymentAccounts = sqliteTable(
  "invoice_payment_accounts",
  {
    invoiceId: text("invoice_id").notNull(),
    accountId: text("account_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.invoiceId] }),
    index("idx_invoice_payment_accounts_account").on(table.accountId),
    foreignKey({
      columns: [table.invoiceId],
      foreignColumns: [invoices.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [bankAccounts.id],
    }),
  ],
);
