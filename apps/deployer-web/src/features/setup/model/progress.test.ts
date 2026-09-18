import { describe, expect, it } from "vitest";
import { nextAction, phaseState, publicSiteUrl } from "./progress";

describe("install progress mapping", () => {
  it("marks earlier phases done and the current phase active", () => {
    expect(
      phaseState("prepare", {
        status: "running",
        step: "create_access_app",
        errorCode: null,
      }),
    ).toBe("done");
    expect(
      phaseState("protect", {
        status: "running",
        step: "create_access_app",
        errorCode: null,
      }),
    ).toBe("active");
    expect(
      phaseState("verify", {
        status: "running",
        step: "create_access_app",
        errorCode: null,
      }),
    ).toBe("pending");
  });

  it("explains missing releases and expired tokens without claiming live deploy", () => {
    expect(nextAction("RELEASE_UNAVAILABLE")).toMatch(/版本包/);
    expect(nextAction("TOKEN_EXPIRED")).toMatch(/重新授權/);
    expect(nextAction("RELEASE_UNAVAILABLE")).not.toMatch(/一鍵部署已開放/);
  });

  it("builds the workers.dev URL from the recorded subdomain", () => {
    expect(
      publicSiteUrl("taiwan-fin-hub", { workersSubdomain: "example" }),
    ).toBe("https://taiwan-fin-hub.example.workers.dev/");
  });
});
