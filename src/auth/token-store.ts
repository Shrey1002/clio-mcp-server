import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** epoch milliseconds */
  expiresAt: number;
}

export interface TokenStore {
  load(): Tokens | undefined;
  save(t: Tokens): void;
  clear(): void;
}

const MAGIC = "clio-mcp:v1:";

function deriveKey(secret: string): Buffer {
  return crypto.scryptSync(secret, "clio-mcp-token-store", 32);
}

export function encryptJson(obj: unknown, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return MAGIC + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptJson(payload: string, secret: string): unknown {
  const raw = Buffer.from(payload.slice(MAGIC.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8"));
}

/** File-backed store: mode 0600, optionally AES-256-GCM encrypted. */
export class FileTokenStore implements TokenStore {
  constructor(private file: string, private encryptionKey?: string) {}

  load(): Tokens | undefined {
    let text: string;
    try {
      text = fs.readFileSync(this.file, "utf8").trim();
    } catch {
      return undefined;
    }
    try {
      let obj: any;
      if (text.startsWith(MAGIC)) {
        if (!this.encryptionKey) throw new Error("token file is encrypted but CLIO_TOKEN_ENCRYPTION_KEY is not set");
        obj = decryptJson(text, this.encryptionKey);
      } else {
        obj = JSON.parse(text);
      }
      if (typeof obj?.accessToken === "string" && typeof obj?.refreshToken === "string" && typeof obj?.expiresAt === "number") {
        return obj as Tokens;
      }
    } catch (e) {
      console.error(`[clio-mcp] could not read token store: ${(e as Error).message}`);
    }
    return undefined;
  }

  save(t: Tokens): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const body = this.encryptionKey ? encryptJson(t, this.encryptionKey) : JSON.stringify(t, null, 2);
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* not supported on some platforms (Windows) */
    }
  }

  clear(): void {
    try {
      fs.unlinkSync(this.file);
    } catch {
      /* already gone */
    }
  }
}

export class MemoryTokenStore implements TokenStore {
  constructor(private tokens?: Tokens) {}
  load() { return this.tokens; }
  save(t: Tokens) { this.tokens = t; }
  clear() { this.tokens = undefined; }
}
