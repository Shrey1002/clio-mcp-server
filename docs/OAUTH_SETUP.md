# Clio OAuth setup

1. Sign in to Clio, then **Settings → Developer Applications** (`https://{host}/settings/developer_applications`; `ca.app.clio.com` for Canada) and click **New Application**.
2. **Name** `Clio MCP (dev)`. **Redirect URI** `http://127.0.0.1:5678/callback` (scheme, host, port, path must match exactly; no trailing slash). It is built from `CLIO_REDIRECT_PORT` and `CLIO_REDIRECT_PATH` (default `/callback`; set `none` if your app registered a bare `http://127.0.0.1:PORT`).
3. **Permissions:** read-only on Users, Matters, Contacts, Activities, Tasks, Calendars, Billing, Documents, Custom Fields. Add write scopes only when you enable writes; adding scopes forces re-authorization (`npm run auth`).
4. Copy the **Client Secret immediately** (shown once) into a password manager. Never commit it.
5. Put `CLIO_CLIENT_ID`, `CLIO_CLIENT_SECRET`, `CLIO_REGION` in `.env` (`chmod 600 .env`), then `npm run build && npm run auth`.

## Gotchas
- **Region isolation:** a token minted on one host fails (401) on the others. OAuth and API calls both use `CLIO_REGION`.
- **`400 invalid_grant`:** the code is single-use and lives ~10 minutes, or the redirect URI does not match exactly. Re-run `npm run auth`.
- **Refresh tokens:** Clio documents that Manage refresh tokens do not rotate; field reports say they may. The token manager persists a new refresh token only when one is returned and honors whatever `expires_in` the server sends.
- A Manage refresh token does not expire; treat the token file as a long-lived credential. Revoke via Clio's authorized-apps screen or `npm run auth -- logout`.
- The `state` parameter is verified on the loopback callback.
