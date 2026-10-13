# Architecture

```
MCP client (Claude Desktop / Code / Cowork)
        │ stdio (JSON-RPC; stdout = protocol, logs go to stderr)
        ▼
 src/index.ts → src/server.ts  ── registers tools (hides disabled categories), runs the confirm gate + audit
        │                               ▲
        │ tool defs                     │ ConfirmGate (HMAC), AuditLog (JSONL)
        ▼
 src/tools/*.tool(s).ts  (zod schemas, body builders, duplicate checks)
        │
        ▼
 src/clients/clio-client.ts  ── {"data":…} wrapper, version header, token refresh (single-flight),
        │                        401 retry, 429 backoff, rate-limit throttle, cursor paging
        ▼
 https://{region}.app.clio.com/api/v4
```

- **One place for protocol quirks:** body wrapping, `order=id(asc)`, page-token validation and header handling live only in the client; field presets in `helpers/fields.ts`; unit/label normalization in `helpers/units.ts`.
- **Gating:** tool category derives from the verb in the name (`create`→WRITE, `update`/`set`→UPDATE, `delete`→DELETE, else READ); a startup guard fails if a tool's declared category disagrees.
- **Write pipeline:** `check` (cross-field validation) → gate (preview/confirm) → duplicate lookup → request → audit.
- **Updates:** GET etag → PATCH with `IF-MATCH`; on 412 re-fetch once and retry, then report.
