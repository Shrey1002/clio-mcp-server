import type { Config } from "../config.js";
import type { Tokens, TokenStore } from "../auth/token-store.js";
import { refreshTokens, OAuthError } from "../auth/oauth.js";
import { ClioApiError, UserError } from "../helpers/errors.js";

export type Query = Record<string, unknown>;

export interface RequestOptions {
  query?: Query;
  /** Raw payload; the client wraps it as {"data": ...} for POST/PATCH/PUT. */
  body?: unknown;
  ifMatch?: string;
  /** Internal: follow an absolute (validated) pagination URL. */
  absoluteUrl?: string;
}

export interface ListResult<T = any> {
  items: T[];
  has_more: boolean;
  next_page_token?: string;
  total_returned: number;
}

export interface ClientDeps {
  config: Config;
  store: TokenStore;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const REFRESH_MARGIN_MS = 5 * 60_000;
const MAX_RETRY_AFTER_S = 120;
const MAX_429_RETRIES = 3;
export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 25;

/** Serialize query params the way Clio expects: arrays as `ids[]=1&ids[]=2`, nested as `rate_for[matter_id]=1`. */
export function serializeQuery(q: Query | undefined): string {
  const parts: string[] = [];
  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      for (const x of v) add(`${k}[]`, x);
    } else if (typeof v === "object") {
      for (const [sk, sv] of Object.entries(v as Query)) add(`${k}[${sk}]`, sv);
    } else {
      parts.push(`${k.replace(/%5B/gi, "[").replace(/%5D/gi, "]")}=${encodeURIComponent(String(v))}`);
    }
  };
  for (const [k, v] of Object.entries(q ?? {})) add(k, v);
  return parts.join("&");
}

export const encodePageToken = (url: string) => Buffer.from(url, "utf8").toString("base64url");

export class ClioClient {
  private tokens?: Tokens;
  private refreshing?: Promise<Tokens>;
  private throttleUntil = 0;
  private f: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;

  constructor(private deps: ClientDeps) {
    this.f = deps.fetchImpl ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
  }

  get config() { return this.deps.config; }

  private decodePageToken(token: string): string {
    let url: string;
    try { url = Buffer.from(token, "base64url").toString("utf8"); } catch { throw new UserError("Invalid page_token."); }
    // Never follow a URL that is not our own API.
    if (!url.startsWith(`${this.config.apiBase}/`)) throw new UserError("Invalid page_token (not a Clio API URL).");
    return url;
  }

  /** Single-flight refresh: concurrent callers share one refresh request. */
  private refresh(): Promise<Tokens> {
    if (!this.refreshing) {
      const current = this.tokens ?? this.deps.store.load();
      if (!current) return Promise.reject(new UserError("Not authenticated. Run `npm run auth` first."));
      this.refreshing = refreshTokens(this.config, current, this.f, this.now())
        .then((t) => { this.tokens = t; this.deps.store.save(t); return t; })
        .catch((e) => {
          if (e instanceof OAuthError) throw new UserError(`${e.message}. Run \`npm run auth\` again.`);
          throw e;
        })
        .finally(() => { this.refreshing = undefined; });
    }
    return this.refreshing;
  }

  private async accessToken(force = false): Promise<string> {
    if (!this.tokens) this.tokens = this.deps.store.load();
    if (!this.tokens) throw new UserError("Not authenticated. Run `npm run auth` first (check CLIO_REGION matches your account).");
    if (force || this.tokens.expiresAt - this.now() < REFRESH_MARGIN_MS) {
      return (await this.refresh()).accessToken;
    }
    return this.tokens.accessToken;
  }

  private noteRateHeaders(res: Response) {
    const remaining = res.headers.get("X-RateLimit-Remaining");
    const reset = res.headers.get("X-RateLimit-Reset");
    if (remaining !== null && reset !== null && Number(remaining) <= 1) {
      const r = Number(reset);
      if (Number.isFinite(r)) {
        const ms = r > 1e9 ? r * 1000 - this.now() : r * 1000; // epoch seconds or relative seconds
        if (ms > 0) this.throttleUntil = this.now() + Math.min(ms, 60_000);
      }
    }
  }

  async request<T = any>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    let url: string;
    if (opts.absoluteUrl) {
      url = opts.absoluteUrl;
    } else {
      const qs = serializeQuery(opts.query);
      url = `${this.config.apiBase}${path.startsWith("/") ? path : `/${path}`}${qs ? `?${qs}` : ""}`;
    }
    const hasBody = opts.body !== undefined && method !== "GET" && method !== "DELETE";
    const payload = hasBody ? JSON.stringify({ data: opts.body }) : undefined; // {"data": ...} wrapper lives HERE only

    let retried401 = false;
    let retries429 = 0;
    for (;;) {
      const wait = this.throttleUntil - this.now();
      if (wait > 0) await this.sleep(wait);
      const token = await this.accessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "X-API-VERSION": this.config.apiVersion,
        Accept: "application/json",
      };
      if (hasBody) headers["Content-Type"] = "application/json";
      if (opts.ifMatch) headers["IF-MATCH"] = opts.ifMatch;

      const res = await this.f(url, { method, headers, body: payload });
      this.noteRateHeaders(res);

      if (res.status === 401 && !retried401) {
        retried401 = true;
        await this.accessToken(true);
        continue;
      }
      if (res.status === 429 && retries429 < MAX_429_RETRIES) {
        retries429++;
        const ra = Number(res.headers.get("Retry-After"));
        const secs = Math.min(Number.isFinite(ra) && ra > 0 ? ra : 2 ** retries429, MAX_RETRY_AFTER_S);
        await this.sleep(secs * 1000);
        continue;
      }
      if (res.status === 204) return undefined as T;

      const text = await res.text();
      let json: any;
      try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
      if (!res.ok) {
        const err = json?.error ?? {};
        throw new ClioApiError(
          res.status,
          err.message ?? (typeof json?.message === "string" ? json.message : res.statusText || "request failed"),
          err.type,
          err.errors,
          method,
          opts.absoluteUrl ? new URL(opts.absoluteUrl).pathname : path,
        );
      }
      return json as T;
    }
  }

  get<T = any>(path: string, query?: Query) { return this.request<T>("GET", path, { query }); }
  post<T = any>(path: string, body: unknown, query?: Query) { return this.request<T>("POST", path, { body, query }); }
  patch<T = any>(path: string, body: unknown, query?: Query, ifMatch?: string) { return this.request<T>("PATCH", path, { body, query, ifMatch }); }
  delete(path: string) { return this.request("DELETE", path); }

  /** Cursor-paginated list. `fields` is mandatory in query (Clio returns only id+etag otherwise). */
  async list<T = any>(path: string, opts: { query?: Query; limit?: number; pageToken?: string } = {}): Promise<ListResult<T>> {
    let json: any;
    if (opts.pageToken) {
      json = await this.request("GET", path, { absoluteUrl: this.decodePageToken(opts.pageToken) });
    } else {
      const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
      json = await this.request("GET", path, { query: { order: "id(asc)", ...opts.query, limit } }); // cursor paging needs order=id(asc)
    }
    const items: T[] = Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : [];
    const next: string | undefined = json?.meta?.paging?.next;
    return {
      items,
      has_more: !!next,
      next_page_token: next ? encodePageToken(next) : undefined,
      total_returned: items.length,
    };
  }

  async getOne<T = any>(path: string, query?: Query): Promise<T> {
    const json = await this.get(path, query);
    return json?.data as T;
  }
}
