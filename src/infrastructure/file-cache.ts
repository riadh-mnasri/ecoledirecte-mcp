import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ResultCache } from "../domain/ports.js";

export class FileCache implements ResultCache {
  constructor(private readonly dir: string) {}

  private pathFor(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  read<T>(key: string): { data: T; savedAt: string } | undefined {
    const path = this.pathFor(key);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return undefined;
    }
  }

  write<T>(key: string, data: T): void {
    const path = this.pathFor(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ data, savedAt: new Date().toISOString() }, null, 2));
  }
}
