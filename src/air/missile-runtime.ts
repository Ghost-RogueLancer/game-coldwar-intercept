import * as THREE from "three";

export type AirToAirMissilePhase = "boost" | "midcourse" | "terminal";

export function airToAirMissilePhase(input: {
  age: number;
  boostSeconds: number;
  commandRange: number;
  seekerRange: number;
  seekerAcquired: boolean;
}): AirToAirMissilePhase {
  if (input.age < input.boostSeconds) return "boost";
  if (input.seekerAcquired || input.commandRange <= input.seekerRange) return "terminal";
  return "midcourse";
}

export function airToAirGuidancePoint(input: {
  seekerAcquired: boolean;
  commandPoint: THREE.Vector3;
  measuredTargetPosition?: THREE.Vector3;
}) {
  return input.seekerAcquired && input.measuredTargetPosition
    ? input.measuredTargetPosition.clone()
    : input.commandPoint.clone();
}

export function airToAirMidcourseAimPoint(input: {
  commandPoint: THREE.Vector3;
  missilePosition: THREE.Vector3;
  seekerAcquired: boolean;
  loftAltitude: number;
  loftTransitionRange: number;
}) {
  const aim = input.commandPoint.clone();
  if (input.seekerAcquired || input.loftAltitude <= 0) return aim;
  const horizontalRange = Math.hypot(
    aim.x - input.missilePosition.x,
    aim.z - input.missilePosition.z,
  );
  const loftWeight = THREE.MathUtils.smoothstep(
    horizontalRange,
    input.loftTransitionRange,
    input.loftTransitionRange * 2,
  );
  aim.y = Math.max(aim.y, THREE.MathUtils.lerp(aim.y, input.loftAltitude, loftWeight));
  return aim;
}

export function stepAirToAirPropulsion(input: {
  currentSpeed: number;
  nominalSpeed: number;
  age: number;
  boostSeconds: number;
  sustainSeconds: number;
  coastDragPerSecond: number;
  minimumSpeedFactor: number;
  dt: number;
}) {
  const minimumSpeed = input.nominalSpeed * input.minimumSpeedFactor;
  if (input.age <= input.boostSeconds) {
    return THREE.MathUtils.lerp(
      input.currentSpeed,
      input.nominalSpeed,
      Math.min(1, input.dt * 1.8),
    );
  }
  if (input.age <= input.boostSeconds + input.sustainSeconds) {
    return THREE.MathUtils.lerp(
      input.currentSpeed,
      input.nominalSpeed * 0.94,
      Math.min(1, input.dt * 0.35),
    );
  }
  return Math.max(
    minimumSpeed,
    input.currentSpeed * Math.exp(-input.coastDragPerSecond * input.dt),
  );
}

export function shouldContinueAfterTargetLoss(input: {
  age: number;
  maximumAge: number;
  altitude: number;
}) {
  return input.age <= input.maximumAge && input.altitude >= 0;
}

/**
 * The ceiling an anti-radiation weapon stops flying at, in seconds.
 *
 * `airToAirFlight.maximumFlightSeconds` is the catalogue's own answer and is what the generic
 * target-loss path already consults (`air/runtime.ts:3255`, `?? 180`), but the anti-radiation
 * branch used a stopwatch literal instead, so the declared 75 / 125 / 100 s for AGM-45A / AGM-88A
 * / Kh-31P-C were dead fields there. The fallback keeps today's 120 s for any anti-radiation
 * weapon that declares no flight profile, so this changes behaviour only where the catalogue
 * actually states an intent.
 */
export const ARM_DEFAULT_MAXIMUM_FLIGHT_SECONDS = 120;

export function shouldContinueArmFlight(input: {
  age: number;
  maximumFlightSeconds?: number;
}) {
  return input.age <= (input.maximumFlightSeconds ?? ARM_DEFAULT_MAXIMUM_FLIGHT_SECONDS);
}
