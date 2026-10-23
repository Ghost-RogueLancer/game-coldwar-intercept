import assert from "node:assert/strict";
import { readCatalogRecord } from "./catalog-record.mjs";
import { stepAirToAirPropulsion } from "../src/air/missile-runtime.ts";

// Read actual catalog fields independent of whitespace, quoting and line breaks.
const ARM_IDS = ["AGM-45A", "AGM-88A", "Kh-31P-C"];
function readWeapon(id) {
  const weapon = readCatalogRecord(new URL("../src/air/catalog.ts", import.meta.url), "AIR_WEAPONS", id);
  assert.ok(weapon.airToAirFlight && typeof weapon.airToAirFlight === "object" && !Array.isArray(weapon.airToAirFlight),
    `${id}.airToAirFlight must be a literal object`);
  const result = { ...weapon, ...weapon.airToAirFlight };
  for (const field of ["speed", "boostSeconds", "maxTurnRateDeg", "sustainSeconds", "coastDragPerSecond", "minimumSpeedFactor", "loftAltitude", "loftTransitionRange", "maximumFlightSeconds"]) {
    assert.ok(Number.isFinite(result[field]), `${id}.${field} must be finite`);
  }
  return result;
}

const weapons = Object.fromEntries(ARM_IDS.map((id) => [id, readWeapon(id)]));

for (const id of ARM_IDS) {
  const weapon = weapons[id];
  let speed = 0;
  const samples = [];
  for (let i = 0; i < 80; i++) {
    const age = i * .5;
    speed = stepAirToAirPropulsion({ currentSpeed: speed, nominalSpeed: weapon.speed, age,
      boostSeconds: weapon.boostSeconds, sustainSeconds: weapon.sustainSeconds,
      coastDragPerSecond: weapon.coastDragPerSecond, minimumSpeedFactor: weapon.minimumSpeedFactor,
      dt: .5 });
    samples.push(speed);
  }
  assert.ok(samples[5] > samples[0], `${id} did not accelerate during boost`);
  assert.ok(samples.at(-1) >= weapon.speed * weapon.minimumSpeedFactor, `${id} fell below minimum safe speed`);
  assert.ok(weapon.loftAltitude >= 0 && weapon.loftTransitionRange > 0, `${id} lacks a bounded loft profile`);
  assert.ok(weapon.maxTurnRateDeg * .1 < 2, `${id} can turn too sharply in one 100 ms physics step`);
  // The declared flight envelope must actually outlast the powered phase; this is the field the
  // previous in-script copy silently omitted.
  assert.ok(weapon.maximumFlightSeconds > weapon.boostSeconds + weapon.sustainSeconds,
    `${id} maximumFlightSeconds must exceed boost + sustain`);
}

assert.ok(weapons["AGM-88A"].sustainSeconds > weapons["AGM-45A"].sustainSeconds);
assert.ok(weapons["AGM-88A"].coastDragPerSecond < weapons["AGM-45A"].coastDragPerSecond);
console.log("ARM ballistics verification passed:", JSON.stringify(weapons));
