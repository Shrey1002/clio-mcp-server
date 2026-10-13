import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import type { ClioClient } from "./clients/clio-client.js";
import { AuditLog } from "./helpers/audit.js";
import { ConfirmGate } from "./helpers/confirm.js";
import { ok, fail } from "./helpers/format.js";
import { ClioApiError } from "./helpers/errors.js";
import { allTools } from "./tools/index.js";
import { annotationsFor, isEnabled, type Ctx, type ToolDef } from "./tools/define.js";

export interface ServerDeps { config: Config; client: ClioClient; audit?: AuditLog; gate?: ConfirmGate; now?: () => number; }

export function createServer(deps: ServerDeps): { server: McpServer; ctx: Ctx; registered: string[] } {
  const { config, client } = deps;
  const audit = deps.audit ?? new AuditLog(config.auditLogPath);
  const now = deps.now ?? Date.now;
  const gate = deps.gate ?? new ConfirmGate(undefined, now);
  let userId: Promise<number | undefined> | undefined;
  const ctx: Ctx = {
    client, config, audit, gate,
    now,
    getUserId: () => (userId ??= client.getOne("/users/who_am_i.json", { fields: "id" }).then((u: any) => u?.id as number).catch(() => undefined)),
  };

  const server = new McpServer({ name: "clio-mcp-server", version: "0.1.0" });
  const registered: string[] = [];

  for (const def of allTools as ToolDef<any>[]) {
    if (!isEnabled(config, def.category)) continue; // hidden from tools/list entirely
    const needsGate = def.category !== "READ" && config.requireConfirm;
    const shape: z.ZodRawShape = needsGate
      ? { ...def.schema, confirm: z.string().optional().describe("Confirmation token from the PREVIEW response. Call once without it to get a preview, then repeat with identical arguments plus confirm.") }
      : def.schema;

    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: shape, annotations: annotationsFor(def.category) },
      async (raw: any) => {
        const { confirm, ...args } = raw ?? {};
        try {
          def.check?.(args);
          if (def.category === "READ") return ok(await def.run(args, ctx)) as any;

          if (needsGate && !gate.verify(def.name, args, confirm)) {
            const token = gate.issue(def.name, args);
            audit.write({ tool: def.name, args, outcome: "refused", detail: confirm ? "invalid/expired confirmation token" : "preview issued" });
            return ok({
              status: "PREVIEW - nothing has been changed in Clio",
              tool: def.name,
              preview: await (def.preview ? def.preview(args, ctx) : args),
              confirm_token: token,
              next_step: "Show this to the user. If they approve, call the same tool again with IDENTICAL arguments plus confirm=<confirm_token> (valid 5 minutes).",
            }) as any;
          }

          const result = await def.run(args, ctx);
          audit.write({ tool: def.name, args, outcome: "success", clioUserId: await ctx.getUserId() });
          return ok(result) as any;
        } catch (e) {
          audit.write({ tool: def.name, args, outcome: "error", status: e instanceof ClioApiError ? e.status : undefined, detail: e instanceof Error ? e.message : String(e) });
          return fail(e) as any;
        }
      },
    );
    registered.push(def.name);
  }
  return { server, ctx, registered };
}
