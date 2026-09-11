import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import { apply, evaluate } from "./commands";
import {
  createBattle,
  type BattleState,
  type PromoteCommand,
  type ReclassCommand,
  type Unit,
} from "./types";
import {
  classChangeOptions,
  classResetOption,
  commanderGrowth,
} from "./advancement";
import { effectiveUnit } from "./effective";
import { canStop } from "./movement";
import { inAttackRange } from "./combat";

function promoted(
  state: BattleState,
  classId: string,
  unitId = "A1",
): PromoteCommand {
  return {
    type: "promote",
    commandId: `promote-${state.revision}`,
    expectedRevision: state.revision,
    unitId,
    classId,
  };
}
function reset(state: BattleState, unitId = "A1"): ReclassCommand {
  return {
    type: "reclass",
    commandId: `reclass-${state.revision}`,
    expectedRevision: state.revision,
    unitId,
  };
}
function setLevel(state: BattleState, level: number, exp = 0, unitId = "A1") {
  for (const unit of [...state.units, ...state.progression.roster].filter(
    (entry) => entry.id === unitId,
  )) {
    unit.progression!.level = level;
    unit.progression!.exp = exp;
    unit.progression!.totalExp = (level - 1) * 100 + exp;
  }
}
function advance(
  state: BattleState,
  classId = "frontline-captain",
  unitId = "A1",
) {
  const result = apply(content, state, promoted(state, classId, unitId));
  if (!result.ok) throw new Error(result.error);
  return result.nextState;
}
function markVictory(state: BattleState) {
  state.outcome = {
    status: "victory",
    reason: "test settlement",
    round: state.round,
    bonuses: [],
  };
  state.progression.settlement = {
    scenarioId: content.scenario.id,
    outcome: "victory",
    duplicate: false,
    entries: [],
  };
}
function getUnit(state: BattleState, unitId = "A1"): Unit {
  return state.progression.roster.find((entry) => entry.id === unitId)!;
}

