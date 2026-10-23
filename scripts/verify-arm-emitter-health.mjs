import assert from "node:assert/strict";
import * as THREE from "three";
import { ArmEmitterRuntime } from "../src/arm/emitter-runtime.ts";

const definition = { id: "AN-SPY-1-search", name: "AN/SPY-1", emitterType: "search-radar",
  band: "S", nominalPower: 1, detectionSignature: 1, frequencyAgility: .7,
  shutdownDelay: 2, restartDelay: 8 };
const runtime = new ArmEmitterRuntime();
const emitter = runtime.register({ id: "cg57:primary-emitter", platformId: "cg57",
  definition, position: new THREE.Vector3(100, 0, 0) });
const positions = new Map([["cg57", new THREE.Vector3(100, 0, 0)]]);

// A live, healthy transmitter behaves exactly as before.
runtime.setActive(emitter.id, true, 1, "search");
assert.equal(emitter.active, true);
assert.equal(emitter.emissionStrength, 1);
assert.equal(emitter.lastActivatedAt, 1);

// A partially damaged radar still radiates at its own strength, never at the floor.
runtime.setActive(emitter.id, false, 2);
assert.equal(emitter.emissionStrength, 0, "a commanded shutdown must still zero the strength");
assert.equal(emitter.lastDeactivatedAt, 2, "a commanded shutdown must still stamp the down edge");
emitter.health = 0.4;
runtime.setActive(emitter.id, true, 3, "search");
assert.equal(emitter.active, true);
assert.equal(emitter.emissionStrength, 0.4);

// The destroyed case. The air runtime keeps requesting `active` every frame because the
// radiation flag is independent of aliveness (air/runtime.ts:670-675), and writes health
// directly, so this is the only place that can decide whether a dead emitter may light up.
emitter.health = 0;
runtime.setActive(emitter.id, true, 10, "search");
assert.equal(emitter.active, false, "a destroyed transmitter must not report itself as radiating");
assert.equal(emitter.emissionStrength, 0, "a destroyed transmitter must not keep a stale strength");
assert.equal(emitter.lastDeactivatedAt, 10, "the down edge must be stamped when the radar dies");
assert.equal(emitter.lastActivatedAt, 3, "the up edge must not move after the platform is dead");

// Steady state: repeated per-frame requests must be a no-op, not an oscillation. `update()`
// (air/runtime.ts:682) runs after these calls every frame; before the fix each frame re-opened
// the emitter and cleared it again, so lastActivatedAt advanced forever.
runtime.update(11, positions);
const settled = { active: emitter.active, emissionStrength: emitter.emissionStrength,
  lastActivatedAt: emitter.lastActivatedAt, lastDeactivatedAt: emitter.lastDeactivatedAt };
for (let frame = 12; frame <= 24; frame++) {
  runtime.setActive(emitter.id, true, frame, "search");
  runtime.update(frame, positions);
}
assert.deepEqual({ active: emitter.active, emissionStrength: emitter.emissionStrength,
  lastActivatedAt: emitter.lastActivatedAt, lastDeactivatedAt: emitter.lastDeactivatedAt },
  settled, "a dead emitter must not churn across frames");

// Repair path: a restored radar must be able to radiate again, so the health gate cannot
// latch the emitter off forever.
emitter.health = 0.6;
runtime.setActive(emitter.id, true, 30, "search");
assert.equal(emitter.active, true, "a repaired transmitter must be able to radiate again");
assert.equal(emitter.emissionStrength, 0.6);
assert.equal(emitter.lastActivatedAt, 30);

console.log(JSON.stringify({ settled, afterRepair: { active: emitter.active,
  emissionStrength: emitter.emissionStrength, lastActivatedAt: emitter.lastActivatedAt } }));
