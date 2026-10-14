import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "../mocks/mcp.js";
import { buildTimeEntryBody, buildExpenseBody, buildNoteBody, buildTaskBody, buildCalendarBody, buildPersonBody, buildCompanyBody, buildMatterBody, buildFlatRatePatch } from "../../src/tools/write.tools.js";
import { normalizeLabel, hoursToSeconds } from "../../src/helpers/units.js";

const empty = (c: any) => (c.method === "GET" && c.path !== "/users/who_am_i.json" ? { body: { data: [] } } : undefined);
const whoami = (c: any) => (c.path === "/users/who_am_i.json" ? { body: { data: { id: 77 } } } : undefined);
const created = (data: any) => (c: any) => (c.method === "POST" ? { status: 201, body: { data } } : undefined);
const posts = (t: any) => t.calls.filter((c: any) => c.method === "POST");

describe("outbound bodies contain EXACTLY the expected keys (Clio silently drops unknown fields)", () => {
  it("time entry", () => {
    const b = buildTimeEntryBody({ matter_id: 5, date: "2026-10-01", hours: 1.5, note: "Draft" });
    expect(Object.keys(b).sort()).toEqual(["date", "matter", "note", "quantity", "type"]);
    expect(b).toMatchObject({ type: "TimeEntry", quantity: 5400, matter: { id: 5 } });
    expect(b).not.toHaveProperty("description");
    const full = buildTimeEntryBody({ matter_id: 5, date: "d", hours: 1, note: "n", activity_description_id: 3, utbms_activity_id: 1, utbms_task_id: 2, price: 250, non_billable: false });
    expect(Object.keys(full).sort()).toEqual(["activity_description", "date", "matter", "non_billable", "note", "price", "quantity", "type"]);
    expect(full.activity_description).toEqual({ id: 3, utbms_activity_id: 1, utbms_task_id: 2 });
  });
  it("hours -> seconds", () => { expect([0.25, 1, 1.5, 0.1].map(hoursToSeconds)).toEqual([900, 3600, 5400, 360]); });
  it("expense: quantity x price", () => {
    expect(buildExpenseBody({ matter_id: 1, date: "d", quantity: 1, price: 500, note: "Flat fee" })).toEqual({ type: "ExpenseEntry", date: "d", quantity: 1, price: 500, matter: { id: 1 }, note: "Flat fee" });
  });
  it("note: type required, correct association", () => {
    expect(buildNoteBody({ type: "Matter", matter_id: 1, subject: "s", detail: "d" })).toEqual({ type: "Matter", subject: "s", detail: "d", matter: { id: 1 } });
    expect(buildNoteBody({ type: "Contact", contact_id: 2, subject: "s", detail: "d" })).toEqual({ type: "Contact", subject: "s", detail: "d", contact: { id: 2 } });
  });
  it("task / calendar", () => {
    expect(buildTaskBody({ name: "n", priority: "High", due_at: "2026-10-12", matter_id: 1, assignee_id: 2 })).toEqual({ name: "n", priority: "High", description: "n", due_at: "2026-10-12", matter: { id: 1 }, assignee: { id: 2, type: "User" } });
    expect(buildTaskBody({ name: "n", priority: "Low", description: "d" }).description).toBe("d"); // API requires description
    expect(Object.keys(buildCalendarBody({ summary: "s", start_at: "a", end_at: "b", calendar_owner_id: 4 })).sort()).toEqual(["calendar_owner", "end_at", "start_at", "summary"]);
  });
  it("matter never carries top-level billing_method; attorneys are user ids; default attorney fallback", () => {
    const b = buildMatterBody({ client_id: 1, description: "d", billing_method: "flat" }, 99);
    expect(b).not.toHaveProperty("billing_method");
    expect(b).toEqual({ client: { id: 1 }, description: "d", responsible_attorney: { id: 99 } });
    expect(buildFlatRatePatch(5, 1000)).toEqual({ custom_rate: { type: "FlatRate", rates: [{ user: { id: 5 }, rate: 1000 }] } });
  });
  it("person vs company contact types; labels normalized to enums", () => {
    const p = buildPersonBody({ first_name: "A", last_name: "B", addresses: [{ label: "Business", street: "1 Main" }], emails: [{ address: "a@b.co", label: "work" }], phones: [{ number: "555-1234", label: "cell" }] });
    expect(p.type).toBe("Person");
    expect((p.addresses as any)[0].name).toBe("Work");
    expect((p.email_addresses as any)[0]).toEqual({ name: "Work", address: "a@b.co", default_email: true });
    expect((p.phone_numbers as any)[0].name).toBe("Work");
    expect(buildCompanyBody({ name: "Acme" }).type).toBe("Company");
    expect(["Work", "Home", "Billing", "Other"].map((x) => normalizeLabel("address", x.toUpperCase()))).toEqual(["Work", "Home", "Billing", "Other"]);
    expect(normalizeLabel("address", undefined)).toBe("Work");
  });
});