describe("S05 deterministic class advancement", () => {
  it("keeps the starting battle's stats and shows two locked alternatives below Lv10", () => {
    const state = createBattle(content);
    expect(state.units).toEqual(content.scenario.units);
    const before = structuredClone(state);
    const options = classChangeOptions(content, state, "A1");
    expect(options.map((option) => option.definition.id)).toEqual([
      "frontline-captain",
      "raider-lord",
    ]);
    expect(options.every((option) => option.reason?.includes("Lv10"))).toBe(
      true,
    );
    expect(options[0]!.after.command!.radius).toBe(4);
    expect(apply(content, state, promoted(state, "frontline-captain")).ok).toBe(
      false,
    );
    expect(state).toEqual(before);
  });

  it("commits the shared preview once, retains growth, and spends banked EXP without counting it twice", () => {
    const state = createBattle(content);
    setLevel(state, 10, 100);
    const original = structuredClone(getUnit(state));
    const before = structuredClone(state);
    const command = promoted(state, "frontline-captain");
    const option = classChangeOptions(content, state, "A1")[0]!;
    const preview = evaluate(content, state, command);
    expect(apply(content, state, command)).toEqual(preview);
    expect(state).toEqual(before);
    if (!preview.ok) throw new Error(preview.error);
    const unit = getUnit(preview.nextState);
    expect(unit).toEqual(option.nextUnit);
    expect(unit.progression).toMatchObject({
      classId: "frontline-captain",
      level: 2,
      exp: 0,
      totalExp: original.progression!.totalExp,
    });
    expect(unit.progression!.classHistory.at(-1)).toBe("frontline-captain");
    expect(unit.command!.radius).toBe(4);
    expect(preview.nextState.inventory).toEqual(state.inventory);
    expect(
      preview.nextState.units.find((entry) => entry.id === unit.id),
    ).toEqual(unit);
    expect(preview.events).toContainEqual({
      type: "classChanged",
      unitId: "A1",
      from: "lord",
      to: "frontline-captain",
      reset: false,
    });
    expect(preview.events).toContainEqual({
      type: "levelUp",
      unitId: "A1",
      from: 1,
      to: 2,
    });
    expect(apply(content, preview.nextState, command).ok).toBe(false);
    expect(
      apply(
        content,
        preview.nextState,
        promoted(preview.nextState, "raider-lord"),
      ).ok,
    ).toBe(false);
    expect(apply(content, createBattle(content), command).ok).toBe(false);
  });

  it("rejects out-of-tree, unknown, enemy, and mercenary promotion without mutation", () => {
    const state = createBattle(content);
    setLevel(state, 10);
    const before = structuredClone(state);
    for (const [classId, unitId] of [
      ["sky-knight", "A1"],
      ["missing", "A1"],
      ["frontline-captain", "A11"],
      ["frontline-captain", "E1"],
    ])
      expect(apply(content, state, promoted(state, classId!, unitId!)).ok).toBe(
        false,
      );
    expect(state).toEqual(before);
  });

  it("closes promotion during battle and defeat, but develops the persistent roster after victory", () => {
    let state = createBattle(content);
    setLevel(state, 10);
    const result = apply(content, state, {
      type: "act",
      commandId: "first",
      expectedRevision: 0,
      unitId: "A1",
      path: [],
      action: { type: "wait" },
    });
    if (!result.ok) throw new Error(result.error);
    state = result.nextState;
    expect(apply(content, state, promoted(state, "frontline-captain")).ok).toBe(
      false,
    );
    state.outcome = {
      status: "defeat",
      reason: "test defeat",
      round: 1,
      bonuses: [],
    };
    state.progression.settlement = {
      scenarioId: content.scenario.id,
      outcome: "defeat",
      duplicate: false,
      entries: [],
    };
    expect(apply(content, state, promoted(state, "frontline-captain")).ok).toBe(
      false,
    );
    markVictory(state);
    const battlefield = structuredClone(state.units);
    const next = advance(state);
    expect(next.units).toEqual(battlefield);
    expect(getUnit(next).progression!.classId).toBe("frontline-captain");
  });

  it("allows a fallen commander's retained roster to advance only after victory", () => {
    const state = createBattle(content);
    setLevel(state, 10);
    state.units = state.units.filter((entry) => entry.id !== "A1");
    expect(apply(content, state, promoted(state, "frontline-captain")).ok).toBe(
      false,
    );
    markVictory(state);
    const next = advance(state);
    expect(getUnit(next).progression!.classId).toBe("frontline-captain");
    expect(next.units.some((unit) => unit.id === "A1")).toBe(false);
  });

  it("learns the new class's first spells and retains the old formal and practice selections", () => {
    const state = createBattle(content);
    setLevel(state, 10, 0, "A3");
    const before = getUnit(state, "A3");
    before.spellIds.push("teleport");
    state.units.find((unit) => unit.id === "A3")!.spellIds.push("teleport");
    const next = advance(state, "elementalist", "A3");
    const after = getUnit(next, "A3");
    expect(after.spellIds).toEqual(expect.arrayContaining(before.spellIds));
    expect(after.progression!.learnedSpellIds).toEqual(
      expect.arrayContaining(before.progression!.learnedSpellIds),
    );
    const firstSpells = content.classes
      .find((job) => job.id === "elementalist")!
      .learns.filter((entry) => entry.level === 1)
      .flatMap((entry) => entry.spellIds);
    expect(after.progression!.learnedSpellIds).toEqual(
      expect.arrayContaining(firstSpells),
    );
    expect(new Set(after.progression!.learnedSpellIds).size).toBe(
      after.progression!.learnedSpellIds.length,
    );
  });

  it("preserves equipped MP proportion when banked growth raises capacity", () => {
    const state = createBattle(content);
    setLevel(state, 10, 100, "A3");
    for (const unit of [...state.units, ...state.progression.roster].filter(
      (entry) => entry.id === "A3",
    )) {
      unit.equipment = { weapon: "orb", armor: null };
      unit.mp = 7;
    }
    const oldUnit = getUnit(state, "A3");
    const oldMax = effectiveUnit(content, state, oldUnit).stats.maxMp;
    const next = advance(state, "elementalist", "A3");
    const unit = getUnit(next, "A3");
    const newMax = effectiveUnit(content, next, unit).stats.maxMp;
    expect(unit.mp).toBe(Math.floor((7 * newMax) / oldMax));
  });

  it("rejects new movement that cannot land on the current preparation tile atomically", () => {
    const custom = structuredClone(content);
    const job = custom.classes.find(
      (entry) => entry.id === "frontline-captain",
    )!;
    job.moveType = "mounted";
    const state = createBattle(custom);
    setLevel(state, 10);
    const unit = state.units.find((entry) => entry.id === "A1")!;
    const tileId =
      custom.scenario.tiles[unit.pos.y * custom.scenario.width + unit.pos.x]!;
    custom.terrains.find((tile) => tile.id === tileId)!.costs.mounted = null;
    const before = structuredClone(state);
    const option = classChangeOptions(custom, state, "A1")[0]!;
    expect(option.reason).toContain("현재 칸");
    expect(apply(custom, state, promoted(state, job.id)).ok).toBe(false);
    expect(state).toEqual(before);
  });

  it("automatically removes incompatible gear, returning its owned copy without consumption", () => {
    const custom = structuredClone(content);
    custom.items.find((item) => item.id === "knife")!.allowedUnitTypes = [
      "mage",
    ];
    custom.classes.find((job) => job.id === "elementalist")!.unitType =
      "infantry";
    const state = createBattle(custom);
    setLevel(state, 10, 0, "A3");
    for (const unit of [...state.units, ...state.progression.roster].filter(
      (entry) => entry.id === "A3",
    ))
      unit.equipment = { weapon: "knife", armor: null };
    const option = classChangeOptions(custom, state, "A3")[0]!;
    expect(option.unequippedItemIds).toEqual(["knife"]);
    const result = apply(custom, state, promoted(state, "elementalist", "A3"));
    if (!result.ok) throw new Error(result.error);
    expect(getUnit(result.nextState, "A3").equipment!.weapon).toBeNull();
    expect(result.nextState.inventory.knife).toBe(state.inventory.knife);
    expect(result.events).toContainEqual({
      type: "equipmentChanged",
      unitId: "A3",
      slot: "weapon",
      itemId: null,
    });
  });

  it("consumes one runestone at second-tier Lv10 and keeps earned stats and learning", () => {
    const state = createBattle(content);
    setLevel(state, 10);
    let advanced = advance(state);
    expect(classResetOption(content, advanced, "A1")!.reason).toContain("Lv10");
    expect(apply(content, advanced, reset(advanced)).ok).toBe(false);
    setLevel(advanced, 10, 100);
    const before = structuredClone(advanced);
    const unitBefore = getUnit(advanced);
    const result = apply(content, advanced, reset(advanced));
    if (!result.ok) throw new Error(result.error);
    expect(advanced).toEqual(before);
    advanced = result.nextState;
    const unit = getUnit(advanced);
    expect(unit.progression).toMatchObject({
      classId: "lord",
      level: 1,
      exp: 0,
      totalExp: unitBefore.progression!.totalExp,
    });
    for (const stat of ["at", "df", "mag", "res", "maxMp"] as const)
      expect(unit.stats[stat]).toBe(unitBefore.stats[stat]);
    expect(unit.progression!.learnedSpellIds).toEqual(
      unitBefore.progression!.learnedSpellIds,
    );
    expect(advanced.inventory.runestone).toBe(before.inventory.runestone! - 1);
    expect(result.events).toContainEqual({
      type: "classChanged",
      unitId: "A1",
      from: "frontline-captain",
      to: "lord",
      reset: true,
    });
    expect(apply(content, advanced, reset(advanced)).ok).toBe(false);
  });

  it("rejects missing rune stock and reports contribution totals from the core", () => {
    const state = createBattle(content);
    setLevel(state, 10);
    const advanced = advance(state);
    setLevel(advanced, 10);
    advanced.inventory.runestone = 0;
    const before = structuredClone(advanced);
    expect(classResetOption(content, advanced, "A1")!.reason).toContain(
      "룬스톤이 없습니다",
    );
    expect(apply(content, advanced, reset(advanced)).ok).toBe(false);
    expect(advanced).toEqual(before);
    state.progression.contributions.A1 = {
      damage: 20,
      kills: 60,
      retreats: 15,
      healing: 10,
      clear: 0,
    };
    expect(commanderGrowth(content, state, "A1")!.pendingExp).toBe(105);
  });
});

