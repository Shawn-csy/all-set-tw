import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import {
  encodePageCursor,
  parseKeysetPagination,
  setKeysetPaginationHeaders,
} from "../../platform/http";
import {
  monthRangeQuerySchema,
  resolveMonthDateRange,
} from "../../platform/month-range";
import { validationHook } from "../../platform/validation";
import {
  addManualInvestmentHolding,
  editManualInvestmentHolding,
  refreshManualAssetQuotes,
  removeManualAsset,
} from "../manual-assets/service";
import {
  getInvestmentPage,
  getInvestmentTransactionPage,
  getInvestmentTransactionsRange,
  clearInvestmentTransactionAmount,
  setInvestmentTransactionAmount,
  setInvestmentPositionCost,
} from "./service";

const investmentPageCursorSchema = z.object({
  asOfDate: z.string(),
  assetType: z.string(),
  name: z.string(),
  id: z.string(),
});

const transactionPageCursorSchema = z.object({
  effectiveDate: z.string(),
  updatedAt: z.string(),
  id: z.string(),
});

const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .regex(/^[A-Za-z0-9._-]+$/)
  .transform((value) => value.toUpperCase());
const holdingCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  symbol: symbolSchema,
  quantity: z.number().finite().positive(),
  costPerShare: z.number().finite().positive(),
  note: z.string().max(1_000).optional(),
});
const holdingUpdateSchema = holdingCreateSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0);
const transactionAmountSchema = z.object({
  amount: z.number().finite().int().positive().max(1_000_000_000_000),
  source: z.enum(["manual", "historical-close"]).optional(),
  referencePrice: z.number().finite().positive().optional(),
  priceDate: z.string().date().optional(),
  provider: z.string().trim().min(1).max(80).optional(),
});

export const investmentRoutes = honoFactory.createApp();
registerInvestmentRoutes(investmentRoutes);

function registerInvestmentRoutes(api: Hono<AppBindings>) {
  api.post(
    "/investments/manual",
    zValidator(
      "json",
      holdingCreateSchema,
      validationHook(
        "INVALID_REQUEST",
        "Manual investment holding is invalid.",
      ),
    ),
    async (c) => {
      const input = c.req.valid("json");
      const id = await addManualInvestmentHolding(c.env.DB, input);
      const quote = await refreshManualAssetQuotes(
        c.env.DB,
        c.env.TWELVE_DATA_API_KEY,
        fetch,
        { force: true, ids: [id] },
      );
      return c.json({ id, quote });
    },
  );

  api.put(
    "/investments/manual/:id",
    zValidator(
      "json",
      holdingUpdateSchema,
      validationHook(
        "INVALID_REQUEST",
        "Manual investment holding is invalid.",
      ),
    ),
    async (c) => {
      const input = c.req.valid("json");
      await editManualInvestmentHolding(c.env.DB, c.req.param("id"), input);
      const quote = await refreshManualAssetQuotes(
        c.env.DB,
        c.env.TWELVE_DATA_API_KEY,
        fetch,
        { force: true, ids: [c.req.param("id")] },
      );
      return c.json({ success: true, quote });
    },
  );

  api.delete("/investments/manual/:id", async (c) => {
    await removeManualAsset(c.env.DB, c.req.param("id"));
    return c.json({ success: true });
  });

  api.post("/investments/quotes/refresh", async (c) => {
    const result = await refreshManualAssetQuotes(
      c.env.DB,
      c.env.TWELVE_DATA_API_KEY,
      fetch,
      { force: true },
    );
    if (result.status === "not_configured") {
      return c.json(
        {
          error: {
            code: "TWELVE_DATA_NOT_CONFIGURED",
            message: "尚未設定 Twelve Data API key。",
          },
        },
        503,
      );
    }
    return c.json(result);
  });

  api.get("/investments", async (c) => {
    const { limit, cursor } = parseKeysetPagination(
      c.req.query(),
      investmentPageCursorSchema,
      100,
    );
    const page = await getInvestmentPage(c.env.DB, limit, cursor);
    setKeysetPaginationHeaders((name, value) => c.header(name, value), {
      hasMore: page.hasMore,
      nextCursor:
        page.hasMore && page.last
          ? encodePageCursor({
              asOfDate: page.last.asOfDate,
              assetType: page.last.assetType,
              name: page.last.name,
              id: page.last.id,
            })
          : undefined,
    });
    return c.json(page.positions);
  });

  api.put(
    "/investments/:id/cost",
    zValidator(
      "json",
      z.object({ costPerShare: z.number().finite().positive() }),
      validationHook("INVALID_REQUEST", "Investment cost is invalid."),
    ),
    async (c) => {
      const found = await setInvestmentPositionCost(
        c.env.DB,
        c.req.param("id"),
        c.req.valid("json").costPerShare,
      );
      if (!found)
        return c.json(
          { error: { code: "NOT_FOUND", message: "找不到此同步持倉。" } },
          404,
        );
      return c.json({ success: true });
    },
  );

  api.put(
    "/investment-transactions/:id/amount",
    zValidator(
      "json",
      transactionAmountSchema,
      validationHook("INVALID_REQUEST", "Transaction amount is invalid."),
    ),
    async (c) => {
      const input = c.req.valid("json");
      const { amount, ...options } = input;
      const found = await setInvestmentTransactionAmount(
        c.env.DB,
        c.req.param("id"),
        amount,
        options,
      );
      if (!found)
        return c.json(
          { error: { code: "NOT_FOUND", message: "找不到此投資交易。" } },
          404,
        );
      return c.json({ success: true });
    },
  );

  api.delete("/investment-transactions/:id/amount", async (c) => {
    await clearInvestmentTransactionAmount(c.env.DB, c.req.param("id"));
    return c.json({ success: true });
  });

  api.get(
    "/investment-transactions",
    zValidator(
      "query",
      monthRangeQuerySchema,
      validationHook("INVALID_REQUEST", "Invalid month range."),
    ),
    async (c) => {
      const range = resolveMonthDateRange(c.req.valid("query"));
      if (range)
        return c.json(await getInvestmentTransactionsRange(c.env.DB, range));

      const { limit, cursor } = parseKeysetPagination(
        c.req.query(),
        transactionPageCursorSchema,
        100,
      );
      const page = await getInvestmentTransactionPage(c.env.DB, limit, cursor);
      setKeysetPaginationHeaders((name, value) => c.header(name, value), {
        hasMore: page.hasMore,
        nextCursor:
          page.hasMore && page.last
            ? encodePageCursor({
                effectiveDate: page.last.effectiveDate,
                updatedAt: page.last.updatedAt,
                id: page.last.id,
              })
            : undefined,
      });
      return c.json(page.transactions);
    },
  );
}
