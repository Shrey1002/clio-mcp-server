import { explainError } from "./errors.js";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export const CHARACTER_LIMIT = 25_000;

/** Shrinks arrays (largest `items`) until the JSON fits; adds a hint on how to narrow. */
export function truncate(obj: any, limit = CHARACTER_LIMIT): { value: any; truncated: boolean } {
  if (JSON.stringify(obj).length <= limit) return { value: obj, truncated: false };
  if (obj && Array.isArray(obj.items)) {
    let items: any[] = obj.items;
    while (items.length > 1 && JSON.stringify({ ...obj, items }).length > limit - 400) {
      items = items.slice(0, Math.max(1, Math.floor(items.length / 2)));
    }
    return {
      value: {
        ...obj,
        items,
        total_returned: items.length,
        truncated: true,
        truncation_note: `Response exceeded ${limit} characters; showing ${items.length} of ${obj.items.length} items. Narrow the filters or lower \`limit\`; use page_token to continue only when has_more is true and the page was not truncated.`,
      },
      truncated: true,
    };
  }
  const s = JSON.stringify(obj).slice(0, limit - 200);
  return { value: { truncated: true, partial_json: s, truncation_note: "Response truncated; request fewer fields or a narrower query." }, truncated: true };
}

export function ok(data: any): ToolResult {
  const { value } = truncate(data);
  const structured = value !== null && typeof value === "object" && !Array.isArray(value) ? value : { result: value };
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: structured };
}

export function fail(err: unknown): ToolResult {
  return { content: [{ type: "text", text: explainError(err) }], isError: true };
}
