import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { AuditLog } from "../../src/helpers/audit.js";
import { makeClient, testConfig, type Handler } from "./clio.js";

export interface ConnectOpts { auditFile?: string; elicit?: (message: string) => { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> } }

export async function connect(routes: Handler[], env: Record<string, string> = {}, auditFileOrOpts?: string | ConnectOpts) {
  const opts: ConnectOpts = typeof auditFileOrOpts === "string" ? { auditFile: auditFileOrOpts } : auditFileOrOpts ?? {};
  const auditFile = opts.auditFile;
  const prompts: string[] = [];
  const config = testConfig(env);
  const h = makeClient(routes, { config });
  const { server, registered } = createServer({ config, client: h.client, audit: new AuditLog(auditFile), now: () => h.clock.t });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1" }, opts.elicit ? { capabilities: { elicitation: {} } } : undefined);
  if (opts.elicit) mcp.setRequestHandler(ElicitRequestSchema, async (req: any) => { prompts.push(req.params.message); return opts.elicit!(req.params.message) as any; });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await mcp.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text as string;
    let json: any; try { json = JSON.parse(text); } catch { /* error text */ }
    return { isError: !!r.isError, text, json, raw: r };
  };
  return { ...h, mcp, call, prompts, registered, listNames: async () => (await mcp.listTools()).tools.map((t) => t.name), listTools: async () => (await mcp.listTools()).tools };
}
