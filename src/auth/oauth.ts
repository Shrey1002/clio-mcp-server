import http from "node:http";
import crypto from "node:crypto";
import type { Config } from "../config.js";
import { requireOAuthCredentials } from "../config.js";
import type { Tokens, TokenStore } from "./token-store.js";

type FetchLike = typeof fetch;

export class OAuthError extends Error {}

export function buildAuthorizeUrl(c: Config, state: string): string {
  const { clientId } = requireOAuthCredentials(c);
  const u = new URL(c.oauth.authorize);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", c.redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("redirect_on_decline", "true");
  return u.toString();
}

async function postForm(c: Config, url: string, params: Record<string, string>, f: FetchLike): Promise<any> {
  const res = await f(url, {
    method: "POST",
    // Clio's token endpoint wants form encoding, not JSON.
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!res.ok) {
    const code = json.error ?? res.status;
    const hint =
      json.error === "invalid_grant"
        ? " (authorization code expired/reused, or redirect_uri does not match the Developer Application EXACTLY; re-run `npm run auth`)"
        : "";
    throw new OAuthError(`OAuth request failed: ${code}${json.error_description ? ` - ${json.error_description}` : ""}${hint}`);
  }
  return json;
}

export async function exchangeCode(c: Config, code: string, f: FetchLike = fetch, now = Date.now()): Promise<Tokens> {
  const { clientId, clientSecret } = requireOAuthCredentials(c);
  const j = await postForm(c, c.oauth.token, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: c.redirectUri,
  }, f);
  if (!j.access_token || !j.refresh_token) throw new OAuthError("Token response missing access_token/refresh_token");
  // Honor whatever TTL the server returns (30 days documented; some accounts report ~1 hour).
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: now + Number(j.expires_in ?? 3600) * 1000 };
}

/** Refresh. Persist a NEW refresh_token only if the server sends one; otherwise keep the old one. */
export async function refreshTokens(c: Config, old: Tokens, f: FetchLike = fetch, now = Date.now()): Promise<Tokens> {
  const { clientId, clientSecret } = requireOAuthCredentials(c);
  const j = await postForm(c, c.oauth.token, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: old.refreshToken,
  }, f);
  if (!j.access_token) throw new OAuthError("Refresh response missing access_token");
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? old.refreshToken,
    expiresAt: now + Number(j.expires_in ?? 3600) * 1000,
  };
}

export async function logout(c: Config, store: TokenStore, f: FetchLike = fetch): Promise<void> {
  const t = store.load();
  if (t) {
    try {
      await f(c.oauth.deauthorize, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: t.accessToken }).toString(),
      });
    } catch (e) {
      console.error(`[clio-mcp] deauthorize failed (tokens removed locally anyway): ${(e as Error).message}`);
    }
  }
  store.clear();
}

/** Starts a loopback server, returns the authorization code once the browser redirects back. */
export function waitForCallback(c: Config, state: string, timeoutMs = 10 * 60_000): { ready: Promise<void>; code: Promise<string> } {
  let resolveReady!: () => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<void>((r, j) => { resolveReady = r; rejectReady = j; });
  const code = new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${c.redirectPort}`);
      if (u.pathname !== (c.redirectPath || "/")) { res.writeHead(404).end(); return; }
      const finish = (status: number, msg: string, err?: Error, val?: string) => {
        res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(msg);
        clearTimeout(timer);
        server.close();
        server.closeAllConnections?.(); // don't let keep-alive sockets hold the port
        err ? reject(err) : resolve(val!);
      };
      const err = u.searchParams.get("error");
      if (err) return finish(400, `Authorization failed: ${err}`, new OAuthError(`Authorization failed: ${err}`));
      const got = u.searchParams.get("state") ?? "";
      const a = Buffer.from(got), b = Buffer.from(state);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return finish(400, "State mismatch", new OAuthError("OAuth state mismatch (possible CSRF); aborting."));
      }
      const authCode = u.searchParams.get("code");
      if (!authCode) return finish(400, "Missing code", new OAuthError("Callback had no code"));
      finish(200, "Clio authorization complete. You can close this tab.", undefined, authCode);
    });
    const timer = setTimeout(() => { server.close(); reject(new OAuthError("Timed out waiting for authorization (10 min).")); }, timeoutMs);
    server.on("error", (e) => { clearTimeout(timer); rejectReady(e); reject(e); });
    server.listen(c.redirectPort, "127.0.0.1", () => resolveReady());
  });
  return { ready, code };
}

export async function interactiveLogin(c: Config, store: TokenStore, openBrowser: (url: string) => Promise<unknown>): Promise<Tokens> {
  const state = crypto.randomBytes(24).toString("hex");
  const { ready, code } = waitForCallback(c, state);
  code.catch(() => {}); // surfaced via await below
  await ready;
  const url = buildAuthorizeUrl(c, state);
  console.error(`Opening browser for Clio (${c.host}) authorization...\nIf it does not open, visit:\n${url}\n`);
  await openBrowser(url).catch(() => {});
  const tokens = await exchangeCode(c, await code);
  store.save(tokens);
  return tokens;
}
