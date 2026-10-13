import { z } from "zod";
import { defineTool, limitField, pageTokenField, idField, type ToolDef } from "./define.js";
import { FIELDS } from "../helpers/fields.js";

/**
 * Trust accounting / payments are READ-ONLY by design (professional-responsibility risk).
 * Do not add create/update/void tools here without a separate CLIO_ENABLE_TRUST_WRITES flag + mandatory confirmation.
 */
const money = (name: string, title: string, description: string, path: string, fields: string, filters: z.ZodRawShape, toQuery: (a: any) => any): ToolDef<any> =>
  defineTool({
    name, title, category: "READ",
    description: `${description} READ-ONLY: this server never moves trust or payment money. Missing rows may be hidden by the Clio user's visibility permissions.`,
    schema: { ...filters, limit: limitField, page_token: pageTokenField },
    run: async (a: any, ctx) => ctx.client.list(path, { query: { fields, ...toQuery(a) }, limit: a.limit, pageToken: a.page_token }),
  });

export const moneyTools: ToolDef<any>[] = [
  money("clio_search_trust_line_items", "Search trust line items", "List trust line items.", "/trust_line_items.json", FIELDS.trust_line_item,
    { matter_id: idField("Matter ID").optional(), client_id: idField("Client ID").optional() }, (a) => ({ matter_id: a.matter_id, client_id: a.client_id })),
  money("clio_search_bank_accounts", "Search bank accounts", "List firm bank / trust accounts.", "/bank_accounts.json", FIELDS.bank_account,
    { query: z.string().optional() }, (a) => ({ query: a.query })),
  money("clio_search_bank_transactions", "Search bank transactions", "List bank transactions.", "/bank_transactions.json", FIELDS.bank_transaction,
    { bank_account_id: idField("Bank account ID").optional() }, (a) => ({ bank_account_id: a.bank_account_id })),
  money("clio_search_allocations", "Search payment allocations", "List allocations of payments to bills.", "/allocations.json", FIELDS.allocation,
    { matter_id: idField("Matter ID").optional(), bill_id: idField("Bill ID").optional() }, (a) => ({ matter_id: a.matter_id, bill_id: a.bill_id })),
];
