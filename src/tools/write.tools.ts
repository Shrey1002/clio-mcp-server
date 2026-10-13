import { z } from "zod";
import { defineTool, idField, isoDate, isoDateTime, type ToolDef } from "./define.js";
import { FIELDS } from "../helpers/fields.js";
import { hoursToSeconds, normalizeLabel } from "../helpers/units.js";
import { UserError } from "../helpers/errors.js";
import { refuseIfDuplicate, eq } from "./dupe.js";

const note = z.string().trim().min(1).max(4000);
const preview = (method: string, path: string, body: unknown, extra: Record<string, unknown> = {}) => ({ will_send: { method, path, body }, ...extra });

// ---------- body builders (exported for outbound-body tests) ----------
export function buildTimeEntryBody(a: any) {
  const body: Record<string, unknown> = {
    type: "TimeEntry",
    date: a.date,
    quantity: hoursToSeconds(a.hours), // seconds on API >= 4.0.4
    matter: { id: a.matter_id },
    note: a.note, // GET accepts `note` only; use it everywhere
  };
  if (a.activity_description_id || a.utbms_activity_id || a.utbms_task_id) {
    body.activity_description = {
      ...(a.activity_description_id ? { id: a.activity_description_id } : {}),
      ...(a.utbms_activity_id ? { utbms_activity_id: a.utbms_activity_id } : {}),
      ...(a.utbms_task_id ? { utbms_task_id: a.utbms_task_id } : {}),
    };
  }
  if (a.price !== undefined) body.price = a.price;
  if (a.non_billable !== undefined) body.non_billable = a.non_billable;
  return body;
}

export function buildExpenseBody(a: any) {
  const body: Record<string, unknown> = {
    type: "ExpenseEntry",
    date: a.date,
    quantity: a.quantity, // total = quantity x price; flat-fee style line items use quantity=1
    price: a.price,
    matter: { id: a.matter_id },
    note: a.note,
  };
  if (a.expense_category_id) body.expense_category = { id: a.expense_category_id };
  if (a.non_billable !== undefined) body.non_billable = a.non_billable;
  return body;
}

export function buildNoteBody(a: any) {
  const body: Record<string, unknown> = { type: a.type, subject: a.subject, detail: a.detail };
  if (a.date) body.date = a.date;
  if (a.type === "Matter") body.matter = { id: a.matter_id }; else body.contact = { id: a.contact_id };
  return body;
}

export function buildTaskBody(a: any) {
  const body: Record<string, unknown> = { name: a.name, priority: a.priority };
  if (a.description) body.description = a.description;
  if (a.due_at) body.due_at = a.due_at;
  if (a.matter_id) body.matter = { id: a.matter_id };
  if (a.assignee_id) body.assignee = { id: a.assignee_id, type: "User" };
  return body;
}

export function buildCalendarBody(a: any) {
  const body: Record<string, unknown> = {
    summary: a.summary, start_at: a.start_at, end_at: a.end_at,
    calendar_owner: { id: a.calendar_owner_id },
  };
  if (a.all_day !== undefined) body.all_day = a.all_day;
  if (a.location) body.location = a.location;
  if (a.description) body.description = a.description;
  if (a.matter_id) body.matter = { id: a.matter_id };
  return body;
}

const emailShape = z.object({ address: z.string().email(), label: z.string().optional().describe("Work, Home or Other (anything else becomes Work)"), is_default: z.boolean().optional() });
const phoneShape = z.object({ number: z.string().min(3), label: z.string().optional().describe("Work, Home, Mobile, Fax or Other (anything else becomes Work)"), is_default: z.boolean().optional() });
const addressShape = z.object({
  label: z.string().optional().describe("Work, Home, Billing or Other (anything else, e.g. 'Business', becomes Work)"),
  street: z.string().optional(), city: z.string().optional(), province: z.string().optional(), postal_code: z.string().optional(), country: z.string().optional(),
});

function contactCommon(a: any) {
  const body: Record<string, unknown> = {};
  if (a.emails?.length) body.email_addresses = a.emails.map((e: any, i: number) => ({ name: normalizeLabel("email", e.label), address: e.address, default_email: e.is_default ?? i === 0 }));
  if (a.phones?.length) body.phone_numbers = a.phones.map((p: any, i: number) => ({ name: normalizeLabel("phone", p.label), number: p.number, default_number: p.is_default ?? i === 0 }));
  if (a.addresses?.length) body.addresses = a.addresses.map((d: any) => ({ name: normalizeLabel("address", d.label), street: d.street, city: d.city, province: d.province, postal_code: d.postal_code, country: d.country }));
  return body;
}

