import crypto from "node:crypto";

/** Stable JSON: sorted keys, so identical args always hash identically. */
export function stableStringify(v: any): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export const CONFIRM_TTL_MS = 5 * 60_000;

/** HMAC(tool + normalized args + expiry) with a per-process secret. */
export class ConfirmGate {
  constructor(private secret = crypto.randomBytes(32), private now: () => number = Date.now) {}

  private sign(tool: string, args: unknown, exp: number): string {
    return crypto.createHmac("sha256", this.secret).update(`${tool}\n${stableStringify(args)}\n${exp}`).digest("hex");
  }

  issue(tool: string, args: unknown): string {
    const exp = this.now() + CONFIRM_TTL_MS;
    return `${exp}.${this.sign(tool, args, exp)}`;
  }

  verify(tool: string, args: unknown, token: string | undefined): boolean {
    if (!token) return false;
    const [expS, mac] = token.split(".");
    const exp = Number(expS);
    if (!Number.isFinite(exp) || !mac || exp < this.now()) return false;
    const want = Buffer.from(this.sign(tool, args, exp));
    const got = Buffer.from(mac);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }
}
