import { defineTool, idField, type ToolDef } from "./define.js";
import { ClioApiError } from "../helpers/errors.js";

/** Deletes: no `fields` param (unsupported on DELETE). 204 ok; 404 already gone. */
const del = (name: string, title: string, resource: string, label: string): ToolDef<any> =>
  defineTool({
    name, title, category: "DELETE",
    description: `PERMANENTLY delete a ${label} by ID. Requires CLIO_DISABLE_DELETE=false and a confirmation token.`,
    schema: { id: idField(`${label} ID`) },
    preview: (a) => ({ will_send: { method: "DELETE", path: `/${resource}/${a.id}.json` }, warning: `This permanently removes the ${label}.` }),
    run: async (a, ctx) => {
      try {
        await ctx.client.delete(`/${resource}/${a.id}.json`);
        return { deleted: true, id: a.id };
      } catch (e) {
        if (e instanceof ClioApiError && e.status === 404) return { deleted: false, id: a.id, note: `${label} ${a.id} was not found (already deleted, wrong ID, or hidden by permissions).` };
        throw e;
      }
    },
  });

export const deleteTools: ToolDef<any>[] = [
  del("clio_delete_time_entry", "Delete time entry", "activities", "time entry"),
  del("clio_delete_task", "Delete task", "tasks", "task"),
  del("clio_delete_calendar_entry", "Delete calendar entry", "calendar_entries", "calendar entry"),
  del("clio_delete_note", "Delete note", "notes", "note"),
];
