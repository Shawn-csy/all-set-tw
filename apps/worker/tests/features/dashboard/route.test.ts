import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/platform/env";
import { dashboardRoutes } from "../../../src/features/dashboard/route";

function env(first: () => Promise<unknown>): Env {
  return {
    DB: {
      prepare() {
        return { first };
      },
    } as unknown as D1Database,
    SYNC_QUEUE: {} as Queue,
    ASSETS: {} as Fetcher,
    BROWSER: {} as Fetcher,
    AI: {} as Ai,
  };
}

describe("dashboard readiness route", () => {
  it("reports ready when D1 accepts a probe query", async () => {
    const response = await dashboardRoutes.request(
      "/ready",
      {},
      env(async () => ({ ok: 1 })),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ready: true, d1: true });
  });

  it("returns unavailable when D1 rejects the probe query", async () => {
    const response = await dashboardRoutes.request(
      "/ready",
      {},
      env(async () => {
        throw new Error("D1 unavailable");
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ready: false,
      d1: false,
    });
  });
});