export function buildPersonBody(a: any) {
  const body: Record<string, unknown> = { type: "Person", first_name: a.first_name, last_name: a.last_name, ...contactCommon(a) };
  if (a.middle_name) body.middle_name = a.middle_name;
  if (a.prefix) body.prefix = a.prefix;
  if (a.title) body.title = a.title;
  if (a.company_id) body.company = { id: a.company_id };
  return body;
}
export const buildCompanyBody = (a: any) => ({ type: "Company", name: a.name, ...contactCommon(a) });

export function buildMatterBody(a: any, defaultAttorney?: number) {
  const body: Record<string, unknown> = { client: { id: a.client_id }, description: a.description };
  if (a.status) body.status = a.status;
  if (a.practice_area_id) body.practice_area = { id: a.practice_area_id };
  const resp = a.responsible_attorney_id ?? defaultAttorney;
  if (resp) body.responsible_attorney = { id: resp }; // USER id, not contact id
  if (a.originating_attorney_id) body.originating_attorney = { id: a.originating_attorney_id };
  if (a.open_date) body.open_date = a.open_date;
  if (a.billable !== undefined) body.billable = a.billable;
  if (a.client_reference) body.client_reference = a.client_reference;
  if (a.location) body.location = a.location;
  // NOTE: never send top-level billing_method; Clio silently ignores it. Flat fee uses custom_rate (see run()).
  return body;
}

export const buildFlatRatePatch = (attorneyId: number, amount: number) => ({
  custom_rate: { type: "FlatRate", rates: [{ user: { id: attorneyId }, rate: amount }] },
});

export class PartialSuccessError extends UserError {}

