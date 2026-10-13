export class ClioApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public type?: string,
    public details?: Record<string, unknown>,
    public method?: string,
    public path?: string,
  ) {
    super(message);
    this.name = "ClioApiError";
  }
}

/** Raised for problems we detect before calling Clio (bad input, dependency, etc.). */
export class UserError extends Error {}

export function explainError(e: unknown): string {
  if (e instanceof UserError) return e.message;
  if (!(e instanceof ClioApiError)) return e instanceof Error ? e.message : String(e);
  const base = `Clio API ${e.status}${e.method ? ` on ${e.method} ${e.path}` : ""}: ${e.message}`;
  const d = e.details && Object.keys(e.details).length ? ` Field errors: ${JSON.stringify(e.details)}` : "";
  switch (e.status) {
    case 401:
      return `${base}. Token expired/revoked or issued for a different region. Run \`npm run auth\` and check CLIO_REGION.`;
    case 403:
      return `${base}. The app is missing a scope for this resource or the Clio user's role forbids it. Add the scope in the Developer Application and re-authorize (\`npm run auth\`).`;
    case 404:
      return `${base}. Not found (wrong ID, already deleted, or hidden by the user's Clio permissions).`;
    case 409:
      return `${base}. Dependency conflict: e.g. a contact with open bills cannot be deleted. Resolve or void the open bills first.`;
    case 410:
      return `${base}. Unsupported CLIO_API_VERSION; pin a real version such as 4.0.13.`;
    case 412:
      return `${base}. The record changed since it was read (ETag mismatch). Re-fetch it and retry.`;
    case 422:
      return `${base}.${d || " Required field missing or invalid value."} (A contact that is the client of an open matter also returns 422 on delete.)`;
    case 429:
      return `${base}. Rate limited by Clio; retry shortly with narrower queries.`;
    default:
      return base + d;
  }
}
