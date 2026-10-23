import assert from "node:assert/strict";
import fs from "node:fs";
import { validateScenarioDocument } from "../dist-test-scenario/scenario-system/validator.js";

const base = JSON.parse(fs.readFileSync(new URL("../src/scenarios/full-spectrum-blackout/scenario.json", import.meta.url), "utf8"));
base.forces.push({ kind:"air-formation", id:"soviet-sead-test", platformId:"MIG-29A-SEAD", side:"red", forceId:"red-air", position:[0,80,-1200], headingDeg:180, count:2, altitude:80, speed:5, mission:"sead", loadout:{"Kh-31P-C":1} });
for (const era of ["early-cold-war", "ocean-navy", "ntu-1980s"]) {
  const candidate = structuredClone(base); candidate.simulation.sovietCommandEra = era;
  assert.equal(validateScenarioDocument(candidate).valid, false, `${era} must reject Soviet SEAD`);
}
const late = structuredClone(base); late.simulation.sovietCommandEra = "late-soviet";
assert.equal(validateScenarioDocument(late).valid, true);
// The era gate above proves Kh-31P-C is *allowed*; this proves it is actually guideable.
// `air/runtime.ts` looks the seeker profile up in `src/arm/catalog.ts` and records an instant
// "miss" when the lookup fails, so an anti-radiation weapon that exists in the air catalogue but
// not in the ARM catalogue fires, flies zero frames and never explains itself.
const airCatalog = fs.readFileSync(new URL("../src/air/catalog.ts", import.meta.url), "utf8");
const armCatalog = fs.readFileSync(new URL("../src/arm/catalog.ts", import.meta.url), "utf8");
// Slice to the object literals first: both files hold several exported records, and parsing the
// whole file would let `ARM_EMITTERS` / platform rows masquerade as weapon profiles.
const weaponsBlock = armCatalog.slice(armCatalog.indexOf("ARM_WEAPONS"), armCatalog.indexOf("export const ARM_EMITTERS"));
const airWeaponsBlock = airCatalog.slice(airCatalog.indexOf("AIR_WEAPONS"), airCatalog.indexOf("const emptyLoadout"));
assert.ok(weaponsBlock.length > 20 && weaponsBlock.length < armCatalog.length, "could not isolate the ARM_WEAPONS block");
assert.ok(airWeaponsBlock.length > 20 && airWeaponsBlock.length < airCatalog.length, "could not isolate the AIR_WEAPONS block");

const number = (line, key) => {
  const m = line.match(new RegExp(`(?:^|[^A-Za-z0-9_])${key}:([0-9.]+)`));
  return m ? Number(m[1]) : undefined;
};
const rowId = /^\s+"([\w-]+)": \{ id:"([\w-]+)"/;
const armRows = new Map();
for (const line of weaponsBlock.split("\n")) {
  const m = line.match(rowId);
  if (!m) continue;
  assert.equal(m[1], m[2], `ARM_WEAPONS key ${m[1]} must match its own id field ${m[2]}`);
  armRows.set(m[1], { seekerRange: number(line, "seekerRange"), seekerFovDeg: number(line, "seekerFovDeg") });
}
assert.ok(armRows.size >= 2, `the ARM catalogue looks truncated (${armRows.size} rows)`);

let antiRadiation = 0;
for (const line of airWeaponsBlock.split("\n")) {
  const m = line.match(rowId);
  if (!m || !line.includes('guidance:"anti-radiation"')) continue;
  antiRadiation++;
  const id = m[1];
  const profile = armRows.get(id);
  assert.ok(profile, `${id} is guidance:"anti-radiation" but has no ARM_WEAPONS profile, so air/runtime.ts terminates it as a miss on the first frame`);
  // AGM-45A and AGM-88A already agree exactly between the two catalogues; the same must hold for
  // anything added later, otherwise one quantity is answered twice.
  assert.equal(profile.seekerRange, number(line, "seekerRange"), `${id} seekerRange differs between the air and ARM catalogues`);
  assert.equal(profile.seekerFovDeg, number(line, "seekerFovDeg"), `${id} seekerFovDeg differs between the air and ARM catalogues`);
}
assert.ok(antiRadiation >= 3, `expected at least the three shipped anti-radiation weapons, found ${antiRadiation}`);
console.log("Soviet SEAD era gating verification passed:", JSON.stringify({ antiRadiation, profiled: armRows.size }));
