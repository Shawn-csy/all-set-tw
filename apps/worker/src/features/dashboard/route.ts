import type { Hono } from "hono";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { isCloudBackupMode, isDemoMode } from "../../platform/http";
import { getDashboardSummary } from "./service";

export const dashboardRoutes = honoFactory.createApp();
registerDashboardRoutes(dashboardRoutes);

function registerDashboardRoutes(api: Hono<AppBindings>) {
  api.get("/runtime", async (c) => {
    const demoMode = isDemoMode(c.env);
    const demoDataAsOfMonth = demoMode
      ? ((
          await c.env.DB.prepare(
            "SELECT substr(max(invoice_date), 1, 7) AS month FROM invoices",
          ).first<{ month: string | null }>()
        )?.month ?? undefined)
      : undefined;

    return c.json({
      demoMode,
      ...(demoDataAsOfMonth ? { demoDataAsOfMonth } : {}),
      deploymentMode: c.env.DEPLOYMENT_MODE ?? "cloud-primary",
      cloudBackup: isCloudBackupMode(c.env),
    });
  });
  api.get("/ready", async (c) => {
    try {
      await c.env.DB.prepare("SELECT 1").first();
      return c.json({ ready: true, d1: true });
    } catch {
      return c.json({ ready: false, d1: false }, 503);
    }
  });
  api.get("/summary", async (c) => c.json(await getDashboardSummary(c.env.DB)));
}
