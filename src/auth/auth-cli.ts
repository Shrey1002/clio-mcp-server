#!/usr/bin/env node
import "dotenv/config";
import { loadConfig } from "../config.js";
import { FileTokenStore } from "./token-store.js";
import { interactiveLogin, logout } from "./oauth.js";

async function main() {
  const cfg = loadConfig();
  const store = new FileTokenStore(cfg.tokenStorePath, cfg.tokenEncryptionKey);
  if (process.argv[2] === "logout") {
    await logout(cfg, store);
    console.error("Logged out; local tokens removed.");
    return;
  }
  const { default: open } = await import("open");
  await interactiveLogin(cfg, store, (u) => open(u));
  console.error(`Success. Tokens saved to ${cfg.tokenStorePath}${cfg.tokenEncryptionKey ? " (encrypted)" : " (mode 0600)"}.`);
}

main().catch((e) => {
  console.error(`Auth failed: ${e.message}`);
  process.exit(1);
});
