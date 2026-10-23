import assert from "node:assert/strict";
import * as THREE from "three";
import { planThreatResponse } from "../dist-test/air/ai/threat-response.js";

// Mirrors src/air/runtime.ts:200-203 (deterministic per-frame hash, decorrelated).
const roll = (seed) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

const ownPosition = new THREE.Vector3(0, 40, 0);
const currentHeading = new THREE.Vector3(0, 0, -1);
const bearing = (deg, range) => {
  const r = THREE.MathUtils.degToRad(deg);
  return new THREE.Vector3(Math.sin(r) * range, 40, -Math.cos(r) * range);
};

// The side the aircraft is told to turn to, expressed exactly as air/runtime.ts:3116 does:
// the sign of heading x desiredDirection along the vertical axis drives the roll direction.
const turnSide = (desired, threatPosition) => {
  const sign = currentHeading.clone().cross(desired.clone().setY(0)).y;
  return Math.abs(sign) < 1e-9 ? 0 : Math.sign(sign);
};
const planFor = (threatPosition, uncertainty, overrides = {}) => planThreatResponse({
  ownPosition: ownPosition,
  currentHeading: currentHeading.clone(),
  warning: {
    position: threatPosition,
    velocity: new THREE.Vector3(0, 0, 12),
    quality: 0.7,
    uncertainty,
  },
  estimatedTti: 14,
  // A semi-active threat with no observed illuminator uses the LOS axis.
  // Active-radar geometry is tested separately against its observed velocity.
  guidance: "semi-active-radar",
  preferredSide: 1,
  altitude: 40,
  speedRatio: 0.7,
  ...overrides,
});
const sideFor = (threatPosition, uncertainty, overrides) =>
  turnSide(planFor(threatPosition, uncertainty, overrides).desiredDirection, threatPosition);

// The missile-warning quality curve from src/air/runtime.ts:2188-2191.
const warningUncertainty = (range, warningRange) =>
  (1 - clamp(0.4 + (1 - range / warningRange) * 0.5, 0.3, 0.92)) * 12;

// 1. A perfect track must reproduce today's behavior exactly: the band is floored at the
//    width the removed fixed 0.08 nudge already produced, so nothing becomes harder to
//    overturn than it is on b6a3270a.
assert.equal(sideFor(bearing(2, 60), 0), -1, "a clean track must still hold the tie side at 2 deg");
assert.equal(sideFor(bearing(3, 60), 0), 1,
  "a clean track must flip at the same width it does today (0.08 nudge -> 2.29 deg)");

// 2. The same geometry under the passive-warning noise floor must NOT flip: at range 60 with
//    warningRange 70 the runtime's own formula yields uncertainty 6.34, i.e. a +-3.03 deg
//    bearing error, which is wider than the old 2.29 deg tie band.
const passive = warningUncertainty(60, 70);
assert.ok(Math.abs(passive - 6.34) < 0.01, `expected passive uncertainty ~6.34, got ${passive}`);
assert.equal(sideFor(bearing(0, 60), passive), -1, "tie geometry must hold the tie side");
assert.equal(sideFor(bearing(3, 60), passive), -1,
  "a 3 deg bearing error is inside this track's own noise, so it must not overturn the side");

// 3. The band must still release on evidence the track cannot explain away.
assert.equal(sideFor(bearing(8, 60), passive), 1,
  "a crossing well outside the noise band must still overturn the side");
const worst = warningUncertainty(20, 150);
assert.equal(sideFor(bearing(30, 20), worst), 1,
  "even at the widest band the cap must let a real quarter-turn cross over");
assert.equal(sideFor(bearing(8, 20), 50), -1,
  "uncertainty enclosing ownship must use the widest band, not the minimum");

// 4. Sensor jitter alone must never overturn the side, across every (warningRange, range)
//    state the runtime can actually produce. Offsets use the runtime's own +-uncertainty/2.
const states = [];
for (const warningRange of [150, 70])
  for (const range of [20, 30, 40, 50, 60, 70, 90, 110, 130, 150])
    if (range <= warningRange * 1.05)
      states.push({ warningRange, range, uncertainty: warningUncertainty(range, warningRange) });
