# clio-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server for the **Clio Manage v4 API**, so Claude (Desktop, Code, Cowork) can search matters, contacts, time and billing data, and, only if you opt in, create, update and delete records.

Built to the implementation plan in `clio-mcp-action-plan.md`: read-only first, writes behind kill switches and a preview-then-confirm gate, trust accounting strictly read-only, and every known Clio API quirk handled in one place (see `docs/CLIO_QUIRKS.md`).

## Safety model (read this first)

| Control | Default | Effect |
|---|---|---|
| `CLIO_DISABLE_WRITE` | `true` | `clio_create_*` tools are **not even listed** |
| `CLIO_DISABLE_UPDATE` | `true` | `clio_update_*` / `clio_set_*` tools are not listed |
| `CLIO_DISABLE_DELETE` | `true` | `clio_delete_*` tools are not listed |
| `CLIO_REQUIRE_CONFIRM` | `true` | Every non-read tool first returns a **PREVIEW** and a 5-minute HMAC token bound to the tool and exact arguments; nothing is written until the same call is repeated with `confirm=<token>` |
| `CLIO_AUDIT_LOG_PATH` | unset | JSONL line per write attempt (secrets redacted) |

Other guarantees: duplicate protection (refuses an identical record created in the last 10 minutes, since Clio has no idempotency key), optimistic concurrency on updates (ETag + `IF-MATCH`), no generic "call any URL" tool, pagination tokens can only point at the Clio API, trust/bank/payment tools are read-only, tokens stored `0600` (optionally AES-256-GCM encrypted).

> **Develop against a dedicated Clio test account, not live firm data.** Prefix test records `MCP-TEST`.

## Quick start (about 15 minutes)

1. **Register a Clio developer application** (see `docs/OAUTH_SETUP.md`). Redirect URI must be exactly `http://127.0.0.1:5678/callback`. Start with read-only scopes.
2. ```bash
   git clone <this repo> && cd clio-mcp-server
   npm install
   cp .env.example .env        # fill CLIO_CLIENT_ID, CLIO_CLIENT_SECRET, CLIO_REGION
   npm run build
   npm run auth                # browser opens; approve; tokens saved
   npm run inspect             # call clio_get_current_user
   ```
3. **Add to Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS), using an **absolute path**:
   ```json
   { "mcpServers": { "clio": {
     "command": "node",
     "args": ["C:/ABSOLUTE/PATH/clio-mcp-server/dist/index.js"],
     "env": {
       "CLIO_REGION": "ca",
       "CLIO_API_VERSION": "4.0.13",
       "CLIO_CLIENT_ID": "...",
       "CLIO_CLIENT_SECRET": "..."
     } } } }
   ```
   Fully quit and relaunch Claude Desktop. Tokens come from the token store created by `npm run auth`, never from this file. Writes stay off until you add `"CLIO_DISABLE_WRITE": "false"` etc. (and re-authorize after adding scopes in Clio).

Region matters: a token from one Clio region is rejected (401) by the others. Canadian firms use `CLIO_REGION=ca`.

## Tools

| Tool | Kind | Title |
|---|---|---|
| `clio_get_current_user` | READ | Current Clio user |
| `clio_search_matters` | READ | Search matters |
| `clio_get_matter` | READ | Get matter |
| `clio_search_contacts` | READ | Search contacts |
| `clio_get_contact` | READ | Get contact |
| `clio_search_activities` | READ | Search time & expense entries |
| `clio_search_users` | READ | Search users |
| `clio_search_practice_areas` | READ | Search practice areas |
| `clio_search_activity_descriptions` | READ | Search activity descriptions |
| `clio_search_tasks` | READ | Search tasks |
| `clio_search_calendar_entries` | READ | Search calendar entries |
| `clio_search_bills` | READ | Search bills |
| `clio_get_bill` | READ | Get bill |
| `clio_search_notes` | READ | Search notes |
| `clio_search_documents` | READ | Search documents |
| `clio_get_document` | READ | Get document metadata |
| `clio_search_custom_fields` | READ | Search custom fields |
| `clio_get_outstanding_balances` | READ | Outstanding client balances |
| `clio_search_trust_line_items` | READ | Search trust line items |
| `clio_search_bank_accounts` | READ | Search bank accounts |
| `clio_search_bank_transactions` | READ | Search bank transactions |
| `clio_search_allocations` | READ | Search payment allocations |
| `clio_create_time_entry` | WRITE | Create time entry |
| `clio_create_expense_entry` | WRITE | Create expense entry |
| `clio_create_note` | WRITE | Create note |
| `clio_create_task` | WRITE | Create task |
| `clio_create_calendar_entry` | WRITE | Create calendar entry |
| `clio_create_person_contact` | WRITE | Create person contact |
| `clio_create_company_contact` | WRITE | Create company contact |
| `clio_create_matter` | WRITE | Create matter |
| `clio_update_matter` | UPDATE | Update matter |
| `clio_update_contact` | UPDATE | Update contact |
| `clio_update_task` | UPDATE | Update task |
| `clio_update_time_entry` | UPDATE | Update time entry |
| `clio_set_custom_field_value` | UPDATE | Set custom field value |
| `clio_delete_time_entry` | DELETE | Delete time entry |
| `clio_delete_task` | DELETE | Delete task |
| `clio_delete_calendar_entry` | DELETE | Delete calendar entry |
| `clio_delete_note` | DELETE | Delete note |

All list tools return `{ items, has_more, next_page_token, total_returned }`, default `limit=25` (max 200), and are capped near 25,000 characters. Activities expose `quantity` in **seconds** and `quantity_in_hours`.

## Configuration

See `.env.example`. Notable: `CLIO_API_VERSION` is pinned (invalid versions return 410), `CLIO_TOKEN_ENCRYPTION_KEY` encrypts the token file, `CLIO_DEFAULT_ATTORNEY_ID` is the fallback **User ID** for matter creation and flat fees.

## Development

```bash
npm test                 # unit + quirk regression + MCP-level tests (mocked fetch, no network)
npm run typecheck
npm run test:integration # live, read-only checks; needs CLIO_INTEGRATION=1 and a TEST account
npx tsx tests/integration/cleanup.ts [--apply]   # remove MCP-TEST records
```

Troubleshooting: tools missing in Claude Desktop, so fully quit and relaunch and check the absolute path; 401 on everything, so wrong region or revoked token (`npm run auth`); 403, so missing app scope; 422 on a time entry, so LEDES matter needs UTBMS codes; empty results, so check `matter_id` was used (not `matter[id]`).

