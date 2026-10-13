import { z } from "zod";
import { defineTool, limitField, pageTokenField, idField, isoDate, isoDateTime, type ToolDef, type Ctx } from "./define.js";
import { FIELDS } from "../helpers/fields.js";
import type { Query } from "../clients/clio-client.js";

type Opts = {
  name: string; title: string; description: string; path: string; fields: string;
  filters: z.ZodRawShape; toQuery: (a: any) => Query;
  post?: (r: any, a: any, ctx: Ctx) => any;
  postFilter?: (items: any[], a: any, ctx: Ctx) => any[];
};

/** Generic cursor-paginated list tool. `fields` is ALWAYS sent. */
function listTool(o: Opts): ToolDef<any> {
  return defineTool({
    name: o.name, title: o.title, category: "READ", description: o.description,
    schema: { ...o.filters, limit: limitField, page_token: pageTokenField },
    run: async (a: any, ctx) => {
      const r = await ctx.client.list(o.path, { query: { fields: o.fields, ...o.toQuery(a) }, limit: a.limit, pageToken: a.page_token });
      if (o.postFilter) { r.items = o.postFilter(r.items, a, ctx); r.total_returned = r.items.length; }
      return o.post ? o.post(r, a, ctx) : r;
    },
  });
}

const getTool = (name: string, title: string, description: string, path: (id: number) => string, fields: string, idDesc: string): ToolDef<any> =>
  defineTool({
    name, title, category: "READ", description,
    schema: { id: idField(idDesc) },
    run: async (a: any, ctx) => ({ item: await ctx.client.getOne(path(a.id), { fields }) }),
  });

