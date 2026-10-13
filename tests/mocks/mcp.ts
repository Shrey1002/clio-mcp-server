import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { AuditLog } from "../../src/helpers/audit.js";
import { makeClient, testConfig, type Handler } from "./clio.js";

export async function connect(routes: Handler[], env: Record<string, string> = {}, auditFile?: string) {
  const config = testConfig(env);
  const h = makeClient(routes, { config });
  const { server, registered } = createServer({ config, client: h.client, audit: new AuditLog(auditFile), now: () => h.clock.t });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await mcp.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text as string;
    let json: any; try { json = JSON.parse(text); } catch { /* error text */ }
    return { isError: !!r.isError, text, json, raw: r };
  };
  return { ...h, mcp, call, registered, listNames: async () => (await mcp.listTools()).tools.map((t) => t.name), listTools: async () => (await mcp.listTools()).tools };
}
