import { describe, it, expect } from "vitest";
import { connect } from "../mocks/mcp.js";
import { allTools } from "../../src/tools/index.js";
import { categoryFromName } from "../../src/tools/define.js";

describe("tool gating via tools/list", () => {
  it("default env (all disabled) exposes ONLY read tools", async () => {
    const t = await connect([], { CLIO_DISABLE_WRITE: "true", CLIO_DISABLE_UPDATE: "true", CLIO_DISABLE_DELETE: "true" });
    const names = await t.listNames();
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((n) => /^clio_(create|update|set|delete)_/.test(n))).toEqual([]);
    expect(names).toContain("clio_get_current_user");
  });
  it("each kill switch hides exactly its verb", async () => {
    const w = await connect([], { CLIO_DISABLE_WRITE: "true" });
    const wn = await w.listNames();
    expect(wn.some((n) => n.startsWith("clio_create_"))).toBe(false);
    expect(wn.some((n) => n.startsWith("clio_update_"))).toBe(true);
    expect(wn.some((n) => n.startsWith("clio_delete_"))).toBe(true);
    const u = await connect([], { CLIO_DISABLE_UPDATE: "true" });
    const un = await u.listNames();
    expect(un.some((n) => n.startsWith("clio_update_") || n.startsWith("clio_set_"))).toBe(false);
    expect(un.some((n) => n.startsWith("clio_create_"))).toBe(true);
    const d = await connect([], { CLIO_DISABLE_DELETE: "true" });
    expect((await d.listNames()).some((n) => n.startsWith("clio_delete_"))).toBe(false);
  });
  it("all flags false exposes every tool", async () => {
    expect((await (await connect([])).listNames()).length).toBe(allTools.length);
  });
  it("every tool has a description, annotations and a verb-consistent category", async () => {
    const t = await connect([]);
    for (const tool of await t.listTools()) {
      expect(tool.description!.length).toBeGreaterThan(15);
      expect(tool.annotations).toBeDefined();
      const cat = categoryFromName(tool.name);
      expect(tool.annotations!.readOnlyHint).toBe(cat === "READ");
      expect(tool.annotations!.destructiveHint).toBe(cat === "DELETE");
      expect(tool.name).toMatch(/^clio_[a-z_]+$/);
    }
  });
  it("trust/payment tools are read-only: no create/update/delete trust tools exist", () => {
    expect(allTools.filter((t) => /trust|bank|allocation|payment/.test(t.name)).every((t) => t.category === "READ")).toBe(true);
  });
  it("no generic escape-hatch / arbitrary-URL tool exists", () => {
    expect(allTools.some((t) => /api_request|raw|fetch_url/.test(t.name))).toBe(false);
  });
  it("confirm field exists only on non-read tools and only when the gate is on", async () => {
    const on = await connect([], { CLIO_REQUIRE_CONFIRM: "true" });
    const byName = Object.fromEntries((await on.listTools()).map((x) => [x.name, x]));
    expect(Object.keys(byName.clio_create_task.inputSchema.properties!)).toContain("confirm");
    expect(Object.keys(byName.clio_search_matters.inputSchema.properties!)).not.toContain("confirm");
    const off = await connect([], { CLIO_REQUIRE_CONFIRM: "false" });
    const t2 = (await off.listTools()).find((x) => x.name === "clio_create_task")!;
    expect(Object.keys(t2.inputSchema.properties!)).not.toContain("confirm");
  });
});
