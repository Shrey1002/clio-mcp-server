#!/usr/bin/env node
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { FileTokenStore } from "./auth/token-store.js";
import { ClioClient } from "./clients/clio-client.js";
import { createServer } from "./server.js";

async function main() {
  const config = loadConfig();
  const store = new FileTokenStore(config.tokenStorePath, config.tokenEncryptionKey);
  const client = new ClioClient({ config, store });
  const { server, registered } = createServer({ config, client });
  // stdout is the protocol channel: log to stderr ONLY.
  console.error(`[clio-mcp] region=${config.region} api=${config.apiVersion} tools=${registered.length} (write:${!config.disableWrite} update:${!config.disableUpdate} delete:${!config.disableDelete} confirm:${config.requireConfirm})`);
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(`[clio-mcp] fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
