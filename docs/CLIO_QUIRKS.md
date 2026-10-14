# Clio API quirks: where each is handled

Findings marked ★ come from live testing documented in `lawyered0/clio-mcp` (MIT). Verify each against your own account; Clio can change behavior (re-run the regression tests quarterly).

| # | Quirk | Handled in | Test |
|---|---|---|---|
| 1 ★ | Token from one region fails (401) in another | `config.ts` single `CLIO_REGION` host for OAuth + API; 401 message names region | `config.test`, `client.test` |
| 2 ★ | `redirect_uri` must match exactly | `config.ts` derives it once from the port | `config.test`, `auth.test` |
| 3 ★ | Auth code single-use ~10 min; `invalid_grant` | `oauth.ts` actionable message | `auth.test` |
| 4 ★ | New scopes require re-authorization | README / OAUTH_SETUP; 403 message | `client.test` |
| 5 ★ | Refresh tokens may or may not rotate; TTL varies | `refreshTokens()` persists a new refresh token only if returned; honors `expires_in` | `auth.test` |
| 6 ★ | Top-level `billing_method` ignored | never sent; flat fee via `custom_rate` PATCH | `write-tools.test` |
| 7 ★ | TimeEntry total = hours × rate, not price | tool descriptions; ExpenseEntry for flat lines | `write-tools.test` |
| 8 ★ | POST takes `description`/`note`; GET fields only `note` | `note` everywhere | `read-tools.test` |
| 9 ★ | `rate` invalid GET field | presets use `price`, `quantity` | `read-tools.test` |
| 10 ★ | `matter`/`matter[id]` ignored on activities | `matter_id` | `read-tools.test` |
| 11 ★ | Bare GET returns only id+etag | `fields` always sent | `read-tools.test` |
| 12 ★ | Address name enum | `normalizeLabel` | `write-tools.test` |
| 13 ★ | Body must be `{"data":…}` | wrapped inside `ClioClient.request` only | `client.test` |
| 14 ★ | Contact `type` Person vs Company | separate tools | `write-tools.test` |
| 15 ★ | Unknown POST fields silently dropped | bodies built explicitly from validated args; tests assert exact key sets | `write-tools.test` |
| 16 ★ | DELETE 204/404/409/422 | `delete.tools.ts`, `errors.ts` | `update-delete.test`, `client.test` |
| 17 ★ | Bill DELETE soft-voids | no bill delete tool exists | n/a |
| 18 ★ | `practice_area_id` is metadata only | stated in tool descriptions | n/a |
| 19 | Activity `quantity` is seconds (≥4.0.4) | `hoursToSeconds`; both units in output | `write-tools.test` |
| 20 | Limit 200; cursor paging needs `order=id(asc)`; offset cap 10,000 | `ClioClient.list` | `client.test` |
| 21 | One nesting level in `fields` | `FIELDS` presets, test enforces | `read-tools.test` |
| 22 | Invalid API version → 410 | `CLIO_API_VERSION` validated + pinned; 410 message | `config.test`, `client.test` |
| 23 | Rate limit per token, `Retry-After` | backoff (cap 120s, 3 retries) + header-aware throttle | `client.test` |
| 24 | No idempotency key | confirm gate + 10-minute duplicate lookup | `write-tools.test` |
| 25 | Visibility settings redact contacts/hours (≥4.0.8/9) | money tool descriptions; 404 message | n/a |

## Verified against Clio's official OpenAPI spec (v4)
After the first live tests, the full OpenAPI document (169 paths, 304 operations) was used to check this server's requests. Result:

- **Filters:** all filters used by activities, bills, calendar entries, notes, documents, tasks, matters and contacts exist, as does `created_since` on every list used for duplicate detection.
- **Corrected after the check:** users and practice areas filter by `name` (not `query`); outstanding balances use `contact_id`; trust line items accept only `matter_id`/`bill_id`; activity descriptions have no text filter, so names are matched locally; the invalid `type` (trust line items) and `status` (allocations) response fields were replaced.
- **Request bodies:** calendar `calendar_owner`, task `assignee`, expense `expense_category`, matter `custom_rate`, and `custom_field_values` all exist in the spec. The API **requires `description` on tasks**, so the server now sends the task name when none is given.
- **Added:** `clio_get_matter_protected_funds` (`/matters/{id}/protected_funds.json`).

Still checked only by running against a live account: the exact enum values the API accepts for some filters (for example activity `status`), and behavior that the spec does not describe (redaction, rate limits).
