import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { validationHook } from "../../platform/validation";
import { getFinancialContext } from "./service";

const financialContextQuerySchema = z
  .object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  })
  .superRefine((value, context) => {
    if ((value.from === undefined) !== (value.to === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.from === undefined ? "from" : "to"],
        message: "from and to must be provided together.",
      });
      return;
    }
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "to must not be earlier than from.",
      });
    }
    if (value.from && value.to && daysBetween(value.from, value.to) > 366) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "The requested range cannot exceed 367 days.",
      });
    }
  });

export const aiFinancialContextRoutes = honoFactory.createApp();
registerAiFinancialContextRoutes(aiFinancialContextRoutes);

function registerAiFinancialContextRoutes(api: Hono<AppBindings>) {
  api.get(
    "/ai/financial-context",
    zValidator(
      "query",
      financialContextQuerySchema,
      validationHook("INVALID_REQUEST", "Invalid financial context range."),
    ),
    async (c) => {
      const period = resolvePeriod(c.req.valid("query"));
      const payload = await getFinancialContext(c.env.DB, period);
      c.header("Cache-Control", "private, no-store");
      c.header(
        "Content-Disposition",
        `attachment; filename="taiwan-fin-hub-ai-context-${period.to}.json"`,
      );
      return c.json(payload);
    },
  );
}

function resolvePeriod(query: { from?: string; to?: string }) {
  if (query.from && query.to) return { from: query.from, to: query.to };
  const today = taipeiToday();
  const [year, month] = today.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 12, 1));
  return { from: from.toISOString().slice(0, 10), to: today };
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}
