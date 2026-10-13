import type { Ctx } from "./define.js";
import { UserError } from "../helpers/errors.js";

export const DUPE_WINDOW_MS = 10 * 60_000;

/**
 * Clio has no idempotency key. Before a POST, look for an identical record created in the last ~10 minutes
 * and refuse if one exists.
 */
export async function refuseIfDuplicate(
  ctx: Ctx,
  what: string,
  path: string,
  query: Record<string, unknown>,
  same: (existing: any) => boolean,
): Promise<void> {
  const since = new Date(ctx.now() - DUPE_WINDOW_MS).toISOString();
  const r = await ctx.client.list(path, { query: { ...query, created_since: since }, limit: 50 });
  const hit = r.items.find(same);
  if (hit) {
    throw new UserError(
      `Refused: an identical ${what} (id ${hit.id}) was created in the last 10 minutes. Clio has no idempotency key, so this looks like a duplicate. If you really want another, change a field (e.g. the note) or wait 10 minutes.`,
    );
  }
}

export const eq = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
