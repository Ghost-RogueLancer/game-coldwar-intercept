import assert from "node:assert/strict";
import * as THREE from "three";
import { ARM_WEAPONS } from "../src/arm/catalog.ts";
import { updateArmSeeker } from "../src/arm/seeker-runtime.ts";
import { ArmEmitterRuntime } from "../src/arm/emitter-runtime.ts";
import { armReleaseAuthorization } from "../src/arm/mission-integration.ts";
const emitter={id:"spg",platformId:"cg57",definitionId:"AN-SPG-49-fire-control",position:new THREE.Vector3(80,0,0),active:true,mode:"guidance",emissionStrength:1,lastActivatedAt:0,lastDeactivatedAt:0,health:1,decoy:false,band:"X"};
const runtime=new ArmEmitterRuntime(); const persistent=runtime.register({id:"cg57:spg",platformId:"cg57",definition:{id:"AN-SPG-49-fire-control",name:"SPG",emitterType:"fire-control-radar",band:"X",nominalPower:1,detectionSignature:1,frequencyAgility:.2,shutdownDelay:1,restartDelay:2},position:new THREE.Vector3(80,0,0)}); runtime.setActive(persistent.id,true,1,"guidance"); assert.equal(persistent.active,true); runtime.setActive(persistent.id,false,2); assert.equal(persistent.emissionStrength,0);
const state={mode:"emitter-search"};
updateArmSeeker({state,profile:ARM_WEAPONS["AGM-45A"],missilePosition:new THREE.Vector3(),emitters:[emitter],time:1,dt:.2,sample:0});
assert.equal(state.mode,"emitter-acquired");
emitter.active=false; updateArmSeeker({state,profile:ARM_WEAPONS["AGM-45A"],missilePosition:new THREE.Vector3(),emitters:[emitter],time:2,dt:.2});
assert.equal(state.mode,"memory-track");
const harm={mode:"emitter-search"}; updateArmSeeker({state:harm,profile:ARM_WEAPONS["AGM-88A"],missilePosition:new THREE.Vector3(),emitters:[{...emitter,active:true}],time:1,dt:.2,sample:0});
assert.equal(harm.mode,"emitter-acquired");
import { readFileSync } from "node:fs";

// A scenario reset must drop every piece of registry state, and the ARM emitter registry was the
// one that survived: `air/runtime.ts` re-registers an emitter only when its id is absent, so
// without a clear() the previous mission's instance is reused as-is.
const sharedDefinition = { id: "AN-SPG-49-fire-control", name: "SPG", emitterType: "fire-control-radar",
  band: "X", nominalPower: 1, detectionSignature: 1, frequencyAgility: .2, shutdownDelay: 1, restartDelay: 2 };
const missionOne = new ArmEmitterRuntime();
const shipEmitter = missionOne.register({ id: "cg57:primary-emitter", platformId: "cg57",
  definition: sharedDefinition, position: new THREE.Vector3(80, 0, 0), time: 0 });
missionOne.setActive(shipEmitter.id, true, 1, "search");
shipEmitter.health = 0.5;
assert.equal(missionOne.emitters.size, 1);

// What the frame loop does on the next mission when the registry was never cleared.
const carried = missionOne.emitters.has(shipEmitter.id);
assert.ok(carried, "register-if-absent keeps the previous instance, which is the leak itself");
assert.equal(missionOne.emitters.get(shipEmitter.id).active, true, "a stale instance is still marked radiating");
assert.equal(missionOne.emitters.get(shipEmitter.id).health, 0.5, "a stale instance keeps last mission's damage");

// clear() is what resets it, and a fresh registration after clear() is a clean instance.
missionOne.clear();
assert.equal(missionOne.emitters.size, 0, "clear() must empty the registry");
const missionTwo = missionOne.register({ id: shipEmitter.id, platformId: shipEmitter.platformId,
  definition: sharedDefinition, position: new THREE.Vector3(80, 0, 0), time: 500 });
assert.equal(missionTwo.active, false, "a new mission must start with the transmitter silent");
assert.equal(missionTwo.health, 1, "a new mission must start with undamaged hardware");
assert.equal(missionTwo.lastActivatedAt, 500, "a new mission must not inherit lastActivatedAt");

// The consequence, as an executable assertion on the pure SEAD release gate: an emitter that
// survived from the previous mission is enough to authorise a release.
const phantom = new ArmEmitterRuntime();
const stale = phantom.register({ id: "cg57:primary-emitter", platformId: "cg57",
  definition: sharedDefinition, position: new THREE.Vector3(80, 0, 0), time: 0 });
phantom.setActive(stale.id, true, 1, "search");
stale.health = 0.5;
const aircraft = { id: "fcr-01", mission: "sead" };
const track = { targetId: "cg57", quality: 0.6, lastUpdate: 400 };
track.passive = { emitterId: stale.id };
const authorized = armReleaseAuthorization({ aircraft, track, emitters: phantom, time: 400 });
assert.equal(authorized.allowed, true, "a stale emitter from the previous mission still authorises a release");
assert.equal(authorized.emitterId, stale.id, "and it authorises against the phantom emitter id");
phantom.clear();
const refused = armReleaseAuthorization({ aircraft, track, emitters: phantom, time: 400 });
assert.equal(refused.allowed, false, "with the registry cleared, the same release must be refused");
assert.equal(refused.reason, "EMITTER_UNKNOWN");
phantom.register({ id: stale.id, platformId: stale.platformId, definition: sharedDefinition,
  position: new THREE.Vector3(80, 0, 0), time: 500 });
phantom.setActive(stale.id, false, 500);
const silent = armReleaseAuthorization({ aircraft, track, emitters: phantom, time: 500 });
assert.equal(silent.allowed, false, "a fresh, non-radiating emitter must not be authorised by the old active flag");

// The wiring is asserted on the method body itself. `AirCombatSystem` cannot be imported in
// plain Node (extensionless value imports), the same limit that makes
// `verify-mig29-catalog.mjs` read `src/air/catalog.ts` as text.
const runtimeSource = readFileSync(new URL("../src/air/runtime.ts", import.meta.url), "utf8");
const signature = runtimeSource.indexOf("  reset(");
assert.ok(signature >= 0, "reset() not found in src/air/runtime.ts");
const lines = runtimeSource.slice(signature).split("\n");
const openIndex = lines.findIndex((line, i) => i > 0 && line.trimEnd().endsWith("{"));
assert.ok(openIndex > 0, "reset() body opener not found");
let depth = 0, bodyEnd = -1;
for (let i = openIndex; i < lines.length; i++) {
  depth += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
  if (depth === 0) { bodyEnd = i; break; }
}
assert.ok(bodyEnd > openIndex, "reset() body did not balance");
const resetBody = lines.slice(openIndex, bodyEnd + 1).join("\n");
assert.ok(resetBody.includes("this.armEmitters.clear()"),
  "reset() must clear the ARM emitter registry, or the previous mission's emitters are reused");
assert.ok(resetBody.includes("this.armEmitterActivity.clear()"),
  "reset() must clear the ARM emitter activity map, or the first RESTORED/CEASED edge of a reused id is suppressed");
assert.ok(resetBody.indexOf("this.armEmitters.clear()") > resetBody.indexOf("this.sovietSead.reset()"),
  "the registry must be cleared after sovietSead.reset(), which reads it");
assert.ok((resetBody.match(/\.clear\(\)/g) || []).length >= 12,
  "reset() is expected to clear a long list of registries; a shorter body means this check lost its context");

console.log("ARM runtime verification passed:", JSON.stringify({ clearedAfterReset: true }));
