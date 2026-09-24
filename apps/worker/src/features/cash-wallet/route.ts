import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { validationHook } from "../../platform/validation";
import { getCashWallet, updateCashWallet } from "./service";

const openingBalanceSchema = z.object({
  openingBalance: z.number().int().finite(),
});

export const cashWalletRoutes = honoFactory.createApp();
registerCashWalletRoutes(cashWalletRoutes);

function registerCashWalletRoutes(api: Hono<AppBindings>) {
  api.get("/cash-wallet", async (c) => c.json(await getCashWallet(c.env.DB)));

  api.put(
    "/cash-wallet",
    zValidator(
      "json",
      openingBalanceSchema,
      validationHook("INVALID_REQUEST", "Cash wallet balance is invalid."),
    ),
    async (c) =>
      c.json(
        await updateCashWallet(c.env.DB, c.req.valid("json").openingBalance),
      ),
  );
}
