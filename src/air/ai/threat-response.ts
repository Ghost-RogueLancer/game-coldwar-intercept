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

/** Below this horizontal threat speed there is no moving-seeker Doppler axis to notch. */
const MIN_LATERAL_THREAT_SPEED = 1e-3;
/** A threat track this close to the line of sight leaves notch and beam indistinguishable. */
const AXIS_COINCIDENCE_TOLERANCE = 1e-3;

const horizontal = (vector: THREE.Vector3) => {
  const result = vector.clone().setY(0);
  return result.lengthSq() > 1e-6
    ? result.normalize()
    : new THREE.Vector3(0, 0, -1);
};

/**
 * Turns to whichever side is already closer to flying square to `axis`. The axis holds
 * the cue the maneuver exists to null, so one routine serves both defensive shapes: a
 * radiation source is beamed by flying square to the line of sight, a moving seeker is
 * notched by flying square to its own track. `preferredSide` only breaks a near tie, so
 * formation spacing survives unless the two candidates are genuinely equivalent.
 */
function closestPerpendicularDirection(input: {
  currentHeading: THREE.Vector3;
  axis: THREE.Vector3;
  preferredSide: -1 | 1;
}) {
  const right = new THREE.Vector3(-input.axis.z, 0, input.axis.x);
  const left = right.clone().negate();
  const rightScore = horizontal(input.currentHeading).dot(right) +
    (input.preferredSide > 0 ? 0.08 : 0);
  const leftScore = horizontal(input.currentHeading).dot(left) +
    (input.preferredSide < 0 ? 0.08 : 0);
  return rightScore >= leftScore ? right : left;
}

/**
 * Chooses the axis a sustained defensive shape is flown against.
 *
 * A radar-guided threat is defeated square to its own horizontal track, which is what
 * places the aircraft in the Doppler notch of a seeker that is itself moving; the
 * `maneuver-library.ts` notch already takes that axis for the BVR planner. An infrared
 * seeker has no such filter, so it is beamed square to the line of sight instead.
 *
 * Two cases fall back to the line-of-sight axis. A threat tracking exactly along the
 * line of sight, head-on or astern, makes the two axes the same line, and picking the
 * track axis there would only mirror the turn without changing the geometry. A threat
 * with no horizontal motion has no notch to cut at all.
 */
function defensiveAxis(input: {
  ownPosition: THREE.Vector3;
  warning: TacticalTrackObservation;
  radarGuided: boolean;
}) {
  const radial = horizontal(input.warning.position.clone().sub(input.ownPosition));
  if (!input.radarGuided) return radial;
  const lateralSpeed = Math.hypot(input.warning.velocity.x, input.warning.velocity.z);
  if (!Number.isFinite(lateralSpeed) || lateralSpeed <= MIN_LATERAL_THREAT_SPEED)
    return radial;
  const track = horizontal(input.warning.velocity.clone());
  return Math.abs(track.dot(radial)) <= 1 - AXIS_COINCIDENCE_TOLERANCE
    ? track
    : radial;
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
  const radial = horizontal(input.warning.position.clone().sub(input.ownPosition));
  const beam = closestPerpendicularDirection({
    currentHeading: input.currentHeading,
    axis: radial,
    preferredSide: input.preferredSide,
  });
  // The break stays square to the line of sight: at that range the goal is to buy
  // angular displacement for the countermeasure, not to null a filter cue. Only the
  // sustained shape above the break threshold follows the threat track.
  const shape = radarGuided
    ? closestPerpendicularDirection({
        currentHeading: input.currentHeading,
        axis: defensiveAxis({
          ownPosition: input.ownPosition,
          warning: input.warning,
          radarGuided,
        }),
        preferredSide: input.preferredSide,
      })
    : beam;
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
    const direction = shape.clone();
    direction.y = radarGuided && input.altitude > 8 ? -0.07 : 0;
    return {
      phase: radarGuided ? "notch" : "beam",
      desiredDirection: direction.normalize(),
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
    desiredDirection: shape,
    energyPriority: "preserve",
    bankLimitDeg: 68,
    loadFactorFraction: 0.55,
    countermeasure: null,
  };
}
