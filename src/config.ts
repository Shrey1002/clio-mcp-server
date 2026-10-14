import { z } from "zod";
import os from "node:os";
import path from "node:path";

export const REGION_HOSTS = {
  us: "app.clio.com",
  ca: "ca.app.clio.com",
  eu: "eu.app.clio.com",
  au: "au.app.clio.com",
} as const;

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? def : ["1", "true", "yes", "on"].includes(v.trim().toLowerCase())));

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const EnvSchema = z.object({
  CLIO_CLIENT_ID: z.string().optional(),
  CLIO_CLIENT_SECRET: z.string().optional(),
  CLIO_REGION: z.preprocess(emptyToUndef, z.enum(["us", "ca", "eu", "au"]).default("us")),
  CLIO_API_VERSION: z.preprocess(emptyToUndef, z.string().regex(/^\d+\.\d+\.\d+$/, "must look like 4.0.13").default("4.0.13")),
  // Path of the redirect URI. Default "/callback". Use "/" (or empty string via "none") if your Clio app registered a bare host:port URI.
  CLIO_REDIRECT_PATH: z.preprocess(emptyToUndef, z.string().regex(/^(\/[A-Za-z0-9._~\-\/]*|none)$/, 'must start with "/" or be "none"').default("/callback")),
  CLIO_REDIRECT_PORT: z.preprocess(emptyToUndef, z.coerce.number().int().min(1024).max(65535).default(5678)),
  CLIO_TOKEN_STORE_PATH: z.preprocess(emptyToUndef, z.string().optional()),
  CLIO_TOKEN_ENCRYPTION_KEY: z.preprocess(emptyToUndef, z.string().min(16, "use at least 16 characters").optional()),
  CLIO_DISABLE_WRITE: bool(true),
  CLIO_DISABLE_UPDATE: bool(true),
  CLIO_DISABLE_DELETE: bool(true),
  CLIO_REQUIRE_CONFIRM: bool(true),
  // How flagged (suspected prompt-injection) text is handled: keep it with warnings, or withhold it.
  CLIO_UNTRUSTED_TEXT_MODE: z.preprocess(emptyToUndef, z.enum(["flag", "redact"]).default("flag")),
  // What happens to create/update/delete once a read returned flagged text: ask the human, refuse, or only warn.
  CLIO_INJECTION_POLICY: z.preprocess(emptyToUndef, z.enum(["approve", "block", "warn"]).default("approve")),
  CLIO_DEFAULT_ATTORNEY_ID: z.preprocess(emptyToUndef, z.coerce.number().int().positive().optional()),
  CLIO_AUDIT_LOG_PATH: z.preprocess(emptyToUndef, z.string().optional()),
});

export interface Config {
  clientId?: string;
  clientSecret?: string;
  region: keyof typeof REGION_HOSTS;
  host: string;
  apiVersion: string;
  apiBase: string;
  oauth: { authorize: string; token: string; deauthorize: string };
  redirectPort: number;
  /** Path the loopback server listens on; "" means the registered URI has no path (http://127.0.0.1:PORT). */
  redirectPath: string;
  redirectUri: string;
  tokenStorePath: string;
  tokenEncryptionKey?: string;
  disableWrite: boolean;
  disableUpdate: boolean;
  disableDelete: boolean;
  requireConfirm: boolean;
  untrustedTextMode: "flag" | "redact";
  injectionPolicy: "approve" | "block" | "warn";
  defaultAttorneyId?: number;
  auditLogPath?: string;
}

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  const host = REGION_HOSTS[e.CLIO_REGION];
  const redirectPath = e.CLIO_REDIRECT_PATH === "none" || e.CLIO_REDIRECT_PATH === "/" ? "" : e.CLIO_REDIRECT_PATH;
  return {
    clientId: e.CLIO_CLIENT_ID,
    clientSecret: e.CLIO_CLIENT_SECRET,
    region: e.CLIO_REGION,
    host,
    apiVersion: e.CLIO_API_VERSION,
    apiBase: `https://${host}/api/v4`,
    oauth: {
      authorize: `https://${host}/oauth/authorize`,
      token: `https://${host}/oauth/token`,
      deauthorize: `https://${host}/oauth/deauthorize`,
    },
    redirectPort: e.CLIO_REDIRECT_PORT,
    redirectPath: redirectPath,
    // Must match the Developer Application setting EXACTLY.
    redirectUri: `http://127.0.0.1:${e.CLIO_REDIRECT_PORT}${redirectPath}`,
    tokenStorePath: e.CLIO_TOKEN_STORE_PATH ?? path.join(os.homedir(), ".clio-mcp", "tokens.json"),
    tokenEncryptionKey: e.CLIO_TOKEN_ENCRYPTION_KEY,
    disableWrite: e.CLIO_DISABLE_WRITE,
    disableUpdate: e.CLIO_DISABLE_UPDATE,
    disableDelete: e.CLIO_DISABLE_DELETE,
    requireConfirm: e.CLIO_REQUIRE_CONFIRM,
    untrustedTextMode: e.CLIO_UNTRUSTED_TEXT_MODE,
    injectionPolicy: e.CLIO_INJECTION_POLICY,
    defaultAttorneyId: e.CLIO_DEFAULT_ATTORNEY_ID,
    auditLogPath: e.CLIO_AUDIT_LOG_PATH,
  };
}

export function requireOAuthCredentials(c: Config): { clientId: string; clientSecret: string } {
  if (!c.clientId || !c.clientSecret) {
    throw new ConfigError("CLIO_CLIENT_ID and CLIO_CLIENT_SECRET are required for authentication.");
  }
  return { clientId: c.clientId, clientSecret: c.clientSecret };
}
