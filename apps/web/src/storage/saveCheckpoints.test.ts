import { describe, expect, it } from "vitest";
import { content } from "@orden/content";
import {
  apply,
  createBattle,
  type BattleState,
  type Command,
} from "@orden/core";
import { preparationCheckpoint } from "./saveCheckpoints";
import {
  checksumForSave,
  createSave,
  parseSave,
  serializeSave,
} from "./saveFormat";
import beaconClear from "../../../../packages/sim/fixtures/beacon-clear.json";

type Unstamped<T = Command> = T extends Command
  ? Omit<T, "commandId" | "expectedRevision">
  : never;

function execute(state: BattleState, command: Unstamped): BattleState {
  const result = apply(content, state, {
    ...command,
    commandId: `checkpoint-${state.revision}`,
    expectedRevision: state.revision,
  } as Command);
  if (!result.ok) throw new Error(result.error);
  return result.nextState;
}
function gear(state: BattleState, itemId: string) {
  return execute(state, {
    type: "equip",
    unitId: "A1",
    slot: "weapon",
    itemId,
  });
}
function wait(state: BattleState) {
  return execute(state, {
    type: "act",
    unitId: "A1",
    path: [],
    action: { type: "wait" },
  });
}

describe("preparation checkpoint retains a verified full command prefix", () => {
  it("recovers the untouched initial preparation when the first command immediately enters battle", () => {
    const initial = createBattle(content);
    const save = createSave(wait(initial));
    const before = structuredClone(save);
    const checkpoint = preparationCheckpoint(save)!;
    expect(checkpoint.battle).toEqual(initial);
    expect(checkpoint.commands).toEqual([]);
    expect(checkpoint.continuation.finishing).toBe(false);
    expect(parseSave(serializeSave(checkpoint))).toEqual(checkpoint);
    expect(save).toEqual(before);
  });

  it("keeps the last loadout before combat, discarding a pending automatic turn continuation", () => {
    const prepared = gear(gear(createBattle(content), "knife"), "great-sword");
    const setup = preparationCheckpoint(
      createSave(prepared, { finishing: true, autoFollow: true }),
    )!;
    expect(setup.battle).toEqual(prepared);
    expect(setup.continuation).toEqual({ finishing: false, autoFollow: true });
    const checkpoint = preparationCheckpoint(createSave(wait(prepared)))!;
    expect(checkpoint.battle).toEqual(prepared);
    expect(checkpoint.commands).toHaveLength(2);
    expect(checkpoint.updatedAt).toBe(setup.updatedAt);
    expect(
      checkpoint.battle.units.find((unit) => unit.id === "A1")!.equipment!
        .weapon,
    ).toBe("great-sword");
  });

  it("does not reuse a cached checkpoint from a different imported branch sharing command IDs", () => {
    const initial = createBattle(content);
    const first = gear(initial, "knife");
    const second = gear(initial, "great-sword");
    expect(first.commands[0]!.commandId).toBe(second.commands[0]!.commandId);
    preparationCheckpoint(createSave(wait(first)));
    const checkpoint = preparationCheckpoint(createSave(wait(second)))!;
    expect(checkpoint.battle).toEqual(second);
    expect(checkpoint.battle).not.toEqual(first);
  });

  it("retains victory rewards and all earlier commands when returning to a later sortie's preparation", () => {
    let won = createBattle(content);
    for (const command of beaconClear.commands as Command[]) {
      const result = apply(content, won, command);
      if (!result.ok) throw new Error(result.error);
      won = result.nextState;
    }
    expect(won.outcome?.status).toBe("victory");
    const deployed = execute(won, { type: "deploy" });
    const prepared = gear(deployed, "knife");
    const checkpoint = preparationCheckpoint(createSave(wait(prepared)))!;
    expect(checkpoint.battle).toEqual(prepared);
    expect(checkpoint.commands.slice(0, won.commands.length)).toEqual(
      won.commands,
    );
    expect(checkpoint.battle.progression.rewardedScenarioIds).toEqual(
      won.progression.rewardedScenarioIds,
    );
    expect(
      checkpoint.battle.progression.roster.map((unit) => unit.progression),
    ).toEqual(won.progression.roster.map((unit) => unit.progression));
    expect(checkpoint.initialState).toEqual(createBattle(content));
    expect(parseSave(serializeSave(checkpoint))).toEqual(checkpoint);
  });

  it("does not treat a forged growth snapshot as a new replay root", () => {
    const save = createSave(wait(gear(createBattle(content), "knife")));
    save.battle.progression.roster[0]!.progression!.level = 10;
    const { checksum: _checksum, ...body } = save;
    const forged = { ...body, checksum: checksumForSave(body) };
    expect(() => preparationCheckpoint(forged)).toThrow("재현 결과");
  });

  it("keeps operation shopping and hiring immediately before startBattle as the preparation checkpoint", () => {
    let prepared = createBattle(content, "operation");
    prepared = execute(prepared, { type: "buy", itemId: "knife", quantity: 1 });
    prepared = execute(prepared, {
      type: "hire",
      unitId: "A11",
      templateId: null,
    });
    const started = execute(prepared, { type: "startBattle" });
    expect(started.operation!.phase).toBe("battle");
    const save = createSave(started);
    const checkpoint = preparationCheckpoint(save)!;
    expect(checkpoint.battle).toEqual(prepared);
    expect(checkpoint.battle.mode).toBe("operation");
    expect(checkpoint.battle.operation!.phase).toBe("preparation");
    expect(checkpoint.battle.inventory.knife).toBe(1);
    expect(checkpoint.battle.operation!.hires.A11).toBeNull();
    expect(checkpoint.initialState).toEqual(createBattle(content, "operation"));
    expect(parseSave(serializeSave(checkpoint))).toEqual(checkpoint);
  });

  it("does not accept the other mode's initial state even when the checksum is recomputed", () => {
    const save = createSave(createBattle(content, "operation"));
    expect(parseSave(serializeSave(save)).battle.mode).toBe("operation");
    save.initialState = createBattle(content, "practice");
    const { checksum: _checksum, ...body } = save;
    expect(() =>
      preparationCheckpoint({ ...body, checksum: checksumForSave(body) }),
    ).toThrow("재현 결과");
  });
});
