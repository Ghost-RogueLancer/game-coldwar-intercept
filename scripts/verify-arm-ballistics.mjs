import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stepAirToAirPropulsion } from "../src/air/missile-runtime.ts";

// The ballistics must be read from the shipped catalogue, not restated here. A copy of these
// numbers used to live in this file, so the gate kept passing while `src/air/catalog.ts` changed
// underneath it — and it had already dropped `maximumFlightSeconds`, a field the catalogue
// declares for every anti-radiation weapon. Reading the source is the same approach
// `verify-mig29-catalog.mjs` already uses.
const catalog = readFileSync(new URL("../src/air/catalog.ts", import.meta.url), "utf8");
const ARM_IDS = ["AGM-45A", "AGM-88A", "Kh-31P-C"];

// One definition line per weapon in AIR_WEAPONS; anchored on `id:` so the loadout, hardpoint and
// scenario lists that also mention these names cannot be mistaken for the definition.
function catalogueEntry(id) {
  const line = catalog
    .split("\n")
    .find((candidate) => candidate.includes(`"${id}": {`) && candidate.includes(`id:"${id}"`));
  assert.ok(line, `${id} is no longer a single-line AIR_WEAPONS definition in src/air/catalog.ts`);
  return line;
}
function number(input, key, id) {
  const match = input.match(new RegExp(`(?:^|[^A-Za-z0-9_])${key}:(-?[0-9.]+)`));
  assert.ok(match, `${id} is missing the ${key} field the ballistics gate depends on`);
  const value = Number(match[1]);
  assert.ok(Number.isFinite(value), `${id}.${key} is not a finite number: ${match[1]}`);
  return value;
}
function readWeapon(id) {
  const line = catalogueEntry(id);
  return {
    speed: number(line, "speed", id),
    boostSeconds: number(line, "boostSeconds", id),
    maxTurnRateDeg: number(line, "maxTurnRateDeg", id),
    sustainSeconds: number(line, "sustainSeconds", id),
    coastDragPerSecond: number(line, "coastDragPerSecond", id),
    minimumSpeedFactor: number(line, "minimumSpeedFactor", id),
    loftAltitude: number(line, "loftAltitude", id),
    loftTransitionRange: number(line, "loftTransitionRange", id),
    maximumFlightSeconds: number(line, "maximumFlightSeconds", id),
  };
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
