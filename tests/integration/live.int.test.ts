/**
 * Live integration tests against a DEDICATED TEST Clio account (never firm data).
 * Run: CLIO_INTEGRATION=1 npm run test:integration   (after `npm run auth`)
 * Everything created is prefixed MCP-TEST and removed by tests/integration/cleanup.ts.
 */
import "dotenv/config";
import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";
import { FileTokenStore } from "../../src/auth/token-store.js";
import { ClioClient } from "../../src/clients/clio-client.js";
import { FIELDS } from "../../src/helpers/fields.js";

const live = process.env.CLIO_INTEGRATION === "1";
const d = live ? describe : describe.skip;

d("live Clio (read-only checks)", () => {
  const config = loadConfig();
  const client = new ClioClient({ config, store: new FileTokenStore(config.tokenStorePath, config.tokenEncryptionKey) });

  it("who_am_i works in the configured region", async () => {
    const me = await client.getOne("/users/who_am_i.json", { fields: FIELDS.user });
    expect(me.id).toBeGreaterThan(0);
  });
  it("matters list returns real fields (not just id/etag)", async () => {
    const r = await client.list("/matters.json", { query: { fields: FIELDS.matter }, limit: 2 });
    if (r.items[0]) expect(Object.keys(r.items[0]).length).toBeGreaterThan(2);
  });
  it("QUIRK: matter_id filter really scopes activities (matter[id] would not)", async () => {
    const m = await client.list("/matters.json", { query: { fields: "id" }, limit: 1 });
    if (!m.items[0]) return;
    const r = await client.list("/activities.json", { query: { fields: FIELDS.activity, matter_id: m.items[0].id }, limit: 50 });
    for (const a of r.items) expect(a.matter?.id).toBe(m.items[0].id);
  });
  it("QUIRK: second-level nesting in fields gives 400", async () => {
    await expect(client.list("/matters.json", { query: { fields: "id,client{id,name,addresses{id}}" }, limit: 1 })).rejects.toMatchObject({ status: 400 });
  });
  it("QUIRK: invalid API version gives 410", async () => {
    const bad = new ClioClient({ config: { ...config, apiVersion: "9.9.9" }, store: new FileTokenStore(config.tokenStorePath, config.tokenEncryptionKey) });
    await expect(bad.getOne("/users/who_am_i.json")).rejects.toMatchObject({ status: 410 });
  });
});
