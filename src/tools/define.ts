import { z } from "zod";
import type { ClioClient } from "../clients/clio-client.js";
import type { Config } from "../config.js";
import type { AuditLog } from "../helpers/audit.js";
import type { ConfirmGate } from "../helpers/confirm.js";

export type Category = "READ" | "WRITE" | "UPDATE" | "DELETE";

export interface Ctx {
  client: ClioClient;
  config: Config;
  audit: AuditLog;
  gate: ConfirmGate;
  now: () => number;
  /** Set when a read returned suspected prompt-injection text; state-changing tools then need human approval. */
  security: { tainted: boolean; reasons: string[] };
  /** Cached id of the authenticated Clio user (for audit logs / defaults). */
  getUserId: () => Promise<number | undefined>;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  category: Category;
  schema: S;
  /** Cross-field validation; throw UserError. Runs before preview/confirm. */
  check?: (args: z.infer<z.ZodObject<S>>) => void;
  /** Human-readable description of what will happen (non-read tools). */
  preview?: (args: z.infer<z.ZodObject<S>>, ctx: Ctx) => unknown | Promise<unknown>;
  run: (args: z.infer<z.ZodObject<S>>, ctx: Ctx) => Promise<unknown>;
}

export const defineTool = <S extends z.ZodRawShape>(d: ToolDef<S>): ToolDef<S> => d;

/** Category from the verb after the `clio_` prefix: create=>WRITE, update/set=>UPDATE, delete=>DELETE, else READ. */
export function categoryFromName(name: string): Category {
  const verb = name.replace(/^clio_/, "").split("_")[0];
  if (verb === "create") return "WRITE";
  if (verb === "update" || verb === "set") return "UPDATE";
  if (verb === "delete") return "DELETE";
  return "READ";
}

export function isEnabled(c: Config, cat: Category): boolean {
  return !((cat === "WRITE" && c.disableWrite) || (cat === "UPDATE" && c.disableUpdate) || (cat === "DELETE" && c.disableDelete));
}

export function annotationsFor(cat: Category) {
  switch (cat) {
    case "READ": return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
    case "WRITE": return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
    case "UPDATE": return { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
    case "DELETE": return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };
  }
}

// ---- shared schema fragments ----
export const limitField = z.number().int().min(1).max(200).default(25).describe("Max records to return (1-200, default 25). Keep small to protect context.");
export const pageTokenField = z.string().optional().describe("Opaque page_token from a previous response (only when has_more is true).");
export const idField = (what: string) => z.number().int().positive().describe(what);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
export const isoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, "use ISO-8601 with offset, e.g. 2026-10-12T09:00:00-04:00");
