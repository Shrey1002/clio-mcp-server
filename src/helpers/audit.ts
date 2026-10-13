import fs from "node:fs";
import path from "node:path";

const SECRET_KEY = /secret|token|password|authorization|api[_-]?key|confirm/i;

export function redact(v: any): any {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) ? "[REDACTED]" : redact(x)]));
  }
  return v;
}

export interface AuditEntry {
  tool: string;
  args: unknown;
  outcome: "success" | "error" | "refused";
  status?: number;
  clioUserId?: number;
  detail?: string;
}

export class AuditLog {
  constructor(private file?: string, private now: () => Date = () => new Date()) {}
  write(e: AuditEntry): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, JSON.stringify({ ts: this.now().toISOString(), ...e, args: redact(e.args) }) + "\n", { mode: 0o600 });
    } catch (err) {
      console.error(`[clio-mcp] audit log write failed: ${(err as Error).message}`);
    }
  }
}
