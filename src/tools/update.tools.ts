import { z } from "zod";
import { defineTool, idField, isoDate, type ToolDef, type Ctx } from "./define.js";
import { FIELDS } from "../helpers/fields.js";
import { hoursToSeconds } from "../helpers/units.js";
import { ClioApiError, UserError } from "../helpers/errors.js";

/**
 * Optimistic concurrency: GET the etag, PATCH with IF-MATCH. On 412 (record changed), re-fetch once and retry,
 * then report. PATCH is partial so only the fields we send are overwritten.
 */
export async function patchWithEtag(ctx: Ctx, resource: string, id: number, body: unknown, fields: string) {
  const path = `/${resource}/${id}.json`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await ctx.client.getOne(path, { fields: "id,etag" });
    if (!cur?.etag) throw new UserError(`Could not read the current ETag for ${resource} ${id}.`);
    try {
      const r = await ctx.client.patch(path, body, { fields }, cur.etag);
      return r.data;
    } catch (e) {
      if (e instanceof ClioApiError && e.status === 412 && attempt === 0) continue;
      throw e;
    }
  }
}

const nonEmpty = (obj: Record<string, unknown>, label: string) => {
  if (Object.keys(obj).length === 0) throw new UserError(`Nothing to update: provide at least one field to change on ${label}.`);
};
const pick = (a: any, keys: string[]) => Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
const prev = (resource: string, id: number, body: unknown, extra: Record<string, unknown> = {}) => ({ will_send: { method: "PATCH", path: `/${resource}/${id}.json`, headers: { "IF-MATCH": "<current etag, fetched first>" }, body }, ...extra });

export function buildMatterPatch(a: any) {
  const b: Record<string, unknown> = pick(a, ["description", "status", "close_date", "client_reference", "location", "billable"]);
  if (a.practice_area_id) b.practice_area = { id: a.practice_area_id };
  if (a.responsible_attorney_id) b.responsible_attorney = { id: a.responsible_attorney_id }; // USER id
  return b;
}
export const buildContactPatch = (a: any) => pick(a, ["first_name", "last_name", "name", "prefix", "title"]);
export function buildTaskPatch(a: any) {
  const b: Record<string, unknown> = pick(a, ["name", "description", "priority", "due_at", "status"]);
  if (a.assignee_id) b.assignee = { id: a.assignee_id, type: "User" };
  return b;
}
export function buildTimeEntryPatch(a: any) {
  const b: Record<string, unknown> = pick(a, ["date", "note", "price", "non_billable"]);
  if (a.hours !== undefined) b.quantity = hoursToSeconds(a.hours);
  if (a.matter_id) b.matter = { id: a.matter_id };
  if (a.activity_description_id) b.activity_description = { id: a.activity_description_id };
  return b;
}
export function buildCustomFieldPatch(a: any) {
  const entry: Record<string, unknown> = {};
  if (a.existing_value_id) entry.id = a.existing_value_id; else entry.custom_field = { id: a.custom_field_id };
  if (a.remove) entry._destroy = true; else entry.value = a.value;
  return { custom_field_values: [entry] };
}

