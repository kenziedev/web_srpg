import assert from "node:assert/strict";
import { content } from "@orden/content";
import { apply, createBattle, reachable, type ActCommand } from "@orden/core";

const initial = createBattle(content);
const unit = initial.units.find((u) => u.id === "A3")!;
const move = reachable(content, initial, unit).find(
  (t) => t.pos.x === 5 && t.pos.y === 2,
);
assert(move, "미라의 1라운드 봉화 접근 경로");
assert.equal(move.cost, 4);
const command: ActCommand = {
  type: "act",
  commandId: "smoke-1",
  expectedRevision: 0,
  unitId: unit.id,
  path: move.path,
  action: { type: "wait" },
};
const first = apply(content, initial, command);
const replay = apply(content, createBattle(content), command);
assert(first.ok && replay.ok);
assert.deepEqual(first, replay);
assert.equal(initial.units.find((u) => u.id === unit.id)!.pos.y, 4);
console.log(
  "Smoke passed: map path + atomic command + deterministic replay. Full battle AI/clear simulation is not implemented.",
);
