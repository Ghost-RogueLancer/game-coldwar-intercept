import assert from "node:assert/strict";
import * as THREE from "three";
import { planThreatResponse } from "../dist-test/air/ai/threat-response.js";
import { notchManeuver } from "../dist-test/air/ai/maneuver-library.js";

const own = new THREE.Vector3(0, 40, 0);
const heading = new THREE.Vector3(0, 0, -1);
const horizontalUnit = (vector) => {
  const flat = new THREE.Vector3(vector.x, 0, vector.z);
  return flat.lengthSq() > 1e-12 ? flat.normalize() : new THREE.Vector3();
};
const track = (position, velocity) => ({ position, velocity, quality: 0.7, uncertainty: 4 });
const plan = (warning, tti, guidance, overrides = {}) => planThreatResponse({
  ownPosition: own,
  currentHeading: heading,
  warning,
  estimatedTti: tti,
  guidance,
  preferredSide: 1,
  altitude: 40,
  speedRatio: 0.7,
  ...overrides,
});

// 1. Head-on closure: the threat tracks exactly along the line of sight, so notch and
//    beam are the same line. The planner must keep flying square to the line of sight.
const headOn = track(new THREE.Vector3(0, 40, -60), new THREE.Vector3(0, 0, 12));
const losA = horizontalUnit(headOn.position.clone().sub(own));
const notchA = plan(headOn, 14, "active-radar");
assert.equal(notchA.phase, "notch");
assert.ok(Math.abs(losA.dot(horizontalUnit(notchA.desiredDirection))) < 1e-6,
  "a head-on threat leaves no distinct notch axis, so the beam geometry must be kept");

// 2. Oblique closure: the threat is in lead pursuit, so the two axes differ. The notch
//    has to be square to the threat's own track, not to the current line of sight.
const oblique = track(new THREE.Vector3(40, 40, -60), new THREE.Vector3(-7.2, 0, -9.6));
const losB = horizontalUnit(oblique.position.clone().sub(own));
const velB = horizontalUnit(oblique.velocity);
assert.ok(Math.abs(losB.dot(velB)) < 0.99, "fixture must actually differ from head-on");
const notchB = plan(oblique, 14, "active-radar");
const notchDirB = horizontalUnit(notchB.desiredDirection);
assert.equal(notchB.phase, "notch");
assert.ok(Math.abs(velB.dot(notchDirB)) < 1e-6,
  "the notch must fly square to the threat's own velocity axis");
assert.ok(Math.abs(losB.dot(notchDirB)) > 0.3,
  "the notch must not collapse back onto the line-of-sight beam");

// 3. The infrared beam keeps the line-of-sight geometry, so the two named phases are
//    now genuinely two different maneuvers instead of one maneuver with two labels.
const beamB = plan(oblique, 14, "infrared");
assert.equal(beamB.phase, "beam");
assert.ok(Math.abs(losB.dot(horizontalUnit(beamB.desiredDirection))) < 1e-6,
  "the beam must stay square to the line of sight");
assert.ok(notchDirB.angleTo(horizontalUnit(beamB.desiredDirection)) > 0.5,
  "notch and beam must produce different flown headings");

// 4. Cross-module agreement: the defensive notch must sit on the same axis the BVR
//    planner already uses from the maneuver library.
const libraryAxis = horizontalUnit(notchManeuver({
  threatVelocity: oblique.velocity,
  side: 1,
  descentBias: 0,
}));
assert.ok(1 - Math.abs(libraryAxis.dot(notchDirB)) < 1e-6,
  "the defensive notch must share the maneuver-library notch axis");

// 5. A threat with no horizontal motion has no Doppler notch to cut; fall back to the
//    line-of-sight beam instead of an arbitrary axis.
const vertical = track(new THREE.Vector3(0, 90, -60), new THREE.Vector3(0, -12, 0));
const losC = horizontalUnit(vertical.position.clone().sub(own));
const notchC = plan(vertical, 14, "active-radar");
assert.ok(Math.abs(losC.dot(horizontalUnit(notchC.desiredDirection))) < 1e-6,
  "a threat with no horizontal motion must fall back to the beam geometry");

// 6. The break is a countermeasure-displacement turn, not a Doppler shape: it must stay
//    square to the line of sight and keep its own energy and depot calls.
const breakPlan = plan(oblique, 5, "active-radar");
assert.equal(breakPlan.phase, "break");
assert.ok(Math.abs(losB.dot(horizontalUnit(breakPlan.desiredDirection))) < 1e-6,
  "the break must remain square to the line of sight");
assert.equal(breakPlan.bankLimitDeg, 82);
assert.equal(breakPlan.loadFactorFraction, 0.96);
assert.equal(breakPlan.countermeasure, "chaff");

// 7. Vertical command and phase labels are untouched by the axis change.
assert.ok(notchB.desiredDirection.y < 0, "an altitude-above-floor notch still bleeds down");
assert.ok(plan(oblique, 5, "active-radar", { altitude: 2 }).desiredDirection.y > 0,
  "a floor-protected break must still command climb");
assert.equal(plan(oblique, 28, "active-radar", { speedRatio: 0.3 }).phase, "drag");
assert.equal(plan(oblique, 40, "active-radar", { previousPhase: "break" }).phase, "notch");

// 8. Side selection must still favour the direction the aircraft is already turning to,
//    so a late warning does not invert the maneuver.
for (const preferredSide of [-1, 1]) {
  const candidate = horizontalUnit(plan(oblique, 14, "active-radar", { preferredSide }).desiredDirection);
  assert.ok(heading.dot(candidate) >= candidate.clone().negate().dot(heading) - 0.09,
    "the notch side must follow the current heading apart from the tie-break nudge");
}

console.log(JSON.stringify({
  headOnKeepsBeam: Math.abs(losA.dot(horizontalUnit(notchA.desiredDirection))) < 1e-6,
  notchSquareToThreatTrack: Math.abs(velB.dot(notchDirB)),
  notchAgainstLineOfSight: Math.abs(losB.dot(notchDirB)),
  notchBeamSeparationRad: notchDirB.angleTo(horizontalUnit(beamB.desiredDirection)),
  libraryAxisAgreement: Math.abs(libraryAxis.dot(notchDirB)),
}));
