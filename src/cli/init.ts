#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { CONFIG_DIR } from "../config-dir.js";

async function main() {
  console.log("Configuration d'ecoledirecte-mcp\n");

  const envPath = join(CONFIG_DIR, ".env");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();

  async function ask(question: string): Promise<string> {
    process.stdout.write(question);
    const { value } = await lines.next();
    return (value ?? "").trim();
  }

  if (existsSync(envPath)) {
    const overwrite = await ask(`${envPath} existe déjà. Écraser ? (o/N) `);
    if (overwrite.toLowerCase() !== "o") {
      console.log("Abandon, configuration inchangée.");
      rl.close();
      return;
    }
  }

  const username = await ask("Identifiant EcoleDirecte : ");
  const password = await ask("Mot de passe EcoleDirecte : ");
  rl.close();

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(envPath, `ECOLEDIRECTE_USERNAME=${username}\nECOLEDIRECTE_PASSWORD=${password}\n`);
  console.log(`\nConfiguration écrite dans ${envPath}`);

  console.log(`
Ajoute ceci dans la config Claude Desktop
(macOS : ~/Library/Application Support/Claude/claude_desktop_config.json) :

{
  "mcpServers": {
    "ecoledirecte": {
      "command": "npx",
      "args": ["-y", "ecoledirecte-mcp"]
    }
  }
}

Ou, pour Claude Code, en ligne de commande :

  claude mcp add ecoledirecte -- npx -y ecoledirecte-mcp

Les identifiants sont lus depuis ${envPath}, pas besoin de les répéter dans la config.
Puis redémarre Claude Desktop (ou relance Claude Code).
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
