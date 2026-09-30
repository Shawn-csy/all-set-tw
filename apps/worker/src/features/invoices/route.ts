import type { Context, Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import {
  encodePageCursor,
  jsonError,
  parseKeysetPagination,
  setKeysetPaginationHeaders,
} from "../../platform/http";
import {
  monthRangeQuerySchema,
  resolveMonthDateRange,
} from "../../platform/month-range";
import { validationHook } from "../../platform/validation";
import {
  clearInvoiceMerchant,
  getInvoiceDetail,
  getInvoicePage,
  getInvoicesRange,
  getInvoiceSummaryRange,
  InvoiceMerchantNotFoundError,
  InvoiceNotFoundError,
  setInvoiceMerchant,
} from "./service";

const invoicePageCursorSchema = z.object({
  invoiceDate: z.string(),
  updatedAt: z.string(),
  id: z.string(),
});
const invoiceMerchantSchema = z.object({
  merchantId: z.string().trim().min(1).max(128),
});

export const invoiceRoutes = honoFactory.createApp();
registerInvoiceRoutes(invoiceRoutes);

function registerInvoiceRoutes(api: Hono<AppBindings>) {
  api.get(
    "/invoices",
    zValidator(
      "query",
      monthRangeQuerySchema,
      validationHook("INVALID_REQUEST", "Invalid month range."),
    ),
    async (c) => {
      const query = c.req.valid("query");
      const range = resolveMonthDateRange(query);
      const includeItems = ["1", "true"].includes(
        c.req.query("includeItems") ?? "",
      );
      if (range) {
        return c.json(
          includeItems
            ? await getInvoicesRange(c.env.DB, range)
            : await getInvoiceSummaryRange(c.env.DB, range),
        );
      }

      const { limit, cursor } = parseKeysetPagination(
        c.req.query(),
        invoicePageCursorSchema,
        50,
      );
      const page = await getInvoicePage(c.env.DB, limit, cursor);
      setKeysetPaginationHeaders((name, value) => c.header(name, value), {
        hasMore: page.hasMore,
        nextCursor:
          page.hasMore && page.last
            ? encodePageCursor({
                invoiceDate: page.last.invoiceDate,
                updatedAt: page.last.updatedAt,
                id: page.last.id,
              })
            : undefined,
      });
      return c.json(page.invoices);
    },
  );

  api.get("/invoice-detail", async (c) => {
    const invoiceId = c.req.query("invoiceId");
    if (!invoiceId)
      return jsonError(
        "INVALID_REQUEST",
        "invoiceId query parameter is required.",
      );
    return invoiceDetailResponse(c, invoiceId);
  });

  api.get("/invoices/:invoiceId", async (c) =>
    invoiceDetailResponse(c, c.req.param("invoiceId")),
  );

  api.put(
    "/invoices/:invoiceId/merchant",
    zValidator(
      "json",
      invoiceMerchantSchema,
      validationHook("INVALID_REQUEST", "Invoice merchant is invalid."),
    ),
    async (c) => {
      try {
        return c.json(
          await setInvoiceMerchant(
            c.env.DB,
            c.req.param("invoiceId"),
            c.req.valid("json").merchantId,
          ),
        );
      } catch (error) {
        if (error instanceof InvoiceNotFoundError)
          return jsonError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
        if (error instanceof InvoiceMerchantNotFoundError)
          return jsonError(
            "MERCHANT_NOT_FOUND",
            "Merchant was not found.",
            404,
          );
        throw error;
      }
    },
  );

  api.delete("/invoices/:invoiceId/merchant", async (c) => {
    try {
      return c.json(
        await clearInvoiceMerchant(c.env.DB, c.req.param("invoiceId")),
      );
    } catch (error) {
      if (error instanceof InvoiceNotFoundError)
        return jsonError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
      throw error;
    }
  });
}

async function invoiceDetailResponse(
  c: Context<AppBindings>,
  invoiceId: string,
) {
  try {
    return c.json(await getInvoiceDetail(c.env.DB, invoiceId));
  } catch (error) {
    if (error instanceof InvoiceNotFoundError) {
      return jsonError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
    }
    throw error;
  }
}
