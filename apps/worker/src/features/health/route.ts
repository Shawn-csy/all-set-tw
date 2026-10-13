import { honoFactory } from "../../platform/hono";
import { checkHealth } from "./service";

export const healthRoutes = honoFactory.createApp();

healthRoutes.get("/health", async (c) => {
  const health = await checkHealth(c.env.DB);
  return c.json(health, health.ready ? 200 : 503);
});
