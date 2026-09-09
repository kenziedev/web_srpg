/** Recorded full battle against the real enemy policy, from unmodified content. */
import assert from "node:assert/strict";
import { content } from "../../content/src/index";
import {
  apply,
  createBattle,
  nextEnemyCommand,
  type Command,
} from "../../core/src/index";
import fixture from "../fixtures/beacon-clear.json";

let state = createBattle(content);
for (const command of fixture.commands as Command[]) {
  if (state.activeSide === "enemy")
    assert.deepEqual(
      command,
      nextEnemyCommand(content, state),
      "Enemy policy drift: review and record a new valid clear.",
    );
  const result = apply(content, state, command);
  assert.ok(result.ok, result.ok ? "" : result.error);
  state = result.nextState;
}
assert.deepEqual(state.outcome, fixture.expectedOutcome);
assert.equal(
  state.units.find((u) => u.id === content.scenario.mission!.escortId)?.hp,
  10,
);
assert.equal(state.mission.capturedRound, 2);
assert.equal(state.mission.reinforcement, "cancelled");
let replay = createBattle(content);
for (const command of state.commands) {
  const result = apply(content, replay, command);
  assert.ok(result.ok);
  replay = result.nextState;
}
assert.deepEqual(replay, state);
console.log(
  `Mission clear replay passed: ${state.commands.length} commands, round ${state.round}, ${state.outcome?.bonuses.join(" / ")}. One scripted route; human balance review remains pending.`,
);
