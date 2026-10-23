import assert from "node:assert/strict";
import fs from "node:fs";

// Air-launched missiles are hard-killed by ship air defense (ARCHITECTURE.md:44),
// and terminateMissile() is the only routine that settles the shooter's engagement
// ledger. A missile that retires without it keeps pending > 0 for that target
// forever, so the launch filter stops offering it and the aircraft never re-attacks
// the ship that shot its missile down. This keeps the terminal-state routing honest
// without needing a browser: the invariant is a source contract, not a pixel.
const source = fs.readFileSync(
  process.env.SOURCE ?? new URL("../src/air/runtime.ts", import.meta.url),
  "utf8",
);

const retirements = [...source.matchAll(/^\s*missile\.alive = false;$/gm)];
assert.equal(
  retirements.length,
  1,
  `an air missile may only be retired by terminateMissile(); found ${retirements.length} hand-written assignments`,
);

const terminator = source.indexOf("private terminateMissile(");
assert.ok(terminator >= 0, "terminateMissile() must remain the single air missile terminal state");
assert.ok(
  retirements[0].index > terminator,
  "the surviving missile.alive assignment must live inside terminateMissile()",
);

assert.match(
  source,
  /applyDamage: \(\) => this\.terminateMissile\(missile, "miss"\)/,
  "a hard-killed air missile must release its engagement through terminateMissile()",
);

console.log("Air missile engagement settlement verification passed");
