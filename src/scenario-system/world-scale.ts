/**
 * Scenario-declared world scale, in world units per kilometre.
 *
 * The scenario contract requires a positive `simulation.worldUnitsPerKm`, and the
 * guidance map already converts distances with it. Every other distance readout —
 * the console log, the tactical radar rings, and the after-action telemetry — used
 * to divide by a hard-coded constant instead, so a scenario written on a different
 * grid silently disagreed with its own instruments. This module is the single place
 * that resolves the scale, and the runtime and the radar both read it.
 *
 * Distances stay in world units everywhere else in the simulation; only display
 * conversion uses this value, so resolving it differently never moves a platform,
 * a missile, or a sensor volume.
 */

/** The scale every built-in scenario declares, and the fallback for the sandbox. */
export const DEFAULT_WORLD_UNITS_PER_KM = 10;

/**
 * Accepts a declared scale and returns a usable one. `undefined`, non-finite, and
 * non-positive values fall back to the default rather than throwing, because the
 * sandbox runs before any scenario is compiled and must still read out distances.
 */
export function resolveWorldUnitsPerKm(declared: number | undefined): number {
  if (declared === undefined || !Number.isFinite(declared) || declared <= 0)
    return DEFAULT_WORLD_UNITS_PER_KM;
  return declared;
}

/** Converts a world-unit distance into kilometres for display and telemetry. */
export function kilometresFromWorldUnits(worldUnits: number, unitsPerKm: number): number {
  return worldUnits / resolveWorldUnitsPerKm(unitsPerKm);
}

/** Converts a kilometre distance into world units for display-only geometry. */
export function worldUnitsFromKilometres(kilometres: number, unitsPerKm: number): number {
  return kilometres * resolveWorldUnitsPerKm(unitsPerKm);
}