let flippable = 0;
for (const state of states) {
  const lateral = state.uncertainty / 2;
  const clean = sideFor(bearing(0, state.range), state.uncertainty);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const jittered = bearing(0, state.range);
    jittered.x += sx * lateral;
    jittered.z += sz * lateral;
    if (sideFor(jittered, state.uncertainty) !== clean) flippable++;
  }
}
assert.equal(flippable, 0,
  `track jitter alone overturned the side in ${flippable} sampled states`);

// 5. Frame-to-frame dither measured the way the flight director sees it: reversals of the
//    roll-direction sign across 60 frames of the runtime's own jitter hash.
function reversals(range, warningRange, frames = 60) {
  const uncertainty = warningUncertainty(range, warningRange);
  let last = 0, flips = 0;
  for (let frame = 1; frame <= frames; frame++) {
    const jittered = bearing(0, range);
    jittered.x += (roll(frame + 7) - 0.5) * uncertainty;
    jittered.z += (roll(frame + 8) - 0.5) * uncertainty;
    const side = sideFor(jittered, uncertainty);
    if (side !== 0) {
      if (last !== 0 && side !== last) flips++;
      last = side;
    }
  }
  return flips;
}
assert.equal(reversals(60, 70), 0, "passive warning at range 60 must not dither");
assert.equal(reversals(30, 70), 0, "passive warning at range 30 must not dither");
assert.equal(reversals(110, 150), 0, "datalinked warning at range 110 must not dither");

// 6. Formation doctrine still breaks an exact tie, in both directions, and a non-finite
//    quality field must fall back rather than produce NaN.
for (const preferredSide of [-1, 1]) {
  const tied = turnSide(planFor(bearing(0, 60), 8, { preferredSide }).desiredDirection,
    bearing(0, 60));
  assert.equal(Math.sign(tied), -preferredSide,
    `preferredSide ${preferredSide} must decide an exact tie`);
}
for (const uncertainty of [Number.NaN, Number.POSITIVE_INFINITY, -4]) {
  const plan = planFor(bearing(0, 60), uncertainty);
  assert.ok(Number.isFinite(plan.desiredDirection.x), "non-finite uncertainty must not yield NaN");
}

// 7. Everything except the side choice must be untouched: phase ladder, vertical commands,
//    energy and countermeasure calls, under the widest noise the runtime produces.
const plans = {
  early: planFor(bearing(3, 60), worst, { estimatedTti: 28 }),
  notch: planFor(bearing(3, 60), worst, { estimatedTti: 14 }),
  break: planFor(bearing(3, 60), worst, { estimatedTti: 5 }),
  infrared: planFor(bearing(3, 60), worst, { estimatedTti: 5, guidance: "infrared" }),
  lowEnergy: planFor(bearing(3, 60), worst, { estimatedTti: 28, speedRatio: 0.3 }),
  hysteresis: planFor(bearing(3, 60), worst, { estimatedTti: 8.5, previousPhase: "break" }),
  floor: planFor(bearing(3, 60), worst, { estimatedTti: 5, altitude: 2 }),
};
assert.deepEqual(
  [plans.early.phase, plans.notch.phase, plans.break.phase, plans.lowEnergy.phase],
  ["notch", "notch", "break", "drag"]);
assert.equal(plans.hysteresis.phase, "break");
assert.equal(plans.infrared.countermeasure, "flare");
assert.equal(plans.break.countermeasure, "chaff");
assert.equal(plans.break.bankLimitDeg, 82);
assert.equal(plans.break.loadFactorFraction, 0.96);
assert.ok(plans.floor.desiredDirection.y > 0, "a floor-protected break must still command climb");
assert.ok(plans.notch.desiredDirection.y < 0, "an altitude-above-floor notch must still bleed down");
const radialAt3 = bearing(3, 60).clone().setY(40).sub(ownPosition).normalize();
assert.ok(Math.abs(radialAt3.dot(plans.notch.desiredDirection.clone().setY(0).normalize())) < 0.06,
  "the notch must stay square to the threat bearing regardless of the band width");

console.log(JSON.stringify({
  statesTested: states.length,
  overturnsByJitter: flippable,
  ditherReversals: { passive60: reversals(60, 70), passive30: reversals(30, 70), active110: reversals(110, 150) },
  cleanTrackFlipDeg: 3,
  noisyTrackHoldDeg: 3,
  noisyTrackReleaseDeg: 8,
  passiveUncertainty60: passive,
  worstUncertainty20: worst,
  phases: Object.fromEntries(Object.entries(plans).map(([k, v]) => [k, v.phase])),
}));