export const writeTools: ToolDef<any>[] = [
  defineTool({
    name: "clio_create_time_entry", title: "Create time entry", category: "WRITE",
    description: "Create a billable time entry on a matter. Provide HOURS (converted to seconds for Clio). A zero-hour entry totals $0 regardless of price. For flat-fee line items use clio_create_expense_entry (quantity=1, price=N). LEDES/UTBMS matters need utbms_activity_id + utbms_task_id on billable entries.",
    schema: {
      matter_id: idField("Matter ID"), date: isoDate.describe("Work date YYYY-MM-DD"),
      hours: z.number().positive().max(24).describe("Duration in HOURS (e.g. 0.25 = 15 min)."),
      note,
      activity_description_id: idField("Activity description ID").optional(),
      utbms_activity_id: idField("UTBMS activity ID (LEDES matters)").optional(),
      utbms_task_id: idField("UTBMS task ID (LEDES matters)").optional(),
      price: z.number().nonnegative().optional().describe("Hourly rate override. Omit to use Clio's rate hierarchy."),
      non_billable: z.boolean().optional(),
    },
    preview: (a) => preview("POST", "/activities.json", buildTimeEntryBody(a)),
    run: async (a, ctx) => {
      await refuseIfDuplicate(ctx, "time entry", "/activities.json", { matter_id: a.matter_id, type: "TimeEntry", fields: FIELDS.activity },
        (x) => x.date === a.date && Number(x.quantity) === hoursToSeconds(a.hours) && eq(x.note, a.note));
      const r = await ctx.client.post("/activities.json", buildTimeEntryBody(a), { fields: FIELDS.activity });
      return { created: r.data };
    },
  }),

  defineTool({
    name: "clio_create_expense_entry", title: "Create expense entry", category: "WRITE",
    description: "Create an expense entry (also the right tool for flat-fee style line items: quantity=1, price=N). total = quantity x price.",
    schema: {
      matter_id: idField("Matter ID"), date: isoDate, quantity: z.number().positive().default(1).describe("Units (default 1)."),
      price: z.number().nonnegative().describe("Unit price in the matter currency."), note,
      expense_category_id: idField("Expense category ID").optional(), non_billable: z.boolean().optional(),
    },
    preview: (a) => preview("POST", "/activities.json", buildExpenseBody(a), { computed_total: a.quantity * a.price }),
    run: async (a, ctx) => {
      await refuseIfDuplicate(ctx, "expense entry", "/activities.json", { matter_id: a.matter_id, type: "ExpenseEntry", fields: FIELDS.activity },
        (x) => x.date === a.date && Number(x.price) === a.price && Number(x.quantity) === a.quantity && eq(x.note, a.note));
      const r = await ctx.client.post("/activities.json", buildExpenseBody(a), { fields: FIELDS.activity });
      return { created: r.data };
    },
  }),

  defineTool({
    name: "clio_create_note", title: "Create note", category: "WRITE",
    description: "Create a note on a matter or contact. `type` is required by Clio: Matter or Contact (supply the matching ID).",
    schema: {
      type: z.enum(["Matter", "Contact"]), matter_id: idField("Matter ID (when type=Matter)").optional(), contact_id: idField("Contact ID (when type=Contact)").optional(),
      subject: z.string().trim().min(1).max(250), detail: z.string().trim().min(1).max(20000), date: isoDate.optional(),
    },
    check: (a) => {
      if (a.type === "Matter" && !a.matter_id) throw new UserError("matter_id is required when type=Matter.");
      if (a.type === "Contact" && !a.contact_id) throw new UserError("contact_id is required when type=Contact.");
    },
    preview: (a) => preview("POST", "/notes.json", buildNoteBody(a)),
    run: async (a, ctx) => {
      await refuseIfDuplicate(ctx, "note", "/notes.json", { type: a.type, ...(a.matter_id ? { matter_id: a.matter_id } : { contact_id: a.contact_id }), fields: FIELDS.note },
        (x) => eq(x.subject, a.subject) && eq(x.detail, a.detail));
      const r = await ctx.client.post("/notes.json", buildNoteBody(a), { fields: FIELDS.note });
      return { created: r.data };
    },
  }),

  defineTool({
    name: "clio_create_task", title: "Create task", category: "WRITE",
    description: "Create a task. Optional matter and assignee (assignee is a User ID).",
    schema: {
      name: z.string().trim().min(1).max(250), description: z.string().max(4000).optional(),
      priority: z.enum(["High", "Normal", "Low"]).default("Normal"),
      due_at: z.union([isoDate, isoDateTime]).optional().describe("Due date (YYYY-MM-DD) or ISO datetime."),
      matter_id: idField("Matter ID").optional(), assignee_id: idField("User ID of the assignee").optional(),
    },
    preview: (a) => preview("POST", "/tasks.json", buildTaskBody(a)),
    run: async (a, ctx) => {
      await refuseIfDuplicate(ctx, "task", "/tasks.json", { ...(a.matter_id ? { matter_id: a.matter_id } : {}), fields: FIELDS.task }, (x) => eq(x.name, a.name) && eq(x.due_at, a.due_at));
      const r = await ctx.client.post("/tasks.json", buildTaskBody(a), { fields: FIELDS.task });
      return { created: r.data };
    },
  }),

  defineTool({
    name: "clio_create_calendar_entry", title: "Create calendar entry", category: "WRITE",
    description: "Create a calendar entry. calendar_owner_id is the calendar (user calendar) ID you have Editor rights on.",
    schema: {
      summary: z.string().trim().min(1).max(250), start_at: isoDateTime, end_at: isoDateTime,
      calendar_owner_id: idField("Calendar ID (you need Editor rights)"),
      all_day: z.boolean().optional(), location: z.string().max(250).optional(), description: z.string().max(4000).optional(), matter_id: idField("Matter ID").optional(),
    },
    check: (a) => { if (Date.parse(a.end_at) < Date.parse(a.start_at)) throw new UserError("end_at must not be before start_at."); },
    preview: (a) => preview("POST", "/calendar_entries.json", buildCalendarBody(a)),
    run: async (a, ctx) => {
      await refuseIfDuplicate(ctx, "calendar entry", "/calendar_entries.json", { from: a.start_at.slice(0, 10), to: a.end_at.slice(0, 10), fields: FIELDS.calendar_entry },
        (x) => eq(x.summary, a.summary) && Date.parse(x.start_at) === Date.parse(a.start_at));
      const r = await ctx.client.post("/calendar_entries.json", buildCalendarBody(a), { fields: FIELDS.calendar_entry });
      return { created: r.data };
    },
  }),

  defineTool({
    name: "clio_create_person_contact", title: "Create person contact", category: "WRITE",
    description: "Create a Person contact. Address/phone/email labels are normalized to Clio's enums (unknown => Work).",
    schema: {
      first_name: z.string().trim().min(1), last_name: z.string().trim().min(1), middle_name: z.string().optional(), prefix: z.string().optional(), title: z.string().optional(),
      company_id: idField("Company contact ID to link").optional(),
      emails: z.array(emailShape).max(5).optional(), phones: z.array(phoneShape).max(5).optional(), addresses: z.array(addressShape).max(5).optional(),
    },
    preview: (a) => preview("POST", "/contacts.json", buildPersonBody(a)),
    run: async (a, ctx) => {
      await refuseIfDuplicate(ctx, "contact", "/contacts.json", { type: "Person", query: `${a.first_name} ${a.last_name}`, fields: FIELDS.contact }, (x) => eq(x.name, `${a.first_name} ${a.last_name}`));
      const r = await ctx.client.post("/contacts.json", buildPersonBody(a), { fields: FIELDS.contact });
      return { created: r.data };
    },
  }),

  defineTool({
    name: "clio_create_company_contact", title: "Create company contact", category: "WRITE",
    description: "Create a Company contact. Labels are normalized to Clio's enums (unknown => Work).",
    schema: {
      name: z.string().trim().min(1),
      emails: z.array(emailShape).max(5).optional(), phones: z.array(phoneShape).max(5).optional(), addresses: z.array(addressShape).max(5).optional(),
    },
    preview: (a) => preview("POST", "/contacts.json", buildCompanyBody(a)),
    run: async (a, ctx) => {
      await refuseIfDuplicate(ctx, "contact", "/contacts.json", { type: "Company", query: a.name, fields: FIELDS.contact }, (x) => eq(x.name, a.name));
      const r = await ctx.client.post("/contacts.json", buildCompanyBody(a), { fields: FIELDS.contact });
      return { created: r.data };
    },
  }),

  defineTool({
    name: "clio_create_matter", title: "Create matter", category: "WRITE",
    description:
      "Create a matter for a client. responsible_attorney_id / originating_attorney_id are USER IDs (not contact IDs; use clio_search_users). For a flat-fee matter pass flat_rate_amount: the matter is created, then a custom_rate PATCH is applied (Clio ignores top-level billing_method). If the PATCH fails you get a partial-success error containing the new matter ID.",
    schema: {
      client_id: idField("Client contact ID"), description: z.string().trim().min(1).max(1000),
      status: z.enum(["Open", "Pending", "Closed"]).optional(), practice_area_id: idField("Practice area ID (metadata only; no billing effect)").optional(),
      responsible_attorney_id: idField("User ID").optional(), originating_attorney_id: idField("User ID").optional(),
      open_date: isoDate.optional(), billable: z.boolean().optional(), client_reference: z.string().max(250).optional(), location: z.string().max(250).optional(),
      flat_rate_amount: z.number().positive().optional().describe("Makes the matter flat-fee at this amount."),
    },
    check: () => {},
    preview: (a, ctx) => {
      const body = buildMatterBody(a, ctx.config.defaultAttorneyId);
      const att = a.responsible_attorney_id ?? ctx.config.defaultAttorneyId;
      return {
        step_1: { method: "POST", path: "/matters.json", body },
        ...(a.flat_rate_amount ? { step_2: { method: "PATCH", path: "/matters/{new id}.json", body: att ? buildFlatRatePatch(att, a.flat_rate_amount) : "BLOCKED: needs a responsible_attorney_id (or CLIO_DEFAULT_ATTORNEY_ID)" } } : {}),
      };
    },
    run: async (a, ctx) => {
      const att = a.responsible_attorney_id ?? ctx.config.defaultAttorneyId;
      if (a.flat_rate_amount && !att) throw new UserError("flat_rate_amount requires responsible_attorney_id (or CLIO_DEFAULT_ATTORNEY_ID).");
      await refuseIfDuplicate(ctx, "matter", "/matters.json", { client_id: a.client_id, fields: FIELDS.matter },
        (x) => eq(x.description, a.description) && x.client?.id === a.client_id);
      const r = await ctx.client.post("/matters.json", buildMatterBody(a, ctx.config.defaultAttorneyId), { fields: FIELDS.matter });
      const matter = r.data;
      if (!a.flat_rate_amount) return { created: matter };
      try {
        const p = await ctx.client.patch(`/matters/${matter.id}.json`, buildFlatRatePatch(att!, a.flat_rate_amount), { fields: FIELDS.matter });
        return { created: p.data, flat_fee_applied: true };
      } catch (e) {
        throw new PartialSuccessError(
          `PARTIAL SUCCESS: matter ${matter.id} (${matter.display_number ?? "no number"}) was created as HOURLY, but applying the flat fee failed: ${(e as Error).message}. Fix it manually in Clio or PATCH custom_rate on matter ${matter.id}.`,
        );
      }
    },
  }),
];
