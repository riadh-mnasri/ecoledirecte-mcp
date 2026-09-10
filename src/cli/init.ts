#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

async function main() {
  console.log("Configuration d'ecoledirecte-mcp\n");

  const cwd = process.cwd();
  const envPath = join(cwd, ".env");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();

  async function ask(question: string): Promise<string> {
    process.stdout.write(question);
    const { value } = await lines.next();
    return (value ?? "").trim();
  }

  if (existsSync(envPath)) {
    const overwrite = await ask(".env existe déjà ici. Écraser ? (o/N) ");
    if (overwrite.toLowerCase() !== "o") {
      console.log("Abandon, .env inchangé.");
      rl.close();
      return;
    }
  }

  const username = await ask("Identifiant EcoleDirecte : ");
  const password = await ask("Mot de passe EcoleDirecte : ");
  rl.close();

  writeFileSync(envPath, `ECOLEDIRECTE_USERNAME=${username}\nECOLEDIRECTE_PASSWORD=${password}\n`);
  console.log(`\n.env écrit dans ${envPath}`);

  console.log(`
Ajoute ceci dans la config Claude Desktop
(macOS : ~/Library/Application Support/Claude/claude_desktop_config.json) :

{
  "mcpServers": {
    "ecoledirecte": {
      "command": "npx",
      "args": ["-y", "ecoledirecte-mcp"],
      "env": {
        "ECOLEDIRECTE_USERNAME": "${username}",
        "ECOLEDIRECTE_PASSWORD": "le mot de passe que tu viens de saisir"
      }
    }
  }
}

Puis redémarre Claude Desktop.
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
