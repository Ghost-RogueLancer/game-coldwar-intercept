import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCatalogRecord } from "./catalog-record.mjs";

const folder = mkdtempSync(join(tmpdir(), "cwi-catalog-"));
try {
  const file = join(folder, "catalog.ts");
  writeFileSync(file, `const OTHER = { weapon: { speed: 999 } };
    export const WEAPONS: Record<string, unknown> = {
      'weapon': {
        speed: .032, nested: { lifetime: 1.25e2, negative: -2 },
        bands: ['S', 'X'], enabled: true
      }, unsafe: { value: runCode() }
    };`);
  assert.deepEqual(readCatalogRecord(file, "WEAPONS", "weapon"), {
    speed: .032, nested: { lifetime: 125, negative: -2 }, bands: ["S", "X"], enabled: true,
  });
  assert.throws(() => readCatalogRecord(file, "WEAPONS", "missing"), /Expected literal/);
  assert.throws(() => readCatalogRecord(file, "WEAPONS", "unsafe"), /Expected literal/);
  console.log("Catalog literal reader verification passed");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