export const readTools: ToolDef<any>[] = [
  defineTool({
    name: "clio_get_current_user", title: "Current Clio user", category: "READ",
    description: "Return the authenticated Clio user (GET /users/who_am_i). Use to verify authentication and region.",
    schema: {},
    run: async (_a, ctx) => ({ item: await ctx.client.getOne("/users/who_am_i.json", { fields: FIELDS.user }) }),
  }),

  listTool({
    name: "clio_search_matters", title: "Search matters",
    description: "Search matters. Filter by free text, status, client, practice area, responsible attorney, or last update. Returns display number, status, client, practice area and attorney.",
    path: "/matters.json", fields: FIELDS.matter,
    filters: {
      query: z.string().optional().describe("Free-text search (matter number, description, client name)."),
      status: z.enum(["open", "pending", "closed"]).optional().describe("Matter status."),
      client_id: idField("Contact ID of the client").optional(),
      practice_area_id: idField("Practice area ID").optional(),
      responsible_attorney_id: idField("User ID (NOT a contact ID) of the responsible attorney").optional(),
      updated_since: isoDateTime.optional().describe("Only matters updated at/after this ISO-8601 timestamp."),
    },
    toQuery: (a) => ({ query: a.query, status: a.status, client_id: a.client_id, practice_area_id: a.practice_area_id, responsible_attorney_id: a.responsible_attorney_id, updated_since: a.updated_since }),
  }),

  defineTool({
    name: "clio_get_matter", title: "Get matter", category: "READ",
    description: "Get one matter by ID. Set include_custom_fields=true to include custom field values.",
    schema: { id: idField("Matter ID"), include_custom_fields: z.boolean().default(false).describe("Also return custom_field_values.") },
    run: async (a, ctx) => ({
      item: await ctx.client.getOne(`/matters/${a.id}.json`, { fields: a.include_custom_fields ? `${FIELDS.matter},${FIELDS.custom_field_values}` : FIELDS.matter }),
    }),
  }),

  listTool({
    name: "clio_search_contacts", title: "Search contacts",
    description: "Search contacts (people and companies) by name, email or phone text. Optionally restrict to Person or Company.",
    path: "/contacts.json", fields: FIELDS.contact,
    filters: {
      query: z.string().optional().describe("Free-text search (name, email, phone)."),
      type: z.enum(["Person", "Company"]).optional().describe("Contact type."),
    },
    toQuery: (a) => ({ query: a.query, type: a.type }),
  }),
  getTool("clio_get_contact", "Get contact", "Get one contact by ID.", (id) => `/contacts/${id}.json`, FIELDS.contact, "Contact ID"),

  listTool({
    name: "clio_search_activities", title: "Search time & expense entries",
    description:
      "Search activities (time entries and expense entries). IMPORTANT units: `quantity` is in SECONDS (API >= 4.0.4); `quantity_in_hours` is hours. A time entry total = quantity_in_hours x rate. `page_total_hours` sums time entries on the returned page only (check has_more). Filter a matter with matter_id.",
    path: "/activities.json", fields: FIELDS.activity,
    filters: {
      matter_id: idField("Matter ID. (The `matter` / `matter[id]` filters are silently ignored by Clio and return account-wide data.)").optional(),
      user_id: idField("User ID who logged the activity").optional(),
      start_date: isoDate.optional().describe("Earliest activity date (YYYY-MM-DD)."),
      end_date: isoDate.optional().describe("Latest activity date (YYYY-MM-DD)."),
      type: z.enum(["TimeEntry", "ExpenseEntry"]).optional(),
      status: z.enum(["billed", "unbilled", "non_billable", "draft"]).optional().describe("Billing status filter."),
    },
    toQuery: (a) => ({ matter_id: a.matter_id, user_id: a.user_id, start_date: a.start_date, end_date: a.end_date, type: a.type, status: a.status }),
    post: (r) => ({
      ...r,
      page_total_hours: Math.round(r.items.filter((i: any) => i.type === "TimeEntry").reduce((s: number, i: any) => s + (Number(i.quantity_in_hours) || 0), 0) * 10000) / 10000,
    }),
  }),

  listTool({
    name: "clio_search_users", title: "Search users",
    description: "List Clio users (firm staff). Use to look up User IDs before creating matters, tasks or filtering activities.",
    path: "/users.json", fields: FIELDS.user,
    filters: { query: z.string().optional().describe("Name or email text."), enabled_only: z.boolean().optional().describe("Only enabled users.") },
    toQuery: (a) => ({ query: a.query, enabled: a.enabled_only }),
  }),
  listTool({
    name: "clio_search_practice_areas", title: "Search practice areas", description: "List practice areas. (practice_area is metadata only and does not change billing.)",
    path: "/practice_areas.json", fields: FIELDS.practice_area,
    filters: { query: z.string().optional().describe("Name text.") }, toQuery: (a) => ({ query: a.query }),
  }),
  listTool({
    name: "clio_search_activity_descriptions", title: "Search activity descriptions", description: "List activity descriptions (standard time-entry narratives/rates). Optionally resolve the rate for a matter.",
    path: "/activity_descriptions.json", fields: FIELDS.activity_description,
    filters: { query: z.string().optional(), rate_for_matter_id: idField("Resolve rates for this matter").optional() },
    toQuery: (a) => ({ query: a.query, rate_for: a.rate_for_matter_id ? { matter_id: a.rate_for_matter_id } : undefined }),
  }),

  listTool({
    name: "clio_search_tasks", title: "Search tasks",
    description: "Search tasks. Use overdue_only=true for tasks whose due date has passed and are not complete (filtered locally on due_at, so check has_more for further pages).",
    path: "/tasks.json", fields: FIELDS.task,
    filters: {
      status: z.enum(["pending", "in_progress", "in_review", "complete"]).optional(),
      matter_id: idField("Matter ID").optional(),
      assignee_id: idField("User ID of assignee").optional(),
      priority: z.enum(["High", "Normal", "Low"]).optional(),
      overdue_only: z.boolean().default(false).describe("Only tasks past due and not complete."),
    },
    toQuery: (a) => ({ status: a.status, matter_id: a.matter_id, assignee_id: a.assignee_id, priority: a.priority }),
    postFilter: (items, a, ctx) => a.overdue_only ? items.filter((t) => t.due_at && t.status !== "complete" && Date.parse(t.due_at.length === 10 ? `${t.due_at}T23:59:59` : t.due_at) < ctx.now()) : items,
  }),

  listTool({
    name: "clio_search_calendar_entries", title: "Search calendar entries", description: "Search calendar entries within a date window.",
    path: "/calendar_entries.json", fields: FIELDS.calendar_entry,
    filters: { from: isoDate.optional().describe("Start of window (YYYY-MM-DD)."), to: isoDate.optional().describe("End of window (YYYY-MM-DD).") },
    toQuery: (a) => ({ from: a.from, to: a.to }),
  }),

  listTool({
    name: "clio_search_bills", title: "Search bills", description: "Search bills/invoices. Clio exposes no bill-create endpoint; this is read-only.",
    path: "/bills.json", fields: FIELDS.bill,
    filters: {
      state: z.enum(["draft", "awaiting_approval", "awaiting_payment", "paid", "void", "deleted"]).optional(),
      matter_id: idField("Matter ID").optional(), client_id: idField("Client contact ID").optional(),
      issued_after: isoDate.optional(), issued_before: isoDate.optional(),
    },
    toQuery: (a) => ({ state: a.state, matter_id: a.matter_id, client_id: a.client_id, issued_after: a.issued_after, issued_before: a.issued_before }),
  }),
  getTool("clio_get_bill", "Get bill", "Get one bill by ID.", (id) => `/bills/${id}.json`, FIELDS.bill, "Bill ID"),

  listTool({
    name: "clio_search_notes", title: "Search notes", description: "Search notes of a given type (Matter or Contact; Clio requires the type).",
    path: "/notes.json", fields: FIELDS.note,
    filters: { type: z.enum(["Matter", "Contact"]).describe("Which kind of note to list."), matter_id: idField("Matter ID").optional(), contact_id: idField("Contact ID").optional() },
    toQuery: (a) => ({ type: a.type, matter_id: a.matter_id, contact_id: a.contact_id }),
  }),

  listTool({
    name: "clio_search_documents", title: "Search documents",
    description: "Search document METADATA (never binary content). Each item includes `download_endpoint`; the file itself must be fetched separately with authorization.",
    path: "/documents.json", fields: FIELDS.document,
    filters: { query: z.string().optional().describe("Name text."), matter_id: idField("Matter ID").optional() },
    toQuery: (a) => ({ query: a.query, matter_id: a.matter_id }),
    post: (r, _a, ctx) => ({ ...r, items: r.items.map((d: any) => ({ ...d, download_endpoint: `${ctx.config.apiBase}/documents/${d.id}/download` })) }),
  }),
  defineTool({
    name: "clio_get_document", title: "Get document metadata", category: "READ",
    description: "Get one document's metadata by ID (no file content).",
    schema: { id: idField("Document ID") },
    run: async (a, ctx) => {
      const d = await ctx.client.getOne(`/documents/${a.id}.json`, { fields: FIELDS.document });
      return { item: { ...d, download_endpoint: `${ctx.config.apiBase}/documents/${a.id}/download` } };
    },
  }),

  listTool({
    name: "clio_search_custom_fields", title: "Search custom fields", description: "List custom field definitions (use IDs with clio_set_custom_field_value).",
    path: "/custom_fields.json", fields: FIELDS.custom_field,
    filters: { parent_type: z.enum(["matter", "contact"]).optional().describe("Which record type the field belongs to.") },
    toQuery: (a) => ({ parent_type: a.parent_type }),
  }),

  listTool({
    name: "clio_get_outstanding_balances", title: "Outstanding client balances", description: "Outstanding balances by client (GET /outstanding_client_balances.json).",
    path: "/outstanding_client_balances.json", fields: FIELDS.outstanding_balance,
    filters: { client_id: idField("Client contact ID").optional() }, toQuery: (a) => ({ client_id: a.client_id }),
  }),
];
