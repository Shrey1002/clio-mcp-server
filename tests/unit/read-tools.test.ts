import { describe, it, expect } from "vitest";
import { connect } from "../mocks/mcp.js";
import { FIELDS } from "../../src/helpers/fields.js";
import { truncate, CHARACTER_LIMIT } from "../../src/helpers/format.js";

const list = (data: any[], extra: any = {}) => () => ({ body: { data, ...extra } });

describe("read tools: quirk regression", () => {
  it("ALWAYS sends fields (Clio returns only id+etag otherwise), with one nesting level max", async () => {
    const t = await connect([list([])]);
    const toolsWithFields: Record<string, any> = {
      clio_search_matters: {}, clio_search_contacts: {}, clio_search_activities: {}, clio_search_users: {}, clio_search_practice_areas: {},
      clio_search_activity_descriptions: {}, clio_search_tasks: {}, clio_search_calendar_entries: {}, clio_search_bills: {},
      clio_search_notes: { type: "Matter" }, clio_search_documents: {}, clio_search_custom_fields: {}, clio_get_outstanding_balances: {},
      clio_search_trust_line_items: {}, clio_search_bank_accounts: {}, clio_search_bank_transactions: {}, clio_search_allocations: {},
    };
    for (const [name, args] of Object.entries(toolsWithFields)) {
      t.calls.length = 0;
      const r = await t.call(name, args);
      expect(r.isError, name).toBe(false);
      const f = t.calls[0].query.get("fields");
      expect(f, name).toBeTruthy();
      expect(f!.split(",").length, name).toBeGreaterThan(2);
      expect(/\{[^}]*\{/.test(f!), `${name} has 2-level nesting`).toBe(false);
    }
    for (const v of Object.values(FIELDS)) expect(/\{[^}]*\{/.test(v)).toBe(false);
  });
  it("activities use matter_id (singular int), never matter / matter[id]; GET fields use note, not description or rate", async () => {
    const t = await connect([list([])]);
    await t.call("clio_search_activities", { matter_id: 42, user_id: 7, type: "TimeEntry" });
    const q = t.calls[0].query;
    expect(q.get("matter_id")).toBe("42");
    expect([...q.keys()].some((k) => k === "matter" || k.startsWith("matter["))).toBe(false);
    const fields = q.get("fields")!.split(/[,{}]/);
    expect(fields).toContain("note"); expect(fields).not.toContain("description"); expect(fields).not.toContain("rate");
    expect(q.get("order")).toBe("id(asc)");
  });
  it("activities expose seconds + hours and a page total of hours", async () => {
    const t = await connect([list([
      { id: 1, type: "TimeEntry", quantity: 5400, quantity_in_hours: 1.5 }, { id: 2, type: "TimeEntry", quantity: 900, quantity_in_hours: 0.25 }, { id: 3, type: "ExpenseEntry", quantity: 1, quantity_in_hours: 0 },
    ])]);
    const r = await t.call("clio_search_activities", {});
    expect(r.json.page_total_hours).toBe(1.75);
    expect(t.listTools).toBeDefined();
    const desc = (await t.listTools()).find((x) => x.name === "clio_search_activities")!.description!;
    expect(desc).toMatch(/SECONDS/);
  });
  it("search_matters maps filters to Clio params", async () => {
    const t = await connect([list([])]);
    await t.call("clio_search_matters", { status: "open", client_id: 9, responsible_attorney_id: 3, query: "smith" });
    const q = t.calls[0].query;
    expect([q.get("status"), q.get("client_id"), q.get("responsible_attorney_id"), q.get("query")]).toEqual(["open", "9", "3", "smith"]);
  });
  it("get_matter can include custom fields", async () => {
    const t = await connect([() => ({ body: { data: { id: 1 } } })]);
    await t.call("clio_get_matter", { id: 1, include_custom_fields: true });
    expect(t.calls[0].query.get("fields")).toContain("custom_field_values{");
  });
  it("overdue_only filters locally: past due and not complete", async () => {
    const past = "2020-01-01", future = "2099-01-01";
    const t = await connect([list([{ id: 1, due_at: past, status: "pending" }, { id: 2, due_at: past, status: "complete" }, { id: 3, due_at: future, status: "pending" }, { id: 4, status: "pending" }])]);
    const r = await t.call("clio_search_tasks", { overdue_only: true });
    expect(r.json.items.map((i: any) => i.id)).toEqual([1]);
  });
  it("documents return metadata plus download endpoint, never content", async () => {
    const t = await connect([list([{ id: 5, name: "a.pdf" }])]);
    const r = await t.call("clio_search_documents", {});
    expect(r.json.items[0].download_endpoint).toBe("https://ca.app.clio.com/api/v4/documents/5/download");
  });
  it("pagination envelope + token", async () => {
    const next = "https://ca.app.clio.com/api/v4/matters.json?page_token=zz";
    const t = await connect([list([{ id: 1 }], { meta: { paging: { next } } })]);
    const r = await t.call("clio_search_matters", {});
    expect(r.json).toMatchObject({ has_more: true, total_returned: 1 });
    t.calls.length = 0;
    await t.call("clio_search_matters", { page_token: r.json.next_page_token });
    expect(t.calls[0].url).toBe(next);
  });
  it("rejects a tampered page_token through the tool", async () => {
    const t = await connect([list([])]);
    const r = await t.call("clio_search_matters", { page_token: Buffer.from("https://evil.example/x").toString("base64url") });
    expect(r.isError).toBe(true); expect(t.calls).toHaveLength(0);
  });
  it("errors come back as isError with actionable text", async () => {
    const t = await connect([() => ({ status: 403, body: { error: { message: "forbidden" } } })]);
    const r = await t.call("clio_get_contact", { id: 1 });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/scope/);
  });
});

describe("truncation", () => {
  it("never exceeds the character cap and explains how to narrow", () => {
    const items = Array.from({ length: 2000 }, (_, i) => ({ id: i, note: "x".repeat(100) }));
    const { value, truncated } = truncate({ items, has_more: true, total_returned: items.length });
    expect(truncated).toBe(true);
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(value.truncation_note).toMatch(/Narrow/);
  });
  it("leaves small payloads untouched", () => {
    expect(truncate({ items: [1] }).truncated).toBe(false);
  });
});
