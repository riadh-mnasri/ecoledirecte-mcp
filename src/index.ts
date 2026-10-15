#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EcoleDirecteHttpClient } from "./infrastructure/ecoledirecte-client.js";
import { FileCache } from "./infrastructure/file-cache.js";
import { createServer } from "./mcp/server.js";
import { CONFIG_DIR } from "./config-dir.js";

loadDotenv({ path: join(CONFIG_DIR, ".env"), quiet: true });

const username = process.env.ECOLEDIRECTE_USERNAME;
const password = process.env.ECOLEDIRECTE_PASSWORD;

if (!username || !password) {
  console.error(
    `ECOLEDIRECTE_USERNAME et ECOLEDIRECTE_PASSWORD doivent être définis. ` +
      `Lance "npx ecoledirecte-mcp-init" pour les configurer (écrit dans ${join(CONFIG_DIR, ".env")}).`,
  );
  process.exit(1);
}

const client = new EcoleDirecteHttpClient({ username, password });
// Un dossier de cache par compte : plusieurs instances du serveur (un compte par établissement)
// ne doivent jamais se renvoyer les données en cache l'une de l'autre.
const cacheDir = process.env.ECOLEDIRECTE_CACHE_DIR ?? join(CONFIG_DIR, "cache", username.replace(/[^\w.-]/g, "_"));
const cache = new FileCache(cacheDir);
const server = createServer(client, cache);

const transport = new StdioServerTransport();
await server.connect(transport);