export const updateTools: ToolDef<any>[] = [
  defineTool({
    name: "clio_update_matter", title: "Update matter", category: "UPDATE",
    description: "Update a matter (safe concurrency: re-reads the ETag and sends IF-MATCH). responsible_attorney_id is a USER ID. Changing billing method is not supported here (Clio ignores billing_method on PATCH).",
    schema: {
      id: idField("Matter ID"), description: z.string().min(1).max(1000).optional(), status: z.enum(["Open", "Pending", "Closed"]).optional(),
      practice_area_id: idField("Practice area ID").optional(), responsible_attorney_id: idField("User ID").optional(),
      close_date: isoDate.optional(), client_reference: z.string().max(250).optional(), location: z.string().max(250).optional(), billable: z.boolean().optional(),
    },
    check: (a) => nonEmpty(buildMatterPatch(a), "the matter"),
    preview: (a) => prev("matters", a.id, buildMatterPatch(a)),
    run: async (a, ctx) => ({ updated: await patchWithEtag(ctx, "matters", a.id, buildMatterPatch(a), FIELDS.matter) }),
  }),
  defineTool({
    name: "clio_update_contact", title: "Update contact", category: "UPDATE",
    description: "Update scalar fields of a contact (names, prefix, title). Use first_name/last_name for people and name for companies.",
    schema: { id: idField("Contact ID"), first_name: z.string().min(1).optional(), last_name: z.string().min(1).optional(), name: z.string().min(1).optional(), prefix: z.string().optional(), title: z.string().optional() },
    check: (a) => nonEmpty(buildContactPatch(a), "the contact"),
    preview: (a) => prev("contacts", a.id, buildContactPatch(a)),
    run: async (a, ctx) => ({ updated: await patchWithEtag(ctx, "contacts", a.id, buildContactPatch(a), FIELDS.contact) }),
  }),
  defineTool({
    name: "clio_update_task", title: "Update task", category: "UPDATE",
    description: "Update a task. Set status=complete to complete it.",
    schema: {
      id: idField("Task ID"), name: z.string().min(1).max(250).optional(), description: z.string().max(4000).optional(),
      priority: z.enum(["High", "Normal", "Low"]).optional(), due_at: z.string().optional().describe("YYYY-MM-DD or ISO datetime"),
      status: z.enum(["pending", "in_progress", "in_review", "complete"]).optional(), assignee_id: idField("User ID").optional(),
    },
    check: (a) => nonEmpty(buildTaskPatch(a), "the task"),
    preview: (a) => prev("tasks", a.id, buildTaskPatch(a)),
    run: async (a, ctx) => ({ updated: await patchWithEtag(ctx, "tasks", a.id, buildTaskPatch(a), FIELDS.task) }),
  }),
  defineTool({
    name: "clio_update_time_entry", title: "Update time entry", category: "UPDATE",
    description: "Update a time entry. hours are converted to seconds. WARNING: changing matter or activity description without also sending price makes Clio RESET the rate via its rate hierarchy.",
    schema: {
      id: idField("Time entry (activity) ID"), date: isoDate.optional(), hours: z.number().positive().max(24).optional().describe("Duration in HOURS."),
      note: z.string().trim().min(1).max(4000).optional(), price: z.number().nonnegative().optional(), non_billable: z.boolean().optional(),
      matter_id: idField("Move to this matter").optional(), activity_description_id: idField("Activity description ID").optional(),
    },
    check: (a) => nonEmpty(buildTimeEntryPatch(a), "the time entry"),
    preview: (a) => prev("activities", a.id, buildTimeEntryPatch(a), (a.matter_id || a.activity_description_id) && a.price === undefined
      ? { warning: "Rate will be RESET by Clio's rate hierarchy because matter/activity description changes without an explicit price. Pass price to keep the current rate." } : {}),
    run: async (a, ctx) => ({ updated: await patchWithEtag(ctx, "activities", a.id, buildTimeEntryPatch(a), FIELDS.activity) }),
  }),
  defineTool({
    name: "clio_set_custom_field_value", title: "Set custom field value", category: "UPDATE",
    description: "Set or remove a custom field value on a matter or contact. To change/remove an existing value pass existing_value_id (composite string such as 'text_line-55001', visible via clio_get_matter include_custom_fields=true); to add a new value pass only custom_field_id.",
    schema: {
      record_type: z.enum(["matter", "contact"]), record_id: idField("Matter or contact ID"), custom_field_id: idField("Custom field definition ID"),
      value: z.union([z.string(), z.number(), z.boolean()]).optional(), existing_value_id: z.string().optional(), remove: z.boolean().default(false),
    },
    check: (a) => {
      if (a.remove && !a.existing_value_id) throw new UserError("existing_value_id is required to remove a custom field value.");
      if (!a.remove && a.value === undefined) throw new UserError("value is required unless remove=true.");
    },
    preview: (a) => prev(`${a.record_type}s`, a.record_id, buildCustomFieldPatch(a)),
    run: async (a, ctx) => ({ updated: await patchWithEtag(ctx, `${a.record_type}s`, a.record_id, buildCustomFieldPatch(a), `id,etag,${FIELDS.custom_field_values}`) }),
  }),
];
