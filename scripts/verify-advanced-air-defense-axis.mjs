import assert from "node:assert/strict";
import * as THREE from "three";
import { planThreatResponse } from "../dist-test/air/ai/threat-response.js";
import { notchManeuver } from "../dist-test/air/ai/maneuver-library.js";
import { observedIlluminatorPosition, tacticalTrackNumber } from "../dist-test/air/ai/illuminator-observation.js";
import { readFileSync } from "node:fs";

const shooterId = "red-shooter";
const track = (lastUpdate, quality = .8, x = 10) => ({
  targetId: shooterId, position: new THREE.Vector3(x, 40, -80), velocity: new THREE.Vector3(),
  quality, uncertainty: 4, lastUpdate, classification: "aircraft",
});
const observed = (tracks = new Map(), networkTracks = new Map(), guidance = "semi-active-radar") =>
  observedIlluminatorPosition({ shooterId, tracks, networkTracks, guidance, time: 10 });
const networkKey = `link16:${tacticalTrackNumber(shooterId)}`;
const organic = track(9, .8), network = track(9.2, .3, 20);
assert.deepEqual(observed(new Map([[shooterId, organic]])), organic.position);
assert.deepEqual(observed(undefined, new Map([[networkKey, network]])), network.position);
assert.deepEqual(observed(undefined, new Map([[networkKey.replace("link16:", "link11:"), network]])), network.position);
assert.deepEqual(observed(new Map([[shooterId, organic]]), new Map([[networkKey, network]])), organic.position);
const fresh = track(10, .3, 30), near = track(9.6, .7, 40), older = track(9.2, .9, 50);
assert.deepEqual(observed(new Map([[shooterId, fresh]]), new Map([
  [networkKey, near], [networkKey.replace("link16:", "link11:"), older],
])), near.position, "quality tie window must be anchored on the freshest observation");
assert.equal(observed(undefined, new Map([[shooterId, network]])), undefined, "raw network keys are not observed track numbers");
for (const bad of [track(4), track(11), track(NaN), track(9, .1), { ...track(9), uncertainty: Infinity },
  { ...track(9), position: new THREE.Vector3(NaN, 0, 0) }]) {
  assert.equal(observed(new Map([[shooterId, bad]])), undefined);
}
assert.equal(observed(new Map([[shooterId, organic]]), undefined, "active-radar"), undefined);
const copy = observed(new Map([[shooterId, organic]]));
copy.x = 999;
assert.equal(organic.position.x, 10, "planner must not mutate stored observations");
const runtimeSource = readFileSync(new URL("../src/air/runtime.ts", import.meta.url), "utf8");
assert.match(runtimeSource, /return observedIlluminatorPosition\(/);
assert.match(runtimeSource, /if \(illuminationTrack && !\(context\.advancedAirAiEnabled && pilotHasReacted\)\)/,
  "illumination support must not overwrite advanced evasion");

const own = new THREE.Vector3(0, 40, 0);
const heading = new THREE.Vector3(0, 0, -1);
const flat = (vector) => new THREE.Vector3(vector.x, 0, vector.z);
// A degenerate horizontal projection would let a dot assertion pass vacuously, so every direction
// must keep a real horizontal component before it is compared.
const unit = (vector, label) => {
  const h = flat(vector);
  assert.ok(h.lengthSq() > 0.5, `${label} lost its horizontal component`);
  return h.normalize();
};
const dirOf = (w, guidance, tti, overrides = {}) =>
  plan(w, guidance, tti, overrides).desiredDirection;
const warning = (position, velocity, uncertainty = 4) =>
  ({ position, velocity, quality: 0.7, uncertainty });
const plan = (w, guidance, tti, overrides = {}) => planThreatResponse({
  ownPosition: own, currentHeading: heading, warning: w, estimatedTti: tti, guidance,
  preferredSide: 1, altitude: 40, speedRatio: 0.7, ...overrides,
});

// Deliberately NON-degenerate: the seeker track sits 45 deg off the line of sight (a lead aspect).
// With the track perpendicular to, or antiparallel to, the line of sight, "square to track" and
// "square to line of sight" are the same ray and the assertions below would prove nothing.
const los = unit(new THREE.Vector3(0, 40, -60).clone().sub(own), "line of sight");
const leadTrack = unit(new THREE.Vector3(0.70710678, 0, -0.70710678), "ARH track");
assert.ok(Math.abs(leadTrack.dot(los) - 0.70710678) < 1e-4, "fixture must be a 45 deg aspect");
const leadWarning = warning(new THREE.Vector3(0, 40, -60),
  new THREE.Vector3(0.70710678, 0, -0.70710678).multiplyScalar(12));

// 1. active-radar carries its transmitter, so the Doppler filter lives on the missile and the
//    notch must be square to the missile's own horizontal track.
const arh = unit(plan(leadWarning, "active-radar", 14).desiredDirection, "ARH notch");
assert.ok(Math.abs(leadTrack.dot(arh)) < 1e-6, "ARH notch must be square to the missile track");
assert.ok(Math.abs(los.dot(arh)) > 0.6,
  "ARH notch must not be flown square to the line of sight under a 45 deg aspect");

// 2. A semi-active seeker only receives; the filter belongs to the illuminating aircraft.
const shooterLos = unit(new THREE.Vector3(-0.5, 0, -0.8660254), "illuminator LOS");
const sar = unit(plan(leadWarning, "semi-active-radar", 14,
  { illuminatorPosition: own.clone().addScaledVector(shooterLos, 80) }).desiredDirection, "SAR notch");
assert.ok(Math.abs(shooterLos.dot(sar)) < 1e-6, "SAR notch must be square to the illuminator");
assert.ok(Math.abs(leadTrack.dot(sar)) > 0.9, "SAR notch must not be flown against the missile track");

// 3. An unresolvable illuminator (undetected shooter, ship designator, stale or overhead track)
//    degrades to today's line-of-sight geometry instead of inventing an axis.
assert.ok(Math.abs(los.dot(unit(dirOf(leadWarning, "semi-active-radar", 14),
  "SAR fallback"))) < 1e-6, "unresolved illuminator must fall back to LOS");
assert.ok(Math.abs(los.dot(unit(dirOf(leadWarning, "semi-active-radar", 14,
  { illuminatorPosition: new THREE.Vector3(0, 400, 0) }), "SAR overhead"))) < 1e-6,
  "an illuminator straight up has no horizontal cue and must fall back to LOS");

// 4. Infrared has no Doppler filter at all; a pure vertical track has no horizontal cue either.
const ir = plan(leadWarning, "infrared", 14);
assert.equal(ir.phase, "beam", "an infrared threat must not be notched");
assert.ok(Math.abs(los.dot(unit(ir.desiredDirection, "IR beam"))) < 1e-6,
  "the infrared beam stays square to the line of sight");
const vertical = warning(new THREE.Vector3(0, 40, -60), new THREE.Vector3(0, 12, 0));
assert.ok(Math.abs(los.dot(unit(dirOf(vertical, "active-radar", 14),
  "vertical track"))) < 1e-6, "a vertical track must degrade to the LOS axis");

// 5. The three seeker classes are now three genuinely different flown geometries.
assert.ok(arh.angleTo(sar) > 0.5, "active and semi-active defences must not share one geometry");

// 6. Cross-module agreement, sign-agnostic: notchManeuver builds UP x threat, which is the same
//    axis line as this module's (-axis.z, 0, axis.x) with the opposite ray label.
const libraryAxis = unit(notchManeuver({ threatVelocity: leadWarning.velocity, side: 1,
  descentBias: 0 }), "maneuver-library notch");
assert.ok(1 - Math.abs(libraryAxis.dot(arh)) < 1e-6,
  "the defensive notch must agree with maneuver-library notchManeuver's axis");

// 7. Bearing sweep. Expected values are the ones measured on b6a3270a, so this is a
//    no-regression pin, not a restatement of the new code.
//    Straight-line missile (track 45 deg off the bearing): the committed side used to mirror in the
//    pair 5 deg / 180 deg as the threat swung through the nose. The canonicalised track axis removes
//    that pair and keeps the two genuine beam crossings.
const rollSide = (deg, velocity) => {
  const bearing = THREE.MathUtils.degToRad(deg);
  const position = new THREE.Vector3(Math.sin(bearing) * 60, 40, -Math.cos(bearing) * 60);
  const w = warning(position, velocity, 0);
  const d = plan(w, "active-radar", 14).desiredDirection;
  const sign = heading.clone().cross(flat(d)).y;
  return Math.abs(sign) < 1e-9 ? 0 : Math.sign(sign);
};
const sweep = (velocity) => {
  const flips = [];
  let last = 0;
  for (let deg = -180; deg <= 180; deg += 5) {
    const side = rollSide(deg, velocity);
    if (side !== 0 && last !== 0 && side !== last) flips.push(deg);
    if (side !== 0) last = side;
  }
  return flips;
};
const straightFlips = sweep(new THREE.Vector3(0, 0, 12));
assert.deepEqual(straightFlips, [-90, 95],
  `a straight-flying missile must cross the beam exactly twice, got ${straightFlips}`);
assert.ok(!straightFlips.some((deg) => Math.abs(deg) <= 20 || Math.abs(Math.abs(deg) - 180) <= 20),
  "the side must not mirror as the threat swings through the nose");
const closingVelocity = (deg) => {
  const bearing = THREE.MathUtils.degToRad(deg);
  const position = new THREE.Vector3(Math.sin(bearing) * 60, 40, -Math.cos(bearing) * 60);
  return flat(position.clone().sub(own)).normalize().multiplyScalar(12);
};
// Where the track is parallel to the line of sight the axis is unchanged, so the four flips of
// b6a3270a must survive untouched: this fix must not quietly retime the existing behaviour.
// (closingFlips below is the assertion; velocity is recomputed per bearing.)
const closingFlips = (() => {
  const flips = [];
  let last = 0;
  for (let deg = -180; deg <= 180; deg += 5) {
    const side = rollSide(deg, closingVelocity(deg));
    if (side !== 0 && last !== 0 && side !== last) flips.push(deg);
    if (side !== 0) last = side;
  }
  return flips;
})();
assert.deepEqual(closingFlips, [-85, 5, 95, 180],
  `closing-missile side schedule changed: ${closingFlips}`);

// 8. Everything except which axis is nulled must be pinned to b6a3270a.
const plans = {
  notch: plan(leadWarning, "active-radar", 14),
  sustained: plan(leadWarning, "active-radar", 28),
  break: plan(leadWarning, "active-radar", 5),
  drag: plan(leadWarning, "active-radar", 28, { speedRatio: 0.3 }),
  hysteresis: plan(leadWarning, "active-radar", 8.5, { previousPhase: "break" }),
  floor: plan(leadWarning, "active-radar", 5, { altitude: 2 }),
};
assert.equal(plans.notch.phase, "notch");
assert.equal(plans.sustained.phase, "notch");
assert.equal(plans.break.phase, "break");
assert.equal(plans.drag.phase, "drag");
assert.equal(plans.hysteresis.phase, "break");
assert.equal(plans.notch.energyPriority, "spend");
assert.equal(plans.notch.bankLimitDeg, 76);
assert.equal(plans.notch.loadFactorFraction, 0.72);
assert.equal(plans.break.bankLimitDeg, 82);
assert.equal(plans.break.loadFactorFraction, 0.96);
assert.equal(plans.break.countermeasure, "chaff");
assert.equal(plans.drag.bankLimitDeg, 68);
assert.equal(plans.drag.loadFactorFraction, 0.58);
assert.equal(plans.sustained.bankLimitDeg, 68);
assert.equal(plans.sustained.loadFactorFraction, 0.55);
assert.equal(plans.sustained.countermeasure, null);
assert.ok(plans.floor.desiredDirection.y > 0, "a floor-protected break must still climb");
assert.ok(plans.notch.desiredDirection.y < 0, "a notch above the floor must still bleed down");
// A break buys angular displacement for the countermeasure window, so it deliberately stays square
// to the line of sight instead of following the seeker-class axis.
assert.ok(Math.abs(los.dot(unit(plans.break.desiredDirection, "break"))) < 1e-6,
  "the break must ignore the seeker-class axis and stay LOS-square");
const monitor = plan(undefined, "active-radar", undefined);
assert.equal(monitor.phase, "monitor");
assert.equal(monitor.bankLimitDeg, 55);
assert.equal(monitor.loadFactorFraction, 0.35);

console.log(JSON.stringify({
  fixture: { aspectDeg: 45, arhVsTrack: leadTrack.dot(arh), arhVsLos: los.dot(arh),
    sarVsShooter: shooterLos.dot(sar), sarVsTrack: leadTrack.dot(sar),
    arhSarSeparationRad: Number(arh.angleTo(sar).toFixed(4)) },
  straightFlips: straightFlips, closingFlips: closingFlips,
  phases: Object.fromEntries(Object.entries(plans).map(([k, v]) => [k, v.phase])),
}));
