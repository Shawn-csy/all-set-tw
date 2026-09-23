import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppBindings, Env } from "../../src/platform/env";
import {
  MAX_REQUEST_BODY_BYTES,
  requestSecurityMiddleware,
} from "../../src/middleware/request-security";

function testApp() {
  const app = new Hono<AppBindings>();
  app.use("*", requestSecurityMiddleware);
  app.post("/api/sync", (c) => c.json({ ok: true }));
  return app;
}

function testEnv(limiter: RateLimit) {
  return {
    API_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter,
  } as Env;
}

describe("request security middleware", () => {
  it("rejects a cross-site Origin before reaching the route", async () => {
    const limiter = { limit: vi.fn() } as unknown as RateLimit;
    const response = await testApp().request(
      "https://finance.shawnup.com/api/sync",
      {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      },
      testEnv(limiter),
    );

    expect(response.status).toBe(403);
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body", async () => {
    const limiter = { limit: vi.fn() } as unknown as RateLimit;
    const response = await testApp().request(
      "https://finance.shawnup.com/api/sync",
      {
        method: "POST",
        headers: {
          "Content-Length": String(MAX_REQUEST_BODY_BYTES + 1),
          Origin: "https://finance.shawnup.com",
        },
      },
      testEnv(limiter),
    );

    expect(response.status).toBe(413);
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("returns 429 when the Cloudflare limiter rejects the request", async () => {
    const limiter = {
      limit: vi.fn().mockResolvedValue({ success: false }),
    } as unknown as RateLimit;
    const response = await testApp().request(
      "https://finance.shawnup.com/api/sync",
      {
        method: "POST",
        headers: { Origin: "https://finance.shawnup.com" },
      },
      testEnv(limiter),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(limiter.limit).toHaveBeenCalledWith({ key: "single-user:sync" });
  });
});