describe("S05 new class roles in the shared battle rules", () => {
  function branchState(baseClassId: string): BattleState {
    const state = createBattle(content);
    for (const unit of [...state.units, ...state.progression.roster].filter(
      (entry) => entry.id === "A1",
    )) {
      unit.progression!.baseClassId = baseClassId;
      unit.progression!.classId = baseClassId;
      unit.progression!.classHistory = [baseClassId];
      unit.progression!.level = 10;
    }
    return state;
  }

  it("sky and naval branches unlock landing across water while the mounted branch cannot", () => {
    const position = { x: 0, y: 0 };
    const custom = structuredClone(content);
    const water = custom.terrains.find(
      (tile) =>
        tile.costs.mounted === null &&
        tile.costs.flying !== null &&
        tile.costs.amphibious !== null &&
        !tile.noLanding,
    )!;
    expect(water).toBeDefined();
    custom.scenario.tiles[0] = water.id;
    for (const [baseId, classId, expected] of [
      ["knight", "sky-knight", true],
      ["knight", "heavy-knight", false],
      ["scout", "naval-captain", true],
    ] as const) {
      const state = branchState(baseId);
      const result = apply(custom, state, promoted(state, classId));
      if (!result.ok) throw new Error(result.error);
      expect(
        canStop(custom, result.nextState, getUnit(result.nextState), position),
      ).toBe(expected);
    }
  });

  it("longbow commanders gain ranged attacks and lose adjacent physical attacks", () => {
    const state = branchState("scout");
    const next = advance(state, "longbow-captain");
    const unit = getUnit(next);
    const adjacent = {
      ...unit,
      id: "target",
      pos: { x: unit.pos.x + 1, y: unit.pos.y },
    };
    const distant = { ...adjacent, pos: { x: unit.pos.x + 3, y: unit.pos.y } };
    expect(inAttackRange(unit, adjacent, content, next)).toBe(false);
    expect(inAttackRange(unit, distant, content, next)).toBe(true);
  });

  it("arcane commander resistance supports only that commander's living same-side mercenaries", () => {
    const state = createBattle(content);
    setLevel(state, 10, 0, "A3");
    const next = advance(state, "arcane-commander", "A3");
    const leader = next.units.find((entry) => entry.id === "A3")!;
    const follower = next.units.find(
      (entry) => entry.commanderId === leader.id,
    )!;
    const other = next.units.find((entry) => entry.commanderId === "A1")!;
    expect(effectiveUnit(content, next, follower).stats.res).toBe(
      follower.stats.res + 2,
    );
    expect(effectiveUnit(content, next, leader).stats.res).toBe(
      leader.stats.res,
    );
    expect(effectiveUnit(content, next, other).stats.res).toBe(other.stats.res);
    leader.side = "enemy";
    expect(effectiveUnit(content, next, follower).stats.res).toBe(
      follower.stats.res,
    );
  });
});
