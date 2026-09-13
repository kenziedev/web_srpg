import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import clear from "../../sim/fixtures/beacon-clear.json";
import { apply, evaluate } from "./commands";
import {
  createBattle,
  type BattleState,
  type Command,
  type Content,
} from "./types";
import { canPrepare } from "./equipment";
import { hireOptions, operationSummary, shopOptions } from "./operation";
import { savedBattleSchema } from "@orden/schema";

type Input = Command extends infer T
  ? T extends Command
    ? Omit<T, "commandId" | "expectedRevision">
    : never
  : never;
function command(state: BattleState, input: Input): Command {
  return {
    ...input,
    commandId: `operation-${state.revision}`,
    expectedRevision: state.revision,
  } as Command;
}
function run(
  state: BattleState,
  input: Input,
  data: Content = content,
): BattleState {
  const result = apply(data, state, command(state, input));
  if (!result.ok) throw Error(result.error);
  return result.nextState;
}
function started(state = createBattle(content, "operation")) {
  return run(state, { type: "startBattle" });
}
function won(state: BattleState): BattleState {
  for (const original of clear.commands as Command[]) {
    if (state.outcome) break;
    if (
      original.type === "act" &&
      !state.units.some((unit) => unit.id === original.unitId)
    )
      continue;
    let adjusted = original;
    if (original.type === "act" && original.action.type === "attack") {
      const id = original.action.targetId;
      if (!state.units.some((unit) => unit.id === id))
        adjusted = { ...original, action: { type: "wait" } };
    }
    state = run(state, adjusted);
  }
  expect(state.outcome?.status).toBe("victory");
  return state;
}
function lost(state: BattleState): BattleState {
  while (!state.outcome)
    state = run(state, { type: "endPhase", side: state.activeSide });
  expect(state.outcome.status).toBe("defeat");
  return state;
}