describe("write tools (confirm gate OFF)", () => {
  it("create_time_entry posts {data:{...}} with fields and refuses an identical entry made <10 min ago", async () => {
    const t = await connect([whoami, empty, created({ id: 1, quantity: 900 })]);
    const args = { matter_id: 5, date: "2026-10-01", hours: 0.25, note: "Call with client" };
    const r = await t.call("clio_create_time_entry", args);
    expect(r.isError).toBe(false);
    const post = posts(t)[0];
    expect(post.path).toBe("/activities.json");
    expect(post.body).toEqual({ data: { type: "TimeEntry", date: "2026-10-01", quantity: 900, matter: { id: 5 }, note: "Call with client" } });
    expect(post.query.get("fields")).toContain("quantity_in_hours");
    // duplicate lookup was issued with created_since
    const look = t.calls.find((c) => c.method === "GET" && c.path === "/activities.json")!;
    expect(look.query.get("matter_id")).toBe("5"); expect(look.query.get("created_since")).toBeTruthy();

    const dup = await connect([whoami, (c) => (c.method === "GET" && c.path === "/activities.json" ? { body: { data: [{ id: 99, date: "2026-10-01", quantity: 900, note: " call with CLIENT " }] } } : undefined), created({ id: 2 })]);
    const d = await dup.call("clio_create_time_entry", args);
    expect(d.isError).toBe(true); expect(d.text).toMatch(/duplicate/i); expect(posts(dup)).toHaveLength(0);
  });
  it("strictness: schema rejects bad input before any HTTP call", async () => {
    const t = await connect([whoami, empty, created({ id: 1 })]);
    const bad = await t.call("clio_create_time_entry", { matter_id: 5, date: "10/01/2026", hours: 0.25, note: "x" });
    expect(bad.isError).toBe(true); expect(t.calls).toHaveLength(0);
    const zero = await t.call("clio_create_time_entry", { matter_id: 5, date: "2026-10-01", hours: 0, note: "x" });
    expect(zero.isError).toBe(true);
  });
  it("create_note requires the matching id", async () => {
    const t = await connect([whoami, empty, created({ id: 1 })]);
    const r = await t.call("clio_create_note", { type: "Matter", subject: "s", detail: "d" });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/matter_id is required/);
  });
  it("calendar end before start is rejected", async () => {
    const t = await connect([whoami, empty, created({ id: 1 })]);
    const r = await t.call("clio_create_calendar_entry", { summary: "s", start_at: "2026-10-12T10:00:00-04:00", end_at: "2026-10-12T09:00:00-04:00", calendar_owner_id: 1 });
    expect(r.isError).toBe(true);
  });
  it("create_matter hourly: single POST", async () => {
    const t = await connect([whoami, empty, created({ id: 10, display_number: "00010-Smith" })]);
    const r = await t.call("clio_create_matter", { client_id: 1, description: "Estate" });
    expect(r.json.created.id).toBe(10); expect(t.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });
  it("create_matter flat fee: POST then custom_rate PATCH", async () => {
    const t = await connect([whoami, empty, created({ id: 10 }),
      (c) => (c.method === "GET" && c.path === "/matters/10.json" ? { body: { data: { id: 10, etag: "e1" } } } : undefined),
      (c) => (c.method === "PATCH" ? { body: { data: { id: 10, billing_method: "flat" } } } : undefined)]);
    const r = await t.call("clio_create_matter", { client_id: 1, description: "Will", responsible_attorney_id: 5, flat_rate_amount: 1500 });
    expect(r.json.flat_fee_applied).toBe(true);
    expect(posts(t)[0].body.data).not.toHaveProperty("billing_method");
    const patch = t.calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toEqual({ data: { custom_rate: { type: "FlatRate", rates: [{ user: { id: 5 }, rate: 1500 }] } } });
  });
  it("flat fee PATCH failure => clear partial-success error with the matter id", async () => {
    const t = await connect([whoami, empty, created({ id: 10, display_number: "M-10" }),
      (c) => (c.method === "GET" && c.path === "/matters/10.json" ? { body: { data: { id: 10, etag: "e" } } } : undefined),
      (c) => (c.method === "PATCH" ? { status: 422, body: { error: { message: "bad rate" } } } : undefined)]);
    const r = await t.call("clio_create_matter", { client_id: 1, description: "Will", responsible_attorney_id: 5, flat_rate_amount: 1500 });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/PARTIAL SUCCESS: matter 10/);
  });
  it("flat fee without any attorney is blocked before creating anything", async () => {
    const t = await connect([whoami, empty, created({ id: 10 })]);
    const r = await t.call("clio_create_matter", { client_id: 1, description: "x", flat_rate_amount: 100 });
    expect(r.isError).toBe(true); expect(posts(t)).toHaveLength(0);
  });
  it("CLIO_DEFAULT_ATTORNEY_ID fallback satisfies flat fee", async () => {
    const t = await connect([whoami, empty, created({ id: 10 }), (c) => (c.method === "GET" && c.path === "/matters/10.json" ? { body: { data: { id: 10, etag: "e" } } } : undefined), (c) => (c.method === "PATCH" ? { body: { data: { id: 10 } } } : undefined)], { CLIO_DEFAULT_ATTORNEY_ID: "42" });
    await t.call("clio_create_matter", { client_id: 1, description: "x", flat_rate_amount: 100 });
    expect(posts(t)[0].body.data.responsible_attorney).toEqual({ id: 42 });
  });
});

