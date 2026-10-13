import { describe, it, expect } from "vitest";
import { waitForCallback } from "../../src/auth/oauth.js";
import { testConfig } from "../mocks/clio.js";

const cfg = testConfig({ CLIO_REDIRECT_PORT: "5791" });

describe("OAuth loopback callback", () => {
  it("returns the code when state matches", async () => {
    const { ready, code } = waitForCallback(cfg, "good-state", 5000);
    await ready;
    const res = await fetch("http://127.0.0.1:5791/callback?code=THE_CODE&state=good-state");
    expect(res.status).toBe(200);
    expect(await code).toBe("THE_CODE");
  });
  it("rejects a state mismatch (CSRF)", async () => {
    const { ready, code } = waitForCallback(cfg, "good-state", 5000);
    code.catch(() => {});
    await ready;
    const res = await fetch("http://127.0.0.1:5791/callback?code=X&state=evil");
    expect(res.status).toBe(400);
    await expect(code).rejects.toThrow(/state mismatch/i);
  });
  it("handles access_denied", async () => {
    const { ready, code } = waitForCallback(cfg, "s", 5000);
    code.catch(() => {});
    await ready;
    await fetch("http://127.0.0.1:5791/callback?error=access_denied&state=s");
    await expect(code).rejects.toThrow(/access_denied/);
  });
});

describe("OAuth loopback callback, bare redirect URI (http://127.0.0.1:PORT)", () => {
  it("accepts the code on / when no path is configured", async () => {
    const bare = testConfig({ CLIO_REDIRECT_PORT: "5792", CLIO_REDIRECT_PATH: "none" });
    const { ready, code } = waitForCallback(bare, "st", 5000);
    await ready;
    expect((await fetch("http://127.0.0.1:5792/?code=C1&state=st")).status).toBe(200);
    expect(await code).toBe("C1");
  });
});
