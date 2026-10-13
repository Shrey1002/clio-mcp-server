import { loadConfig, type Config } from "../../src/config.js";
import { MemoryTokenStore } from "../../src/auth/token-store.js";
import { ClioClient } from "../../src/clients/clio-client.js";

export interface Call { method: string; url: string; path: string; query: URLSearchParams; headers: Record<string, string>; body?: any }
export type Handler = (c: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ CLIO_CLIENT_ID: "id", CLIO_CLIENT_SECRET: "secret", CLIO_REGION: "ca", CLIO_REQUIRE_CONFIRM: "false", CLIO_DISABLE_WRITE: "false", CLIO_DISABLE_UPDATE: "false", CLIO_DISABLE_DELETE: "false", ...env });
}

/** Mock fetch: records calls; `routes` are tried in order, first non-undefined result wins. */
export function mockFetch(routes: Handler[]) {
  const calls: Call[] = [];
  const impl = (async (input: any, init: any = {}) => {
    const u = new URL(String(input));
    const call: Call = {
      method: init.method ?? "GET", url: String(input), path: u.pathname.replace(/^\/api\/v4/, ""), query: u.searchParams,
      headers: init.headers ?? {}, body: init.body ? (String(init.headers?.["Content-Type"] ?? "").includes("json") ? JSON.parse(init.body) : init.body) : undefined,
    };
    calls.push(call);
    for (const r of routes) {
      const out = r(call);
      if (out) {
        const status = out.status ?? 200;
        const text = status === 204 ? "" : JSON.stringify(out.body ?? {});
        return new Response(status === 204 ? null : text, { status, headers: { "Content-Type": "application/json", ...(out.headers ?? {}) } });
      }
    }
    return new Response(JSON.stringify({ error: { message: `no mock for ${call.method} ${call.path}` } }), { status: 500 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

export function makeClient(routes: Handler[], opts: { config?: Config; expiresInMs?: number; clock?: { t: number } } = {}) {
  const clock = opts.clock ?? { t: 1_800_000_000_000 };
  const config = opts.config ?? testConfig();
  const store = new MemoryTokenStore({ accessToken: "AT1", refreshToken: "RT1", expiresAt: clock.t + (opts.expiresInMs ?? 3_600_000) });
  const { impl, calls } = mockFetch(routes);
  const sleeps: number[] = [];
  const client = new ClioClient({ config, store, fetchImpl: impl, now: () => clock.t, sleep: async (ms) => { sleeps.push(ms); } });
  return { client, calls, store, sleeps, clock, config };
}

export const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({ body: { data, ...extra } });