describe("confirmation gate (CLIO_REQUIRE_CONFIRM=true)", () => {
  const args = { matter_id: 5, date: "2026-10-01", hours: 0.25, note: "Call" };
  const routes = [whoami, empty, created({ id: 1 })];
  it("first call previews and writes NOTHING; second call with token writes", async () => {
    const t = await connect(routes, { CLIO_REQUIRE_CONFIRM: "true" });
    const p = await t.call("clio_create_time_entry", args);
    expect(p.json.status).toMatch(/PREVIEW/);
    expect(p.json.preview.will_send.body.quantity).toBe(900);
    expect(t.calls).toHaveLength(0);
    const w = await t.call("clio_create_time_entry", { ...args, confirm: p.json.confirm_token });
    expect(w.isError).toBe(false); expect(posts(t)).toHaveLength(1);
  });
  it("token is bound to identical args", async () => {
    const t = await connect(routes, { CLIO_REQUIRE_CONFIRM: "true" });
    const p = await t.call("clio_create_time_entry", args);
    const r = await t.call("clio_create_time_entry", { ...args, hours: 8, confirm: p.json.confirm_token });
    expect(r.json.status).toMatch(/PREVIEW/); expect(posts(t)).toHaveLength(0);
  });
  it("token is bound to the tool, rejects forgery, and expires after 5 minutes", async () => {
    const t = await connect(routes, { CLIO_REQUIRE_CONFIRM: "true" });
    const p = await t.call("clio_create_time_entry", args);
    const other = await t.call("clio_create_expense_entry", { matter_id: 5, date: "2026-10-01", quantity: 1, price: 10, note: "x", confirm: p.json.confirm_token });
    expect(other.json.status).toMatch(/PREVIEW/);
    const forged = await t.call("clio_create_time_entry", { ...args, confirm: "9999999999999.deadbeef" });
    expect(forged.json.status).toMatch(/PREVIEW/);
    t.clock.t += 5 * 60_000 + 1;
    const late = await t.call("clio_create_time_entry", { ...args, confirm: p.json.confirm_token });
    expect(late.json.status).toMatch(/PREVIEW/); expect(posts(t)).toHaveLength(0);
  });
  it("reads are never gated", async () => {
    const t = await connect([() => ({ body: { data: [] } })], { CLIO_REQUIRE_CONFIRM: "true" });
    expect((await t.call("clio_search_matters")).json.items).toEqual([]);
  });
});

describe("audit log", () => {
  it("writes one redacted JSONL line per write attempt with the Clio user id", async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clio-audit-")), "a.jsonl");
    const t = await connect([whoami, empty, created({ id: 1 })], { CLIO_REQUIRE_CONFIRM: "true" }, f);
    const args = { matter_id: 5, date: "2026-10-01", hours: 0.25, note: "Call" };
    const p = await t.call("clio_create_time_entry", args);
    await t.call("clio_create_time_entry", { ...args, confirm: p.json.confirm_token });
    const lines = fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.outcome)).toEqual(["refused", "success"]);
    expect(lines[1]).toMatchObject({ tool: "clio_create_time_entry", clioUserId: 77 });
    expect(JSON.stringify(lines)).not.toContain(p.json.confirm_token);
    expect(lines[1].args.confirm).toBeUndefined();
  });
  it("logs failures with status", async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clio-audit-")), "a.jsonl");
    const t = await connect([whoami, empty, (c) => (c.method === "POST" ? { status: 422, body: { error: { message: "bad" } } } : undefined)], {}, f);
    await t.call("clio_create_task", { name: "x" });
    expect(JSON.parse(fs.readFileSync(f, "utf8").trim())).toMatchObject({ outcome: "error", status: 422 });
  });
});
