import "dotenv/config";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EcoleDirecteHttpClient } from "./infrastructure/ecoledirecte-client.js";
import { FileCache } from "./infrastructure/file-cache.js";
import { createServer } from "./mcp/server.js";

const username = process.env.ECOLEDIRECTE_USERNAME;
const password = process.env.ECOLEDIRECTE_PASSWORD;

if (!username || !password) {
  console.error("ECOLEDIRECTE_USERNAME et ECOLEDIRECTE_PASSWORD doivent être définis (voir .env.example).");
  process.exit(1);
}

const client = new EcoleDirecteHttpClient({ username, password });
const cache = new FileCache(join(process.cwd(), ".cache"));
const server = createServer(client, cache);

const transport = new StdioServerTransport();
await server.connect(transport);
