import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARE_API_BASE,
  runAccountPrecheck,
} from "../../src/platform/cloudflare";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("account precheck", () => {
  it("is ready only when subdomain, Access org, and worker name are all free", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/workers/subdomain")) {
          return Response.json({ result: { subdomain: "ok" } });
        }
        if (url.endsWith("/access/organizations")) {
          return Response.json({
            result: { auth_domain: "team.cloudflareaccess.com" },
          });
        }
        if (url.includes("/workers/scripts/")) {
          return new Response(null, { status: 404 });
        }
        return new Response("unexpected " + url, { status: 500 });
      }),
    );
    await expect(
      runAccountPrecheck({
        accessToken: "token",
        accountId: "acct-1",
        workerName: "taiwan-fin-hub",
      }),
    ).resolves.toMatchObject({ ready: true });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain(CLOUDFLARE_API_BASE);
  });
});
