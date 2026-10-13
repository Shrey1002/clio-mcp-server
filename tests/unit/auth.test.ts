import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mockFetch, makeClient, testConfig, ok } from "../mocks/clio.js";
import { refreshTokens, exchangeCode, buildAuthorizeUrl, OAuthError } from "../../src/auth/oauth.js";
import { FileTokenStore } from "../../src/auth/token-store.js";

const tokenRoute = (resp: any, status = 200) => (c: any) => (c.path === "/oauth/token" ? { status, body: resp } : undefined);
const old = { accessToken: "A", refreshToken: "R_OLD", expiresAt: 0 };

describe("oauth", () => {
  it("authorize URL carries exact redirect_uri, state, redirect_on_decline", () => {
    const u = new URL(buildAuthorizeUrl(testConfig(), "st8"));
    expect(u.host).toBe("ca.app.clio.com");
    expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5678/callback");
    expect(u.searchParams.get("state")).toBe("st8");
    expect(u.searchParams.get("redirect_on_decline")).toBe("true");
  });
  it("token exchange is form-encoded, honors expires_in", async () => {
    const { impl, calls } = mockFetch([(c) => (c.path === "/oauth/token" ? { body: { access_token: "a", refresh_token: "r", expires_in: 3600 } } : undefined)]);
    const t = await exchangeCode(testConfig(), "CODE", impl, 1000);
    expect(calls[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("redirect_uri")).toBe("http://127.0.0.1:5678/callback");
    expect(t.expiresAt).toBe(1000 + 3600_000);
  });
  it("refresh WITHOUT rotation keeps the old refresh token", async () => {
    const { impl } = mockFetch([tokenRoute({ access_token: "A2", expires_in: 2592000 })]);
    const t = await refreshTokens(testConfig(), old, impl, 0);
    expect(t.refreshToken).toBe("R_OLD"); expect(t.accessToken).toBe("A2");
  });
  it("refresh WITH rotation persists the new refresh token", async () => {
    const { impl } = mockFetch([tokenRoute({ access_token: "A2", refresh_token: "R_NEW", expires_in: 60 })]);
    const t = await refreshTokens(testConfig(), old, impl, 0);
    expect(t.refreshToken).toBe("R_NEW"); expect(t.expiresAt).toBe(60_000);
  });
  it("invalid_grant gives an actionable message", async () => {
    const { impl } = mockFetch([tokenRoute({ error: "invalid_grant" }, 400)]);
    await expect(exchangeCode(testConfig(), "x", impl)).rejects.toThrow(/redirect_uri does not match/);
    await expect(exchangeCode(testConfig(), "x", impl)).rejects.toBeInstanceOf(OAuthError);
  });
});

describe("client token lifecycle", () => {
  it("proactively refreshes when <5 min remain and persists rotation", async () => {
    const h = makeClient([tokenRoute({ access_token: "AT2", refresh_token: "RT2", expires_in: 3600 }), (c) => (c.path === "/users/who_am_i.json" ? ok({ id: 1 }) : undefined)], { expiresInMs: 60_000 });
    await h.client.get("/users/who_am_i.json");
    expect(h.calls[0].path).toBe("/oauth/token");
    expect(h.calls[1].headers.Authorization).toBe("Bearer AT2");
    expect(h.store.load()?.refreshToken).toBe("RT2");
  });
  it("single-flight: concurrent requests trigger ONE refresh", async () => {
    const h = makeClient([tokenRoute({ access_token: "AT2", expires_in: 3600 }), () => ok({ id: 1 })], { expiresInMs: 1000 });
    await Promise.all([h.client.get("/a.json"), h.client.get("/b.json"), h.client.get("/c.json")]);
    expect(h.calls.filter((c) => c.path === "/oauth/token")).toHaveLength(1);
  });
  it("401 -> forced refresh -> one retry succeeds", async () => {
    let n = 0;
    const h = makeClient([tokenRoute({ access_token: "AT2", expires_in: 3600 }), (c) => (c.path === "/x.json" ? (++n === 1 ? { status: 401, body: { error: { message: "expired" } } } : ok({ id: 9 })) : undefined)]);
    const r = await h.client.get("/x.json");
    expect(r.data.id).toBe(9);
    expect(h.calls.map((c) => c.path)).toEqual(["/x.json", "/oauth/token", "/x.json"]);
  });
  it("expiresAt in the past (stale token) refreshes first", async () => {
    const h = makeClient([tokenRoute({ access_token: "AT2", expires_in: 3600 }), () => ok({})], { expiresInMs: -1000 });
    await h.client.get("/x.json");
    expect(h.calls[0].path).toBe("/oauth/token");
  });
  it("a second 401 is surfaced, not looped", async () => {
    const h = makeClient([tokenRoute({ access_token: "AT2", expires_in: 3600 }), () => ({ status: 401, body: { error: { message: "nope" } } })]);
    await expect(h.client.get("/x.json")).rejects.toMatchObject({ status: 401 });
    expect(h.calls.filter((c) => c.path === "/x.json")).toHaveLength(2);
  });
  it("tells the user to authenticate when there are no tokens", async () => {
    const h = makeClient([]);
    h.store.clear(); (h.client as any).tokens = undefined;
    await expect(h.client.get("/x.json")).rejects.toThrow(/npm run auth/);
  });
});

describe("token store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clio-ts-"));
  it("writes mode 0600 and round-trips", () => {
    const f = path.join(dir, "plain.json");
    const s = new FileTokenStore(f);
    s.save({ accessToken: "a", refreshToken: "r", expiresAt: 5 });
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(s.load()).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: 5 });
  });
  it("encrypts at rest (AES-256-GCM) and needs the key to read", () => {
    const f = path.join(dir, "enc.json");
    const s = new FileTokenStore(f, "a-long-secret-key-123456");
    s.save({ accessToken: "TOPSECRET", refreshToken: "r", expiresAt: 5 });
    expect(fs.readFileSync(f, "utf8")).not.toContain("TOPSECRET");
    expect(s.load()?.accessToken).toBe("TOPSECRET");
    expect(new FileTokenStore(f, "wrong-key-wrong-key-123").load()).toBeUndefined();
  });
});
