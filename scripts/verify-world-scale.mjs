import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveWorldUnitsPerKm, kilometresFromWorldUnits, worldUnitsFromKilometres, DEFAULT_WORLD_UNITS_PER_KM } from "../dist-test/scenario-system/world-scale.js";

assert.equal(DEFAULT_WORLD_UNITS_PER_KM, 10, "the sandbox default scale stays 10 world units per kilometre");
assert.equal(resolveWorldUnitsPerKm(undefined), 10, "an unresolved scenario still reports distances");
assert.equal(resolveWorldUnitsPerKm(25), 25, "a declared scale is honoured");
for (const invalid of [0, -10, Number.NaN, Number.POSITIVE_INFINITY, Number.MIN_VALUE, Number.MAX_VALUE, 0.0001, 1e7])
  assert.equal(resolveWorldUnitsPerKm(invalid), 10, `non-positive or non-finite scale ${invalid} must fall back`);

assert.equal(kilometresFromWorldUnits(120, 10), 12, "120 units is 12 km on the default grid");
assert.equal(kilometresFromWorldUnits(120, 25), 4.8, "120 units is 4.8 km on a 25-unit grid");
assert.equal(worldUnitsFromKilometres(12, 10), 120, "round trip through the default grid");
for (const scale of [.001, 10, 25, 1e6]) {
  assert.equal(resolveWorldUnitsPerKm(scale), scale);
  assert.equal(kilometresFromWorldUnits(worldUnitsFromKilometres(12, scale), scale), 12);
  assert.ok(Number.isFinite(worldUnitsFromKilometres(200, scale)));
}
assert.equal(kilometresFromWorldUnits(240, 0), 24, "a broken scale falls back instead of dividing by zero");

// Regression guard: both built-in scenarios declare the default scale, so routing
// the readouts through the scenario value cannot change any shipped measurement.
for (const document of [
  "src/scenarios/full-spectrum-blackout/scenario.json",
  "src/scenarios/legacy-adapters/default-surface-defense.ts",
])
  assert.match(readFileSync(document, "utf8"), /worldUnitsPerKm["']?\s*[:=]\s*10/, `${document} must keep the default scale`);

// Drift guard: the scale is resolved in one place, so no module may re-add a constant.
for (const source of ["src/main.ts", "src/visual/tactical-radar.ts"])
  assert.doesNotMatch(
    readFileSync(source, "utf8"),
    /(?<![A-Z_])WORLD_UNITS_PER_KM\s*=\s*\d/,
    `${source} must not hard-code a second world-units-per-kilometre constant`,
  );

console.log(JSON.stringify({ scale: resolveWorldUnitsPerKm(25), defaultScale: DEFAULT_WORLD_UNITS_PER_KM, guardedSources: 2 }));
