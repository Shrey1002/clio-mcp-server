/**
 * Removes records whose text starts with MCP-TEST from the TEST account. DRY RUN unless --apply.
 * Run: npx tsx tests/integration/cleanup.ts [--apply]
 */
import "dotenv/config";
import { loadConfig } from "../../src/config.js";
import { FileTokenStore } from "../../src/auth/token-store.js";
import { ClioClient } from "../../src/clients/clio-client.js";

const apply = process.argv.includes("--apply");
const config = loadConfig();
const client = new ClioClient({ config, store: new FileTokenStore(config.tokenStorePath, config.tokenEncryptionKey) });

async function sweep(path: string, fields: string, label: (x: any) => string, extra: Record<string, unknown> = {}) {
  let token: string | undefined;
  do {
    const r = await client.list(path, { query: { fields, ...extra }, limit: 200, pageToken: token });
    for (const it of r.items.filter((x) => label(x).startsWith("MCP-TEST"))) {
      console.error(`${apply ? "DELETE" : "would delete"} ${path} ${it.id} "${label(it)}"`);
      if (apply) await client.delete(`${path.replace(".json", "")}/${it.id}.json`);
    }
    token = r.next_page_token;
  } while (token);
}

await sweep("/activities.json", "id,note", (x) => x.note ?? "");
await sweep("/tasks.json", "id,name", (x) => x.name ?? "");
await sweep("/notes.json", "id,subject", (x) => x.subject ?? "", { type: "Matter" });
await sweep("/calendar_entries.json", "id,summary", (x) => x.summary ?? "");
console.error("Contacts and matters are NOT auto-deleted (deleting can fail on open bills/matters); remove MCP-TEST ones in the Clio UI.");
