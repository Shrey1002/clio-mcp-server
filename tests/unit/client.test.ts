import { describe, it, expect } from "vitest";
import { makeClient, ok } from "../mocks/clio.js";
import { serializeQuery, encodePageToken } from "../../src/clients/clio-client.js";
import { ClioApiError, explainError } from "../../src/helpers/errors.js";

describe("query serialization", () => {
  it("arrays as ids[]=, nested as a[b]=, skips undefined", () => {
    expect(serializeQuery({ ids: [1, 2], rate_for: { matter_id: 5 }, x: undefined, q: "a b" })).toBe("ids[]=1&ids[]=2&rate_for[matter_id]=5&q=a%20b");
  });
});

describe("client requests", () => {
  it("sends pinned version, bearer, JSON accept", async () => {
    const h = makeClient([() => ok({})]);
    await h.client.get("/matters.json", { fields: "id" });
    expect(h.calls[0].headers["X-API-VERSION"]).toBe("4.0.13");
    expect(h.calls[0].headers.Authorization).toBe("Bearer AT1");
    expect(h.calls[0].url.startsWith("https://ca.app.clio.com/api/v4/matters.json")).toBe(true);
  });
  it("wraps POST/PATCH bodies in {data} INSIDE the client; sends IF-MATCH; never wraps GET/DELETE", async () => {
    const h = makeClient([() => ok({ id: 1 }), ]);
    await h.client.post("/tasks.json", { name: "x" });
    await h.client.patch("/tasks/1.json", { name: "y" }, undefined, "etag-1");
    expect(h.calls[0].body).toEqual({ data: { name: "x" } });
    expect(h.calls[1].body).toEqual({ data: { name: "y" } });
    expect(h.calls[1].headers["IF-MATCH"]).toBe("etag-1");
    const d = makeClient([() => ({ status: 204 })]);
    await d.client.delete("/tasks/1.json");
    expect(d.calls[0].body).toBeUndefined();
  });
  it("429: waits Retry-After, retries up to 3 times, then surfaces 429", async () => {
    let n = 0;
    const h = makeClient([() => (++n < 3 ? { status: 429, body: { error: { message: "slow" } }, headers: { "Retry-After": "7" } } : ok({ id: 1 }))]);
    const r = await h.client.get("/x.json");
    expect(r.data.id).toBe(1);
    expect(h.sleeps).toEqual([7000, 7000]);
    const bad = makeClient([() => ({ status: 429, body: { error: { message: "slow" } }, headers: { "Retry-After": "999" } })]);
    await expect(bad.client.get("/x.json")).rejects.toMatchObject({ status: 429 });
    expect(bad.calls).toHaveLength(4);
    expect(Math.max(...bad.sleeps)).toBe(120_000); // capped
  });
  it("throttles itself when X-RateLimit-Remaining hits 0", async () => {
    const h = makeClient([() => ({ ...ok({}), headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "5" } })]);
    await h.client.get("/a.json");
    await h.client.get("/b.json");
    expect(h.sleeps).toEqual([5000]);
  });
  it("maps Clio error JSON to ClioApiError with 422 field details", async () => {
    const h = makeClient([() => ({ status: 422, body: { error: { type: "InvalidRequest", message: "bad", errors: { "client.id": ["is required"] } } } })]);
    const e: any = await h.client.post("/matters.json", {}).catch((x) => x);
    expect(e).toBeInstanceOf(ClioApiError);
    expect(e.details).toEqual({ "client.id": ["is required"] });
    expect(explainError(e)).toContain("client.id");
  });
});

describe("pagination", () => {
  const next = "https://ca.app.clio.com/api/v4/matters.json?fields=id&limit=2&page_token=abc";
  it("defaults to order=id(asc) and limit=25, clamps to 200, returns cursor token", async () => {
    const h = makeClient([() => ({ body: { data: [{ id: 1 }, { id: 2 }], meta: { paging: { next } } } })]);
    const r = await h.client.list("/matters.json", { query: { fields: "id" } });
    expect(h.calls[0].query.get("order")).toBe("id(asc)");
    expect(h.calls[0].query.get("limit")).toBe("25");
    expect(r).toMatchObject({ has_more: true, total_returned: 2 });
    expect(Buffer.from(r.next_page_token!, "base64url").toString()).toBe(next);
    await h.client.list("/matters.json", { query: { fields: "id" }, limit: 9999 });
    expect(h.calls[1].query.get("limit")).toBe("200");
  });
  it("round-trips the page token and follows it verbatim", async () => {
    const h = makeClient([() => ok([{ id: 3 }])]);
    const r = await h.client.list("/matters.json", { pageToken: encodePageToken(next) });
    expect(h.calls[0].url).toBe(next);
    expect(r.has_more).toBe(false);
  });
  it("refuses page tokens pointing anywhere but the Clio API (SSRF / token exfiltration)", async () => {
    const h = makeClient([() => ok([])]);
    await expect(h.client.list("/m.json", { pageToken: encodePageToken("https://evil.example/steal") })).rejects.toThrow(/Invalid page_token/);
    await expect(h.client.list("/m.json", { pageToken: encodePageToken("https://app.clio.com/api/v4/matters.json") })).rejects.toThrow(/Invalid page_token/); // wrong region
    expect(h.calls).toHaveLength(0);
  });
});

describe("error mapping", () => {
  const e = (s: number) => explainError(new ClioApiError(s, "m", undefined, undefined, "GET", "/x"));
  it.each([[401, /npm run auth/], [403, /scope/], [404, /Not found/], [409, /open bills/], [410, /CLIO_API_VERSION/], [412, /ETag/], [422, /open matter/], [429, /Rate limited/]])("%i", (s, re) => {
    expect(e(s as number)).toMatch(re as RegExp);
  });
});
