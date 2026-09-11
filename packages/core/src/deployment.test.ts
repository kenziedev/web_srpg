import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import clear from "../../sim/fixtures/beacon-clear.json";
import {
  apply,
  createBattle,
  canPrepare,
  effectiveMaxMp,
  type BattleState,
  type Command,
} from "./index";

function victory(): BattleState {
  let state = createBattle(content);
  for (const command of clear.commands as Command[]) {
    const result = apply(content, state, command);
    if (!result.ok) throw Error(result.error);
    state = result.nextState;
  }
  return state;
}
function deploy(state: BattleState): Command {
  return {
    type: "deploy",
    commandId: `deploy-${state.revision + 1}`,
    expectedRevision: state.revision,
  };
}
function retry(state: BattleState): BattleState {
  const result = apply(content, state, deploy(state));
  if (!result.ok) throw Error(result.error);
  return result.nextState;
}
function lose(state: BattleState): BattleState {
  while (!state.outcome) {
    const result = apply(content, state, {
      type: "endPhase",
      commandId: `skip-${state.revision}`,
      expectedRevision: state.revision,
      side: state.activeSide,
    });
    if (!result.ok) throw Error(result.error);
    state = result.nextState;
  }
  expect(state.outcome.status).toBe("defeat");
  return state;
}
function clearAgain(state: BattleState): BattleState {
  for (const command of clear.commands as Command[]) {
    if (state.outcome) break;
    // Grown units may remove an enemy before that enemy's recorded turn.
    if (
      command.type === "act" &&
      !state.units.some((unit) => unit.id === command.unitId)
    )
      continue;
    let adjusted = command;
    if (command.type === "act" && command.action.type === "attack") {
      const targetId = command.action.targetId;
      // Keep the planned formation when an earlier, stronger hit already removed
      // the target. This remains a validated move-and-wait command in the replay.
      if (!state.units.some((unit) => unit.id === targetId))
        adjusted = { ...command, action: { type: "wait" } };
    }
    const result = apply(content, state, {
      ...adjusted,
      commandId: `again-${state.revision}`,
      expectedRevision: state.revision,
    });
    if (!result.ok) throw Error(`${command.commandId}: ${result.error}`);
    state = result.nextState;
  }
  expect(state.outcome?.status).toBe("victory");
  return state;
}
describe("S04-D01 continued practice preserves earned growth", () => {
  it("keeps the cleared battle intact, restores a grown roster and reopens preparation", () => {
    const state = victory();
    const before = structuredClone(state);
    const result = apply(content, state, deploy(state));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.nextState;
    expect(state).toEqual(before);
    expect(next.commands.slice(0, -1)).toEqual(state.commands);
    expect(next.revision).toBe(state.revision + 1);
    expect(next.progression.battleStartRevision).toBe(next.revision);
    expect(canPrepare(next)).toBe(true);
    expect(next.outcome).toBeNull();
    expect(next.round).toBe(1);
    expect(next.progression.settlement).toBeNull();
    expect(next.progression.rewardedScenarioIds).toContain(content.scenario.id);
    expect(next.progression.contributions).toEqual({});
    expect(next.statuses).toEqual([]);
    expect(next.terrainChanges).toEqual({});
    for (const veteran of state.progression.roster) {
      const unit = next.units.find((unit) => unit.id === veteran.id)!;
      expect(unit.progression).toEqual(veteran.progression);
      expect(unit.stats).toEqual(veteran.stats);
      expect(unit.hp).toBe(10);
      expect(unit.mp).toBe(effectiveMaxMp(content, next, unit));
      expect(unit.acted).toBe(false);
    }
    expect(next.inventory).toEqual(state.inventory);
    const equipped = apply(content, next, {
      type: "equip",
      commandId: "equip-grown",
      expectedRevision: next.revision,
      unitId: "A3",
      slot: "weapon",
      itemId: "orb",
    });
    expect(equipped.ok).toBe(true);
  });
  it("rejects an unfinished battle, inconsistent settlement, and duplicate deployment without mutations", () => {
    const initial = createBattle(content);
    const before = structuredClone(initial);
    expect(apply(content, initial, deploy(initial)).ok).toBe(false);
    expect(initial).toEqual(before);
    const state = victory();
    state.outcome!.status = "defeat";
    expect(apply(content, state, deploy(state)).ok).toBe(false);
    const won = victory();
    const command = deploy(won);
    const next = apply(content, won, command);
    if (!next.ok) throw Error(next.error);
    expect(apply(content, next.nextState, command).ok).toBe(false);
  });
  it("keeps growth and one-time rewards through a lost practice and another clear", () => {
    const won = victory();
    const lost = lose(retry(won));
    const next = retry(lost);
    for (const veteran of won.progression.roster) {
      const unit = next.units.find((unit) => unit.id === veteran.id)!;
      expect(unit.progression).toEqual(veteran.progression);
      expect(unit.stats).toEqual(veteran.stats);
      expect(unit.equipment).toEqual(veteran.equipment);
    }
    const cleared = clearAgain(next);
    expect(cleared.progression.settlement).toMatchObject({
      outcome: "victory",
      duplicate: true,
    });
    expect(
      cleared.progression.settlement!.entries.every(
        (entry) => entry.awardedExp === 0,
      ),
    ).toBe(true);
    expect(cleared.progression.roster.map((unit) => unit.progression)).toEqual(
      won.progression.roster.map((unit) => unit.progression),
    );
    expect(cleared.progression.rewardedScenarioIds).toEqual([
      content.scenario.id,
    ]);
    // The loss, both deployments, and adapted stronger-unit actions survive a
    // JSON round trip and reproduce the complete state without injecting growth.
    let replay = createBattle(content);
    for (const command of JSON.parse(
      JSON.stringify(cleared.commands),
    ) as Command[]) {
      const result = apply(content, replay, command);
      if (!result.ok) throw Error(result.error);
      replay = result.nextState;
    }
    expect(replay).toEqual(cleared);
  });
  it("allows the first reward after retrying a defeat", () => {
    const lost = lose(createBattle(content));
    expect(lost.progression.rewardedScenarioIds).toEqual([]);
    const won = clearAgain(retry(lost));
    expect(won.progression.settlement).toMatchObject({
      outcome: "victory",
      duplicate: false,
    });
    expect(
      won.progression.settlement!.entries.every(
        (entry) => entry.awardedExp >= 180,
      ),
    ).toBe(true);
  });
  it("replays the full command history across the deployment boundary exactly", () => {
    const won = victory();
    const next = apply(content, won, deploy(won));
    if (!next.ok) throw Error(next.error);
    let replay = createBattle(content);
    for (const command of next.nextState.commands) {
      const result = apply(content, replay, command);
      if (!result.ok) throw Error(result.error);
      replay = result.nextState;
    }
    expect(replay).toEqual(next.nextState);
  });
});
