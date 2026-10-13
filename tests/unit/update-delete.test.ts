import { describe, it, expect } from "vitest";
import { connect } from "../mocks/mcp.js";
import { buildCustomFieldPatch, buildTimeEntryPatch } from "../../src/tools/update.tools.js";

const etagGet = (path: string, etags: string[]) => (c: any) => (c.method === "GET" && c.path === path ? { body: { data: { id: 1, etag: etags.length > 1 ? etags.shift() : etags[0] } } } : undefined);
const patchOk = (c: any) => (c.method === "PATCH" ? { body: { data: { id: 1 } } } : undefined);

describe("updates with optimistic concurrency", () => {
  it("GETs etag, then PATCHes with IF-MATCH and {data} body", async () => {
    const t = await connect([etagGet("/matters/1.json", ["abc"]), patchOk]);
    const r = await t.call("clio_update_matter", { id: 1, status: "Closed", responsible_attorney_id: 4 });
    expect(r.isError).toBe(false);
    const p = t.calls.find((c) => c.method === "PATCH")!;
    expect(p.headers["IF-MATCH"]).toBe("abc");
    expect(p.body).toEqual({ data: { status: "Closed", responsible_attorney: { id: 4 } } });
    expect(t.calls[0].query.get("fields")).toBe("id,etag");
  });
  it("412: re-fetches the etag and retries once", async () => {
    let n = 0;
    const t = await connect([etagGet("/tasks/1.json", ["old", "new"]), (c) => (c.method === "PATCH" ? (++n === 1 ? { status: 412, body: { error: { message: "precondition" } } } : { body: { data: { id: 1 } } }) : undefined)]);
    const r = await t.call("clio_update_task", { id: 1, status: "complete" });
    expect(r.isError).toBe(false);
    const patches = t.calls.filter((c) => c.method === "PATCH");
    expect(patches.map((p) => p.headers["IF-MATCH"])).toEqual(["old", "new"]);
  });
  it("412 twice: reports cleanly", async () => {
    const t = await connect([etagGet("/tasks/1.json", ["e"]), (c) => (c.method === "PATCH" ? { status: 412, body: { error: { message: "x" } } } : undefined)]);
    const r = await t.call("clio_update_task", { id: 1, name: "n" });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/Re-fetch/);
    expect(t.calls.filter((c) => c.method === "PATCH")).toHaveLength(2);
  });
  it("empty update is rejected without any HTTP call", async () => {
    const t = await connect([etagGet("/matters/1.json", ["a"]), patchOk]);
    const r = await t.call("clio_update_matter", { id: 1 });
    expect(r.isError).toBe(true); expect(t.calls).toHaveLength(0);
  });
  it("time entry: hours->seconds; preview warns about rate reset when matter changes without price", async () => {
    expect(buildTimeEntryPatch({ hours: 2, matter_id: 9 })).toEqual({ quantity: 7200, matter: { id: 9 } });
    const t = await connect([etagGet("/activities/1.json", ["a"]), patchOk], { CLIO_REQUIRE_CONFIRM: "true" });
    const p = await t.call("clio_update_time_entry", { id: 1, matter_id: 9 });
    expect(p.json.preview.warning).toMatch(/RESET/);
    const p2 = await t.call("clio_update_time_entry", { id: 1, matter_id: 9, price: 300 });
    expect(p2.json.preview.warning).toBeUndefined();
    expect(t.calls).toHaveLength(0);
  });
  it("custom field value patches", () => {
    expect(buildCustomFieldPatch({ custom_field_id: 3, value: "x" })).toEqual({ custom_field_values: [{ custom_field: { id: 3 }, value: "x" }] });
    expect(buildCustomFieldPatch({ existing_value_id: "text_line-55001", value: "y" })).toEqual({ custom_field_values: [{ id: "text_line-55001", value: "y" }] });
    expect(buildCustomFieldPatch({ existing_value_id: "text_line-55001", remove: true })).toEqual({ custom_field_values: [{ id: "text_line-55001", _destroy: true }] });
  });
  it("custom field: remove needs existing_value_id; set needs a value", async () => {
    const t = await connect([]);
    expect((await t.call("clio_set_custom_field_value", { record_type: "matter", record_id: 1, custom_field_id: 2, remove: true })).isError).toBe(true);
    expect((await t.call("clio_set_custom_field_value", { record_type: "matter", record_id: 1, custom_field_id: 2 })).isError).toBe(true);
  });
  it("update tools hidden when CLIO_DISABLE_UPDATE=true (calling them fails)", async () => {
    const t = await connect([], { CLIO_DISABLE_UPDATE: "true" });
    const r = await t.call("clio_update_matter", { id: 1, status: "Closed" }).catch((e) => ({ isError: true, text: String(e) }));
    expect(r.isError).toBe(true);
  });
});

describe("deletes", () => {
  it("send no fields param; 204 => deleted", async () => {
    const t = await connect([(c) => (c.method === "DELETE" ? { status: 204 } : undefined)]);
    const r = await t.call("clio_delete_task", { id: 5 });
    expect(r.json).toEqual({ deleted: true, id: 5 });
    expect(t.calls[0].method).toBe("DELETE"); expect(t.calls[0].query.has("fields")).toBe(false); expect(t.calls[0].body).toBeUndefined();
  });
  it("404 => friendly already-gone result, not a crash", async () => {
    const t = await connect([() => ({ status: 404, body: { error: { message: "nf" } } })]);
    const r = await t.call("clio_delete_note", { id: 5 });
    expect(r.isError).toBe(false); expect(r.json.deleted).toBe(false);
  });
  it("unreachable without confirmation token when gate is on; preview warns permanent", async () => {
    const t = await connect([(c) => (c.method === "DELETE" ? { status: 204 } : undefined)], { CLIO_REQUIRE_CONFIRM: "true" });
    const p = await t.call("clio_delete_time_entry", { id: 3 });
    expect(p.json.preview.warning).toMatch(/permanently/);
    expect(t.calls).toHaveLength(0);
    const w = await t.call("clio_delete_time_entry", { id: 3, confirm: p.json.confirm_token });
    expect(w.json.deleted).toBe(true); expect(t.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });
  it("409/422 dependency errors are mapped to friendly text", async () => {
    const t409 = await connect([() => ({ status: 409, body: { error: { message: "open bills" } } })]);
    expect((await t409.call("clio_delete_calendar_entry", { id: 1 })).text).toMatch(/open bills/);
  });
});
