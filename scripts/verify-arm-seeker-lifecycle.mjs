import assert from "node:assert/strict";
import * as THREE from "three";
import { ARM_WEAPONS } from "../src/arm/catalog.ts";
import { updateArmSeeker } from "../src/arm/seeker-runtime.ts";
import { readFileSync } from "node:fs";
import { shouldContinueArmFlight } from "../src/air/missile-runtime.ts";
import { readCatalogRecord } from "./catalog-record.mjs";

const base = { id: "cg57:fire-control-emitter", platformId: "cg57", definitionId: "AN-SPG-49-fire-control", position: new THREE.Vector3(80, 0, 0), active: true, mode: "guidance", emissionStrength: 1, lastActivatedAt: 0, lastDeactivatedAt: 0, health: 1, decoy: false, band: "X" };
const step = (state, profile, emitter, time, sample = .1) => updateArmSeeker({ state, profile, missilePosition: new THREE.Vector3(), emitters: [emitter], time, dt: .2, sample });

const shrike = { mode: "emitter-search", targetEmitterId: undefined };
step(shrike, ARM_WEAPONS["AGM-45A"], base, 1);
assert.equal(shrike.mode, "emitter-acquired");
const silent = { ...base, active: false, emissionStrength: 0 };
step(shrike, ARM_WEAPONS["AGM-45A"], silent, 2);
assert.equal(shrike.mode, "memory-track");
step(shrike, ARM_WEAPONS["AGM-45A"], silent, 11);
assert.equal(shrike.mode, "lost");

const harm = { mode: "emitter-search", targetEmitterId: undefined };
step(harm, ARM_WEAPONS["AGM-88A"], base, 1);
assert.equal(harm.mode, "emitter-acquired");
step(harm, ARM_WEAPONS["AGM-88A"], silent, 2);
assert.equal(harm.mode, "memory-track");
step(harm, ARM_WEAPONS["AGM-88A"], silent, 27);
assert.equal(harm.mode, "reacquisition");
step(harm, ARM_WEAPONS["AGM-88A"], base, 28, .1);
assert.equal(harm.mode, "terminal-home");

// The anti-radiation timeout must be the catalogue's ceiling, not a stopwatch in the loop.
const runtimeSource = readFileSync(new URL("../src/air/runtime.ts", import.meta.url), "utf8");
assert.ok(!/missile\.age > 120/.test(runtimeSource),
  "the anti-radiation branch must not decide termination from a hardcoded 120 s stopwatch");
assert.ok(/shouldContinueArmFlight\(/.test(runtimeSource),
  "the anti-radiation branch must consult shouldContinueArmFlight");

const ceilings = [];
for (const id of ["AGM-45A", "AGM-88A", "Kh-31P-C"]) {
  const weapon = readCatalogRecord(new URL("../src/air/catalog.ts", import.meta.url), "AIR_WEAPONS", id);
  const field = key => {
    const value = weapon.airToAirFlight?.[key] ?? weapon[key];
    assert.ok(Number.isFinite(value), `${id}.${key} must be finite`);
    return value;
  };
  const ceiling = field("maximumFlightSeconds");
  ceilings.push(ceiling);
  assert.ok(shouldContinueArmFlight({ age: ceiling, maximumFlightSeconds: ceiling }),
    `${id} must still be flying at exactly its declared ceiling`);
  assert.equal(shouldContinueArmFlight({ age: ceiling + 0.5, maximumFlightSeconds: ceiling }), false,
    `${id} must stop past its declared ceiling`);
  // Necessary nominal-envelope check; actual range also depends on propulsion and guidance.
  assert.ok(ceiling * field("speed") >= field("maxRange"),
    `${id}: lifetime ${ceiling} * speed ${field("speed")} must be >= range ${field("maxRange")}`);
}
// Non-vacuity: if every ceiling equalled the old literal, these assertions would prove nothing.
assert.ok(ceilings.some(c => c !== 120),
  "no declared ceiling differs from the old literal, so this test cannot detect a regression");
// A weapon with no flight profile keeps today's behaviour.
assert.ok(shouldContinueArmFlight({ age: 120 }));
assert.equal(shouldContinueArmFlight({ age: 120.5 }), false);

console.log("ARM seeker lifecycle verification passed:", JSON.stringify({ ceilings, oldLiteral: 120 }));