describe("S06 operation preparation and economy", () => {
  it("keeps practice canonical while an operation starts with funded, affordable original troops", () => {
    const practice = createBattle(content);
    const operation = createBattle(content, "operation");
    expect(practice.mode).toBe("practice");
    expect(practice.operation).toBeNull();
    expect(Object.keys(practice.inventory)).toHaveLength(34);
    expect(operation.units).toEqual(practice.units);
    expect(operation.inventory).toEqual({});
    expect(operationSummary(content, operation)).toMatchObject({
      phase: "preparation",
      equipmentFunds: 300,
      budget: 1200,
      spent: 1020,
      remaining: 180,
      startReason: null,
    });
    expect(savedBattleSchema.safeParse(practice).success).toBe(true);
    expect(savedBattleSchema.safeParse(operation).success).toBe(true);
  });
  it("requires an explicit sortie confirmation and closes every preparation command afterward", () => {
    const initial = createBattle(content, "operation");
    const snapshot = structuredClone(initial);
    for (const input of [
      { type: "act", unitId: "A1", path: [], action: { type: "wait" } },
      { type: "endPhase", side: "player" },
    ] as Input[])
      expect(apply(content, initial, command(initial, input)).ok).toBe(false);
    expect(initial).toEqual(snapshot);
    const state = started(initial);
    expect(canPrepare(state)).toBe(false);
    for (const input of [
      { type: "hire", unitId: "A11", templateId: null },
      { type: "buy", itemId: "knife", quantity: 1 },
      { type: "train", unitId: "A3", spellIds: [] },
      { type: "mastery", unitId: "A1", masteryId: "lord-mastery" },
      { type: "startBattle" },
    ] as Input[])
      expect(apply(content, state, command(state, input)).ok).toBe(false);
    expect(
      run(state, {
        type: "act",
        unitId: "A1",
        path: [],
        action: { type: "wait" },
      }).revision,
    ).toBe(2);
  });
  it("changes or cancels fixed-slot hires with a full pre-sortie refund and exact preview parity", () => {
    let state = createBattle(content, "operation");
    const original = structuredClone(state);
    const nextCommand = command(state, {
      type: "hire",
      unitId: "A11",
      templateId: "pike",
    });
    const preview = evaluate(content, state, nextCommand);
    expect(apply(content, state, nextCommand)).toEqual(preview);
    expect(state).toEqual(original);
    if (!preview.ok) throw Error(preview.error);
    state = preview.nextState;
    expect(state.units.find((unit) => unit.id === "A11")).toMatchObject({
      commanderId: "A1",
      unitType: "pike",
      pos: original.units.find((unit) => unit.id === "A11")!.pos,
      stats: { at: 8, df: 7 },
    });
    expect(operationSummary(content, state)!.spent).toBe(1030);
    state = run(state, { type: "hire", unitId: "A11", templateId: null });
    expect(state.units.some((unit) => unit.id === "A11")).toBe(false);
    expect(operationSummary(content, state)!.spent).toBe(920);
    state = run(state, { type: "hire", unitId: "A11", templateId: "infantry" });
    expect(operationSummary(content, state)!.spent).toBe(1020);
    expect(state.units.map((unit) => unit.id)).toEqual(
      original.units.map((unit) => unit.id),
    );
    expect(state.operation!.equipmentFunds).toBe(300);
  });
  it("rejects unknown, enemy, forbidden-class, over-budget, and unchanged hires without mutation", () => {
    const data = structuredClone(content);
    data.scenario.preparation!.operationBudget = 1020;
    const state = createBattle(data, "operation");
    const snapshot = structuredClone(state);
    for (const [unitId, templateId] of [
      ["E11", "infantry"],
      ["A11", "undead"],
      ["A11", "flier"],
      ["A11", "pike"],
      ["A11", "infantry"],
    ])
      expect(
        apply(
          data,
          state,
          command(state, {
            type: "hire",
            unitId: unitId!,
            templateId: templateId!,
          }),
        ).ok,
      ).toBe(false);
    expect(state).toEqual(snapshot);
    expect(
      hireOptions(data, state, "A11").find(
        (entry) => entry.template.id === "pike",
      )!.reason,
    ).toContain("작전비");
  });
  it("makes a paid item available for equipment and sells only unworn copies at the listed price", () => {
    let state = run(createBattle(content, "operation"), {
      type: "buy",
      itemId: "knife",
      quantity: 2,
    });
    expect(state.inventory.knife).toBe(2);
    expect(state.operation!.equipmentFunds).toBe(200);
    state = run(state, {
      type: "equip",
      unitId: "A1",
      slot: "weapon",
      itemId: "knife",
    });
    const before = structuredClone(state);
    expect(
      apply(
        content,
        state,
        command(state, { type: "sell", itemId: "knife", quantity: 2 }),
      ).ok,
    ).toBe(false);
    expect(state).toEqual(before);
    expect(
      shopOptions(content, state).find((entry) => entry.item.id === "knife"),
    ).toMatchObject({ owned: 2, available: 1, buyPrice: 50, sellPrice: 25 });
    state = run(state, { type: "sell", itemId: "knife", quantity: 1 });
    expect(state.inventory.knife).toBe(1);
    expect(state.operation!.equipmentFunds).toBe(225);
    expect(
      apply(
        content,
        state,
        command(state, { type: "sell", itemId: "knife", quantity: 1 }),
      ).ok,
    ).toBe(false);
  });
  it("rejects fractional/negative trades, unaffordable items, missing stock and practice economy commands", () => {
    const state = createBattle(content, "operation");
    const before = structuredClone(state);
    for (const input of [
      { type: "buy", itemId: "knife", quantity: 0 },
      { type: "buy", itemId: "knife", quantity: 0.5 },
      { type: "buy", itemId: "orb", quantity: 1 },
      { type: "buy", itemId: "langrisser", quantity: 1 },
      { type: "sell", itemId: "knife", quantity: 1 },
    ] as Input[])
      expect(apply(content, state, command(state, input)).ok).toBe(false);
    expect(state).toEqual(before);
    const practice = createBattle(content);
    for (const input of [
      { type: "buy", itemId: "knife", quantity: 1 },
      { type: "hire", unitId: "A11", templateId: null },
      { type: "startBattle" },
    ] as Input[])
      expect(apply(content, practice, command(practice, input)).ok).toBe(false);
  });
  it("limits operation spell loadouts to genuinely learned magic while retaining the practice laboratory", () => {
    const operation = createBattle(content, "operation");
    const input: Input = { type: "train", unitId: "A3", spellIds: ["meteor"] };
    expect(apply(content, operation, command(operation, input)).ok).toBe(false);
    expect(
      run(operation, {
        type: "train",
        unitId: "A3",
        spellIds: ["heal-1"],
      }).units.find((unit) => unit.id === "A3")!.spellIds,
    ).toEqual(["heal-1"]);
    expect(
      run(createBattle(content), input).units.find((unit) => unit.id === "A3")!
        .spellIds,
    ).toEqual(["meteor"]);
  });
  it("rolls a lost sortie back to the preparation-entry inventory, funds, hiring and growth checkpoint", () => {
    const initial = createBattle(content, "operation");
    let state = run(initial, { type: "buy", itemId: "knife", quantity: 2 });
    state = run(state, { type: "sell", itemId: "knife", quantity: 1 });
    state = run(state, {
      type: "equip",
      unitId: "A1",
      slot: "weapon",
      itemId: "knife",
    });
    state = run(state, { type: "hire", unitId: "A11", templateId: "pike" });
    const defeat = lost(started(state));
    expect(defeat.operation!.settlement).toMatchObject({
      firstClear: false,
      equipmentFunds: 0,
      support: 0,
      items: {},
      contracts: [],
    });
    const next = run(defeat, { type: "deploy" });
    expect(next.inventory).toEqual(initial.inventory);
    expect(next.operation).toEqual(initial.operation);
    expect(next.progression.roster).toEqual(initial.progression.roster);
    expect(next.units).toEqual(initial.units);
    expect(next.progression.rewardedScenarioIds).toEqual([]);
  });
  it("pays first-clear rewards once, discounts only matching survivor contracts and preserves everything across loss/retry", () => {
    const bought = run(createBattle(content, "operation"), {
      type: "buy",
      itemId: "knife",
      quantity: 2,
    });
    const victory = won(started(bought));
    expect(victory.operation!.settlement).toMatchObject({
      firstClear: true,
      equipmentFunds: 400,
      support: 200,
      items: { "small-shield": 1 },
    });
    expect(victory.operation!.equipmentFunds).toBe(600);
    expect(victory.inventory).toEqual({ knife: 2, "small-shield": 1 });
    const practice = run(victory, { type: "deploy" });
    expect(operationSummary(content, practice)).toMatchObject({
      budget: 1400,
      spent: 816,
      pendingSupport: 0,
    });
    expect(
      hireOptions(content, practice, "A11").find(
        (entry) => entry.template.id === "pike",
      ),
    ).toMatchObject({ cost: 110, discounted: false });
    const defeat = lost(started(practice));
    const restored = run(defeat, { type: "deploy" });
    expect(restored.operation).toEqual(practice.operation);
    expect(restored.inventory).toEqual(victory.inventory);
    expect(restored.progression.roster.map((unit) => unit.progression)).toEqual(
      victory.progression.roster.map((unit) => unit.progression),
    );
    const duplicate = won(started(restored));
    expect(duplicate.operation!.settlement).toMatchObject({
      firstClear: false,
      equipmentFunds: 0,
      support: 0,
      items: {},
    });
    expect(duplicate.operation!.equipmentFunds).toBe(
      victory.operation!.equipmentFunds,
    );
    expect(duplicate.inventory).toEqual(victory.inventory);
    expect(
      duplicate.progression.settlement!.entries.every(
        (entry) => entry.awardedExp === 0,
      ),
    ).toBe(true);
    let replay = createBattle(content, "operation");
    for (const entry of JSON.parse(
      JSON.stringify(duplicate.commands),
    ) as Command[]) {
      const result = apply(content, replay, entry);
      if (!result.ok) throw Error(result.error);
      replay = result.nextState;
    }
    expect(replay).toEqual(duplicate);
    expect(savedBattleSchema.safeParse(duplicate).success).toBe(true);
  });
  it("excludes living troops that retreated with their defeated commander from the next contract", () => {
    const data = structuredClone(content);
    data.scenario.units.find((unit) => unit.id === "E1")!.pos = { x: 7, y: 10 };
    data.scenario.units.find((unit) => unit.id === "E1")!.stats.at = 40;
    data.scenario.units.find((unit) => unit.id === "A2")!.hp = 1;
    data.scenario.units.find((unit) => unit.id === "N1")!.pos = {
      x: 18,
      y: 11,
    };
    data.scenario.mission!.route = [
      { x: 18, y: 11 },
      { x: 19, y: 11 },
    ];
    let state = run(
      createBattle(data, "operation"),
      { type: "startBattle" },
      data,
    );
    state = run(state, { type: "endPhase", side: "player" }, data);
    state = run(
      state,
      {
        type: "act",
        unitId: "E1",
        path: [],
        action: { type: "attack", targetId: "A2" },
      },
      data,
    );
    expect(
      state.units.some((unit) => unit.id === "A2" || unit.commanderId === "A2"),
    ).toBe(false);
    state = run(state, { type: "endPhase", side: "enemy" }, data);
    expect(state.outcome?.status).toBe("victory");
    expect(state.operation!.settlement!.contracts).toEqual([
      { commanderId: "A1", templateId: "infantry", count: 3 },
      { commanderId: "A3", templateId: "archer", count: 3 },
    ]);
  });
});
