import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { ARM_WEAPONS } from "../src/arm/catalog.ts";
import { updateArmSeeker } from "../src/arm/seeker-runtime.ts";
import { readCatalogRecord } from "./catalog-record.mjs";
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
const airWeapons = readCatalogRecord(new URL("../src/air/catalog.ts", import.meta.url), "AIR_WEAPONS");
const antiRadiation = Object.values(airWeapons).filter(weapon => weapon.guidance === "anti-radiation");
assert.ok(antiRadiation.length >= 3);
for (const weapon of antiRadiation) {
  const profile = ARM_WEAPONS[weapon.id];
  assert.ok(profile, `${weapon.id} has no seeker profile`);
  assert.equal(profile.id, weapon.id);
  assert.equal(profile.seekerRange, weapon.seekerRange);
  assert.equal(profile.seekerFovDeg, weapon.seekerFovDeg);
}
const profile = ARM_WEAPONS["Kh-31P-C"];
const emitter = { id: "radar", position: new THREE.Vector3(60, 0, 0), active: true, health: 1, band: "X" };
const state = { mode: "emitter-search" };
const step = time => updateArmSeeker({ state, profile, missilePosition: new THREE.Vector3(), emitters: [emitter], time, dt: .2, sample: .1 });
step(1);
assert.equal(state.mode, "emitter-acquired");
emitter.active = false;
step(2);
assert.equal(state.mode, "memory-track");
assert.equal(state.memoryExpiresAt, 2 + profile.memoryDuration);
step(2 + profile.memoryDuration);
assert.equal(state.mode, "reacquisition");
emitter.active = true;
step(3 + profile.memoryDuration);
assert.equal(state.mode, "terminal-home");
emitter.active = false;
step(4 + profile.memoryDuration);
step(state.memoryExpiresAt);
step(state.reacquisitionUntil);
assert.equal(state.mode, "lost");
console.log("Soviet SEAD era and catalog seeker lifecycle verification passed");
