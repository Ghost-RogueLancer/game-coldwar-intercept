import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

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

const ast = ts.createSourceFile("runtime.ts", source, ts.ScriptTarget.Latest, true);
let terminator;
function visit(node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(ast) === "terminateMissile") terminator = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(terminator?.body, "terminateMissile() must remain the single air missile terminal state");
assert.ok(
  retirements[0].index > terminator.body.pos && retirements[0].index < terminator.body.end,
  "the surviving missile.alive assignment must live inside terminateMissile()",
);

// Exercise the shipped terminal method with a small ledger spy: repeated retirement
// must not settle the same engagement twice, including a same-frame hit after a kill.
const method = ts.transpileModule(`class Probe { ${terminator.getText(ast)} }; return Probe;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const settlements = [];
const Probe = new Function("resolveEngagement", method)((...args) => settlements.push(args));
const system = new Probe();
const ledger = {};
system.currentTime = 42;
system.aircraft = [{ id: "shooter", engagements: ledger }];
const missile = { shooterId: "shooter", engagementTargetId: "ship", alive: true, model: { visible: true } };
system.terminateMissile(missile, "miss");
system.terminateMissile(missile, "hit");
assert.deepEqual(settlements, [[ledger, "ship", "miss", 42]]);
assert.equal(missile.alive, false);
assert.equal(missile.model.visible, false);
assert.equal(missile.phase, "destroyed");

assert.match(
  source,
  /applyDamage: \(\) => this\.terminateMissile\(missile, "miss"\)/,
  "a hard-killed air missile must release its engagement through terminateMissile()",
);

console.log("Air missile engagement settlement verification passed");
