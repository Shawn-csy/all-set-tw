import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError, parseKeysetPagination } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import { searchActivity } from "./search-service";
import {
  listInvoicePaymentAccountRules,
  listInvoicePaymentAccounts,
  listInvoiceTransactionPreferences,
} from "./repository";
import {
  keepInvoiceSeparate,
  linkInvoiceToTransaction,
  markInvoiceAsCashPayment,
  rememberInvoicePaymentAccount,
  MappingDateMismatchError,
  MappingInvoiceAlreadyLinkedError,
  MappingInvoiceNotFoundError,
  MappingTransactionNotExpenseError,
  MappingTransactionNotFoundError,
  MappingTransactionUnavailableError,
  MappingPaymentAccountNotFoundError,
  MappingPaymentAccountConflictError,
} from "./service";

const mappingSchema = z.union([
  z.object({ transactionId: z.string().trim().min(1) }),
  z.object({ paymentAccountId: z.string().trim().min(1) }),
  z.object({ paymentMethod: z.literal("cash") }),
]);

export const activityRoutes = honoFactory.createApp();
registerActivityRoutes(activityRoutes);
activityRoutes.onError((error) => mappingError(error));

function registerActivityRoutes(api: Hono<AppBindings>) {
  api.get(
    "/activity/search",
    zValidator(
      "query",
      z
        .object({
          q: z.string().trim().min(1).max(200),
          from: z.string().date().optional(),
          to: z.string().date().optional(),
          source: z.enum(["all", "bank", "card", "invoice"]).optional(),
          flow: z.enum(["all", "income", "expense"]).optional(),
          category: z.string().max(100).optional(),
        })
        .refine(
          (value) => !value.from || !value.to || value.from <= value.to,
          "Invalid date range.",
        ),
      validationHook("INVALID_REQUEST", "Invalid activity search."),
    ),
    async (c) => {
      const { cursor } = parseKeysetPagination(
        c.req.query(),
        z.object({
          id: z.string().min(1),
          source: z.enum(["bank", "card", "invoice", "investment"]),
          date: z.string().min(1).max(64),
          dateHasTime: z.boolean().optional(),
        }),
        30,
      );
      return c.json(
        await searchActivity(c.env.DB, c.req.valid("query"), cursor),
      );
    },
  );

  api.get("/activity/invoice-mappings", async (c) =>
    c.json(await listInvoiceTransactionPreferences(c.env.DB)),
  );

  api.get("/activity/invoice-payment-rules", async (c) =>
    c.json(await listInvoicePaymentAccountRules(c.env.DB)),
  );

  api.get("/activity/invoice-payment-accounts", async (c) =>
    c.json(await listInvoicePaymentAccounts(c.env.DB)),
  );

  api.put(
    "/activity/invoice-mappings/:invoiceId",
    zValidator(
      "json",
      mappingSchema,
      validationHook("INVALID_REQUEST", "Invoice mapping is invalid."),
    ),
    async (c) => {
      const body = c.req.valid("json");
      return c.json(
        "paymentMethod" in body
          ? await markInvoiceAsCashPayment(c.env.DB, c.req.param("invoiceId"))
          : "paymentAccountId" in body
            ? await rememberInvoicePaymentAccount(
                c.env.DB,
                c.req.param("invoiceId"),
                body.paymentAccountId,
              )
            : await linkInvoiceToTransaction(
                c.env.DB,
                c.req.param("invoiceId"),
                body.transactionId,
              ),
      );
    },
  );

  api.delete("/activity/invoice-mappings/:invoiceId", async (c) =>
    c.json(await keepInvoiceSeparate(c.env.DB, c.req.param("invoiceId"))),
  );
}

function mappingError(error: unknown) {
  if (error instanceof MappingInvoiceNotFoundError)
    return jsonError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
  if (error instanceof MappingInvoiceAlreadyLinkedError)
    return jsonError(
      "INVOICE_ALREADY_MAPPED",
      "解除現有銀行／信用卡配對後，才能標記為現金支付。",
      409,
    );
  if (error instanceof MappingTransactionNotFoundError)
    return jsonError(
      "BANK_TRANSACTION_NOT_FOUND",
      "Bank transaction was not found.",
      404,
    );
  if (error instanceof MappingTransactionUnavailableError)
    return jsonError(
      "BANK_TRANSACTION_ALREADY_MAPPED",
      "Bank transaction is already mapped to another invoice.",
      409,
    );
  if (error instanceof MappingDateMismatchError)
    return jsonError(
      "MAPPING_DATE_MISMATCH",
      "發票只能關聯同一天的銀行／信用卡交易。",
      400,
    );
  if (error instanceof MappingPaymentAccountNotFoundError)
    return jsonError(
      "PAYMENT_ACCOUNT_NOT_FOUND",
      "找不到可用的信用卡帳戶。",
      404,
    );
  if (error instanceof MappingPaymentAccountConflictError)
    return jsonError(
      "PAYMENT_ACCOUNT_CONFLICT",
      "這張發票已關聯另一個帳戶的交易；請先解除關聯，再改用這張卡。",
      409,
    );
  if (error instanceof MappingTransactionNotExpenseError)
    return jsonError(
      "MAPPING_TRANSACTION_NOT_EXPENSE",
      "Only TWD expense transactions can be mapped to an invoice.",
      400,
    );
  throw error;
}
