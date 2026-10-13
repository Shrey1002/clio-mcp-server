import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "../../src/config.js";

describe("config", () => {
  it("defaults to safe read-only with confirmation", () => {
    const c = loadConfig({});
    expect(c.disableWrite && c.disableUpdate && c.disableDelete && c.requireConfirm).toBe(true);
    expect(c.region).toBe("us");
    expect(c.apiBase).toBe("https://app.clio.com/api/v4");
  });
  it("derives region hosts and OAuth URLs", () => {
    const c = loadConfig({ CLIO_REGION: "ca" });
    expect(c.apiBase).toBe("https://ca.app.clio.com/api/v4");
    expect(c.oauth.token).toBe("https://ca.app.clio.com/oauth/token");
    expect(c.oauth.deauthorize).toBe("https://ca.app.clio.com/oauth/deauthorize");
  });
  it("redirect uri is exact loopback with no trailing slash", () => {
    expect(loadConfig({ CLIO_REDIRECT_PORT: "5678" }).redirectUri).toBe("http://127.0.0.1:5678/callback");
  });
  it("supports a bare host:port redirect URI (no path)", () => {
    expect(loadConfig({ CLIO_REDIRECT_PORT: "12345", CLIO_REDIRECT_PATH: "none" }).redirectUri).toBe("http://127.0.0.1:12345");
    expect(loadConfig({ CLIO_REDIRECT_PORT: "12345", CLIO_REDIRECT_PATH: "/" }).redirectUri).toBe("http://127.0.0.1:12345");
    expect(loadConfig({ CLIO_REDIRECT_PATH: "/oauth/cb" }).redirectUri).toBe("http://127.0.0.1:5678/oauth/cb");
    expect(() => loadConfig({ CLIO_REDIRECT_PATH: "callback" })).toThrow(ConfigError);
  });
  it("treats blank env values as unset (.env.example style)", () => {
    const c = loadConfig({ CLIO_REGION: "", CLIO_API_VERSION: "", CLIO_DEFAULT_ATTORNEY_ID: "", CLIO_AUDIT_LOG_PATH: "" });
    expect(c.region).toBe("us"); expect(c.defaultAttorneyId).toBeUndefined();
  });
  it("parses booleans", () => {
    expect(loadConfig({ CLIO_DISABLE_WRITE: "false" }).disableWrite).toBe(false);
    expect(loadConfig({ CLIO_DISABLE_WRITE: "TRUE" }).disableWrite).toBe(true);
  });
  it("fails fast with readable errors", () => {
    expect(() => loadConfig({ CLIO_REGION: "mars" })).toThrow(ConfigError);
    expect(() => loadConfig({ CLIO_API_VERSION: "latest" })).toThrow(/must look like/);
    expect(() => loadConfig({ CLIO_REDIRECT_PORT: "80" })).toThrow(ConfigError);
  });
});
