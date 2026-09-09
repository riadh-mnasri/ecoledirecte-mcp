import { describe, expect, it } from "vitest";
import { FileCache } from "../src/infrastructure/file-cache.js";
import { resilientFetch } from "../src/mcp/resilient-fetch.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("resilientFetch", () => {
  it("retourne les données live et les met en cache quand tout va bien", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ed-cache-"));
    const cache = new FileCache(dir);

    const result = await resilientFetch(cache, "test", async () => ({ ok: true }));

    expect(result).toEqual({ data: { ok: true }, stale: false });
    expect(cache.read("test")?.data).toEqual({ ok: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("retombe sur le cache et signale l'erreur quand le live échoue", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ed-cache-"));
    const cache = new FileCache(dir);
    cache.write("test", { ok: true });

    const result = await resilientFetch(cache, "test", async () => {
      throw new Error("l'API a changé de format");
    });

    expect(result.stale).toBe(true);
    expect(result.data).toEqual({ ok: true });
    expect(result.liveError).toContain("l'API a changé de format");
    rmSync(dir, { recursive: true, force: true });
  });

  it("propage l'erreur quand le live échoue et qu'aucun cache n'existe", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ed-cache-"));
    const cache = new FileCache(dir);

    await expect(
      resilientFetch(cache, "test", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    rmSync(dir, { recursive: true, force: true });
  });
});
