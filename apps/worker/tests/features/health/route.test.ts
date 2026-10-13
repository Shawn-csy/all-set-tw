import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/platform/env";
import { app } from "../../../src/index";

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

describe("public health route", () => {
  it("returns a healthy JSON response when D1 accepts a probe query", async () => {
    const response = await app.request(
      "/health",
      {},
      env(async () => ({ ok: 1 })),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      ready: true,
      d1: true,
    });
  });

  it("returns 503 when D1 rejects the probe query", async () => {
    const response = await app.request(
      "/health",
      {},
      env(async () => {
        throw new Error("D1 unavailable");
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      ready: false,
      d1: false,
    });
  });
});
