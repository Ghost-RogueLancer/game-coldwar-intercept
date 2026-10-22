import * as THREE from "three";
import type { TacticalTrackObservation } from "./tactical-planner.js";

export type ThreatResponsePhase =
  | "monitor" | "beam" | "notch" | "break" | "drag" | "recover";

export interface ThreatResponsePlan {
  phase: ThreatResponsePhase;
  desiredDirection: THREE.Vector3;
  energyPriority: "preserve" | "neutral" | "spend";
  bankLimitDeg: number;
  loadFactorFraction: number;
  countermeasure: "chaff" | "flare" | null;
}

const horizontal = (vector: THREE.Vector3) => {
  const result = vector.clone().setY(0);
  return result.lengthSq() > 1e-6
    ? result.normalize()
    : new THREE.Vector3(0, 0, -1);
};

/**
 * The tie band the fixed 0.08 nudge below produced on its own (0.08 / 2). The flip band is
 * floored here, so the side can never become easier to overturn than it is today.
 */
const MIN_SIDE_FLIP_BAND = 0.04;
/** Past this much geometry the committed side is released whatever the track quality says. */
const MAX_SIDE_FLIP_BAND = 0.3;

/**
 * Smallest geometric advantage allowed to overturn the side `preferredSide` asks for.
 *
 * `air/runtime.ts:2192-2204` displaces every missile warning by up to `uncertainty / 2` on
 * each horizontal axis, re-randomised per frame by the `roll` hash at `air/runtime.ts:200-203`,
 * so a bearing read from that track is only trustworthy to within that displacement. The
 * largest sine of bearing error it can produce is `lateral / hypot(closestTrueRange, lateral)`,
 * where the closest true range consistent with the observed one is `range - lateral`. Doubling
 * that sine is the smallest band the warning jitter alone cannot cross.
 *
 * The two candidates are negatives of each other, so their geometric score gap is
 * `2 * (headingDotSide)`; a nudge of `2 * band` therefore holds the preferred side until the
 * geometry beats it by `band`.
 */
function sideFlipBand(input: {
  ownPosition: THREE.Vector3;
  warning: TacticalTrackObservation;
}) {
  const uncertainty = input.warning.uncertainty;
  if (!Number.isFinite(uncertainty) || uncertainty <= 0) return MIN_SIDE_FLIP_BAND;
  const lateral = uncertainty / 2;
  // `horizontal()` normalises, so it cannot be used to read a distance here.
  const offset = input.warning.position.clone().sub(input.ownPosition);
  const range = Math.hypot(offset.x, offset.z);
  if (!(range > lateral)) return MIN_SIDE_FLIP_BAND;
  const band = 2 * lateral / Math.hypot(range - lateral, lateral);
  return Math.min(Math.max(band, MIN_SIDE_FLIP_BAND), MAX_SIDE_FLIP_BAND);
}

function closestBeamDirection(input: {
  ownPosition: THREE.Vector3;
  currentHeading: THREE.Vector3;
  warning: TacticalTrackObservation;
  preferredSide: -1 | 1;
}) {
  const radial = horizontal(input.warning.position.clone().sub(input.ownPosition));
  const right = new THREE.Vector3(-radial.z, 0, radial.x);
  const left = right.clone().negate();
  const nudge = 2 * sideFlipBand({
    ownPosition: input.ownPosition,
    warning: input.warning,
  });
  const rightScore = horizontal(input.currentHeading).dot(right) +
    (input.preferredSide > 0 ? nudge : 0);
  const leftScore = horizontal(input.currentHeading).dot(left) +
    (input.preferredSide < 0 ? nudge : 0);
  return rightScore >= leftScore ? right : left;
}

export function planThreatResponse(input: {
  ownPosition: THREE.Vector3;
  currentHeading: THREE.Vector3;
  warning?: TacticalTrackObservation;
  estimatedTti?: number;
  guidance?: string;
  preferredSide: -1 | 1;
  altitude: number;
  speedRatio: number;
  previousPhase?: ThreatResponsePhase;
}): ThreatResponsePlan {
  if (!input.warning || input.estimatedTti === undefined)
    return {
      phase: input.previousPhase && input.previousPhase !== "monitor"
        ? "recover" : "monitor",
      desiredDirection: input.currentHeading.clone(),
      energyPriority: "neutral",
      bankLimitDeg: 55,
      loadFactorFraction: 0.35,
      countermeasure: null,
    };

  const radarGuided = input.guidance !== "infrared";
  const beam = closestBeamDirection({
    ownPosition: input.ownPosition,
    currentHeading: input.currentHeading,
    warning: input.warning,
    preferredSide: input.preferredSide,
  });
  const floorBias = input.altitude > 8 ? -0.1 : 0.08;
  const uncertaintyDelay = Math.min(2.5, input.warning.uncertainty * 0.025);
  const tti = Math.max(0, input.estimatedTti - uncertaintyDelay);
  const breakThreshold = input.previousPhase === "break" ? 9 : 7.5;
  const beamThreshold = input.previousPhase === "notch" ||
      input.previousPhase === "beam" ? 20 : 18;
  if (tti <= breakThreshold) {
    beam.y = floorBias;
    return {
      phase: "break",
      desiredDirection: beam.normalize(),
      energyPriority: "spend",
      bankLimitDeg: 82,
      loadFactorFraction: 0.96,
      countermeasure: radarGuided ? "chaff" : "flare",
    };
  }
  if (tti <= beamThreshold) {
    beam.y = radarGuided && input.altitude > 8 ? -0.07 : 0;
    return {
      phase: radarGuided ? "notch" : "beam",
      desiredDirection: beam.normalize(),
      energyPriority: input.speedRatio < 0.55 ? "preserve" : "spend",
      bankLimitDeg: 76,
      loadFactorFraction: 0.72,
      countermeasure: radarGuided ? "chaff" : "flare",
    };
  }
  if (input.speedRatio < 0.48) {
    const away = input.ownPosition.clone().sub(input.warning.position);
    away.y = input.altitude > 8 ? -0.04 : 0.04;
    return {
      phase: "drag",
      desiredDirection: away.normalize(),
      energyPriority: "preserve",
      bankLimitDeg: 68,
      loadFactorFraction: 0.58,
      countermeasure: null,
    };
  }
  return {
    phase: radarGuided ? "notch" : "beam",
    desiredDirection: beam,
    energyPriority: "preserve",
    bankLimitDeg: 68,
    loadFactorFraction: 0.55,
    countermeasure: null,
  };
}
