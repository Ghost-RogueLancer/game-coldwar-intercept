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
 * The axis whose cue the sustained defensive shape is flown square to, chosen by seeker class.
 *
 * A Doppler filter rejects returns whose radial velocity against **its own transmitter** falls
 * inside a notch. `active-radar` seekers carry the transmitter, so the filter lives on the
 * missile and the notch is square to the missile's horizontal track, which is what
 * `maneuver-library.ts` `notchManeuver` already assumes. A `semi-active-radar` seeker only
 * receives: its transmitter is the illuminating aircraft, so that is the cue to null. Infrared
 * has no Doppler filter and keeps the line of sight.
 *
 * The track is canonicalised onto the hemisphere holding the line of sight. The axis *line* is
 * unchanged by that choice (the two notch rays are the same pair either way) but the ray labels
 * stay continuous as the threat swings through head-on, so following the track cannot mirror the
 * commanded turn at the nose crossing.
 */
function defensiveAxis(input: {
  ownPosition: THREE.Vector3;
  warning: TacticalTrackObservation;
  guidance: string | undefined;
  illuminatorPosition?: THREE.Vector3;
}) {
  const radial = horizontal(input.warning.position.clone().sub(input.ownPosition));
  if (input.guidance === "semi-active-radar" && input.illuminatorPosition) {
    const offset = input.illuminatorPosition.clone().sub(input.ownPosition);
    return Math.hypot(offset.x, offset.z) > 1e-6 ? horizontal(offset) : radial;
  }
  if (input.guidance !== "active-radar") return radial;
  const lateralSpeed = Math.hypot(input.warning.velocity.x, input.warning.velocity.z);
  if (!Number.isFinite(lateralSpeed) || lateralSpeed <= 1e-3) return radial;
  const track = horizontal(input.warning.velocity.clone());
  return track.dot(radial) >= 0 ? track : track.negate();
}

export function planThreatResponse(input: {
  ownPosition: THREE.Vector3;
  currentHeading: THREE.Vector3;
  warning?: TacticalTrackObservation;
  estimatedTti?: number;
  guidance?: string;
  preferredSide: -1 | 1;
  illuminatorPosition?: THREE.Vector3;
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
  const beam = closestPerpendicularDirection({
    currentHeading: input.currentHeading,
    axis: horizontal(input.warning.position.clone().sub(input.ownPosition)),
    preferredSide: input.preferredSide,
  });
  // A break buys angular displacement for the countermeasure window, so it stays square to the
  // line of sight. Only the sustained shape follows the seeker-class cue.
  const shape = closestPerpendicularDirection({
    currentHeading: input.currentHeading,
    axis: defensiveAxis({
      ownPosition: input.ownPosition,
      warning: input.warning,
      guidance: input.guidance,
      illuminatorPosition: input.illuminatorPosition,
    }),
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
