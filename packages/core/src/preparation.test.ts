import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import {
  apply,
  createBattle,
  phaseEndCommand,
  type BattleState,
  type TrainCommand,
} from "./index";

function training(
  state: BattleState,
  spellIds: string[],
  unitId = "A3",
): TrainCommand {
  return {
    type: "train",
    commandId: `train-${state.revision + 1}`,
    expectedRevision: state.revision,
    unitId,
    spellIds,
  };
}
describe("practice spell preparation", () => {
  it("changes only the selected loadout and command log, and replays without refilling MP", () => {
    const initial = createBattle(content);
    const before = structuredClone(initial);
    const command = training(initial, [
      "teleport",
      "summon-salamander",
      "again",
    ]);
    const result = apply(content, initial, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(initial).toEqual(before);
    const caster = result.nextState.units.find((unit) => unit.id === "A3")!;
    expect(caster.spellIds).toEqual(command.spellIds);
    expect(caster.mp).toBe(9);
    expect(caster.stats).toEqual(
      initial.units.find((unit) => unit.id === "A3")!.stats,
    );
    expect(result.nextState.statuses).toEqual([]);
    expect(apply(content, createBattle(content), command)).toEqual(result);
    expect(apply(content, result.nextState, command).ok).toBe(false);
  });
  it.each([["summon-aniki"], ["missing"], ["teleport", "teleport"]])(
    "rejects unavailable or duplicate loadouts atomically: %s",
    (...spells) => {
      const state = createBattle(content);
      const before = structuredClone(state);
      expect(apply(content, state, training(state, spells)).ok).toBe(false);
      expect(state).toEqual(before);
    },
  );
  it("rejects wrong owners and unchanged loadouts", () => {
    const state = createBattle(content);
    for (const id of ["A31", "E2", "N1", "missing"])
      expect(apply(content, state, training(state, ["teleport"], id)).ok).toBe(
        false,
      );
    expect(
      apply(
        content,
        state,
        training(state, state.units.find((unit) => unit.id === "A3")!.spellIds),
      ).ok,
    ).toBe(false);
  });
  it("closes once tactical play begins, even if the player phase returns", () => {
    const initial = createBattle(content);
    const ended = apply(content, initial, phaseEndCommand(initial));
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(
      apply(content, ended.nextState, training(ended.nextState, ["teleport"]))
        .ok,
    ).toBe(false);
    const waited = apply(content, initial, {
      type: "act",
      commandId: "wait",
      expectedRevision: 0,
      unitId: "A2",
      path: [],
      action: { type: "wait" },
    });
    if (!waited.ok) throw Error(waited.error);
    expect(
      apply(content, waited.nextState, training(waited.nextState, ["teleport"]))
        .ok,
    ).toBe(false);
  });
});
