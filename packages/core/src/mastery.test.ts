import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import { apply, evaluate } from "./commands";
import { createBattle, type BattleState, type Unit } from "./types";
import { gainExperience } from "./experience";
import { effectiveUnit } from "./effective";
import { stepCost } from "./movement";
import { damage } from "./combat";
import { hasMastery } from "./masteryEffects";
import { classChangeOptions, classResetOption } from "./advancement";

function setup(
  effect: NonNullable<typeof content.masteries>[number]["effect"],
) {
  const data = structuredClone(content);
  delete data.scenario.mission;
  const state = createBattle(data);
  const definition = data.masteries!.find((entry) => entry.effect === effect)!;
  const unit = state.units.find((entry) => entry.progression)!;
  unit.progression!.classId = definition.sourceClassId;
  unit.progression!.baseClassId = definition.sourceClassId;
  unit.progression!.classHistory = [definition.sourceClassId];
  unit.progression!.unlockedMasteryIds = [definition.id];
  unit.progression!.equippedMasteryId = definition.id;
  state.progression.roster = state.progression.roster.map((entry) =>
    entry.id === unit.id ? structuredClone(unit) : entry,
  );
  return { data, state, unit, definition };
}
function select(state: BattleState, unit: Unit, masteryId: string | null) {
  return {
    type: "mastery" as const,
    commandId: `mastery-${state.revision}`,
    expectedRevision: state.revision,
    unitId: unit.id,
    masteryId,
  };
}

describe("one-slot class masteries", () => {
  it("unlocks exactly at first-tier Lv10 without automatically equipping or repeating unlocks", () => {
    for (const definition of content.masteries!) {
      const { data, unit } = setup(definition.effect);
      unit.progression!.unlockedMasteryIds = [];
      unit.progression!.equippedMasteryId = null;
      unit.progression!.level = 9;
      unit.progression!.exp = 98;
      const below = gainExperience(data, unit, 1).unit;
      expect(below.progression!.unlockedMasteryIds).toEqual([]);
      const reached = gainExperience(data, below, 1).unit;
      expect(reached.progression!.unlockedMasteryIds).toEqual([definition.id]);
      expect(reached.progression!.equippedMasteryId).toBeNull();
      expect(
        gainExperience(data, reached, 500).unit.progression!.unlockedMasteryIds,
      ).toEqual([definition.id]);
      expect(unit.progression!.level).toBe(9);
    }
  });

  it("retains unlocked and equipped mastery through promotion and runestone reset", () => {
    const { data, state, unit, definition } = setup("defense");
    unit.progression!.level = 10;
    const option = classChangeOptions(data, state, unit.id)[0]!;
    expect(option.reason).toBeNull();
    expect(option.nextUnit.progression!.unlockedMasteryIds).toEqual([
      definition.id,
    ]);
    expect(option.nextUnit.progression!.equippedMasteryId).toBe(definition.id);
    option.nextUnit.progression!.level = 10;
    state.units = state.units.map((entry) =>
      entry.id === unit.id ? option.nextUnit : entry,
    );
    const reset = classResetOption(data, state, unit.id)!;
    expect(reset.nextUnit.progression!.unlockedMasteryIds).toEqual([
      definition.id,
    ]);
    expect(hasMastery(data, reset.nextUnit, "defense")).toBe(true);
  });

  it("clamps command radius and applies personal defense/resistance only to the commander", () => {
    for (const effect of ["command-radius", "defense", "resistance"] as const) {
      const { data, state, unit } = setup(effect);
      const bare = structuredClone(unit);
      bare.progression!.equippedMasteryId = null;
      const before = effectiveUnit(data, state, bare);
      const after = effectiveUnit(data, state, unit);
      if (effect === "command-radius") {
        expect(after.command!.radius).toBe(
          Math.min(4, before.command!.radius + 1),
        );
        unit.command!.radius = 4;
        expect(effectiveUnit(data, state, unit).command!.radius).toBe(4);
      } else {
        const stat = effect === "defense" ? "df" : "res";
        expect(after.stats[stat]).toBe(before.stats[stat] + 1);
        const merc = state.units.find(
          (entry) => entry.commanderId === unit.id,
        )!;
        expect(effectiveUnit(data, state, merc).stats[stat]).toBe(
          merc.stats[stat],
        );
      }
      expect(unit.stats).toEqual(bare.stats);
    }
  });

  it("changes MP proportionally without refilling by repeated equip/unequip", () => {
    const { data, state, unit, definition } = setup("mana");
    unit.stats.maxMp = 9;
    unit.mp = 4;
    unit.progression!.equippedMasteryId = null;
    const result = apply(data, state, select(state, unit, definition.id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changed = result.nextState.units.find(
      (entry) => entry.id === unit.id,
    )!;
    expect(changed.stats.maxMp).toBe(9);
    expect(effectiveUnit(data, result.nextState, changed).stats.maxMp).toBe(11);
    expect(changed.mp).toBe(4);
    const removed = apply(
      data,
      result.nextState,
      select(result.nextState, changed, null),
    );
    expect(removed.ok).toBe(true);
    if (removed.ok)
      expect(
        removed.nextState.units.find((entry) => entry.id === unit.id)!.mp,
      ).toBe(3);
    expect(state.units.find((entry) => entry.id === unit.id)!.mp).toBe(4);
  });

  it("reduces forest cost but does not make impassable or enemy-occupied terrain traversable", () => {
    const { data, state, unit } = setup("forest-move");
    const pos = { x: 1, y: 1 };
    data.scenario.tiles[pos.y * data.scenario.width + pos.x] = "forest";
    expect(stepCost(data, state, unit, pos)).toBe(1);
    const forest = data.terrains.find((entry) => entry.id === "forest")!;
    forest.costs[unit.moveType] = null;
    expect(stepCost(data, state, unit, pos)).toBeNull();
    forest.costs[unit.moveType] = 2;
    state.units.find((entry) => entry.side === "enemy")!.pos = pos;
    expect(stepCost(data, state, unit, pos)).toBeNull();
  });

  it("adds mana before equipment multiplication and never persists derived capacity", () => {
    const { data, state, unit } = setup("mana");
    const orb = data.items.find(
      (entry) => entry.modifiers.maxMpMultiplier === 2,
    )!;
    unit.equipment = { weapon: null, armor: null, [orb.slot]: orb.id };
    unit.stats.maxMp = 9;
    expect(effectiveUnit(data, state, unit).stats.maxMp).toBe(22);
    expect(unit.stats.maxMp).toBe(9);
  });

  it("grants charge only for the attacking command's three plain/road entered tiles", () => {
    const { data, state, unit } = setup("charge");
    const target = state.units.find((entry) => entry.side === "enemy")!;
    const path = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ];
    const plain = data.terrains.find((entry) =>
      entry.masteryTags?.includes("charge"),
    )!;
    for (const pos of [...path, target.pos])
      data.scenario.tiles[pos.y * data.scenario.width + pos.x] = plain.id;
    unit.pos = path[2]!;
    unit.unitType = target.unitType = "infantry";
    unit.stats.at = 7;
    target.stats.df = 4;
    unit.hp = target.hp = 10;
    const ordinary = damage(data, state, unit, target);
    expect(damage(data, state, unit, target, path)).toBe(ordinary + 1);
    expect(damage(data, state, unit, target, path.slice(1))).toBe(ordinary);
    state.terrainChanges["2,1"] = "forest";
    expect(damage(data, state, unit, target, path)).toBe(ordinary);
    expect(damage(data, state, unit, target)).toBe(ordinary);
  });

  it("rejects locked, duplicate and mid-battle selection without changing any state", () => {
    const { data, state, unit, definition } = setup("defense");
    const original = structuredClone(state);
    expect(evaluate(data, state, select(state, unit, definition.id)).ok).toBe(
      false,
    );
    expect(evaluate(data, state, select(state, unit, "missing")).ok).toBe(
      false,
    );
    expect(state).toEqual(original);
    unit.progression!.equippedMasteryId = null;
    unit.progression!.unlockedMasteryIds = [];
    const locked = structuredClone(state);
    expect(evaluate(data, state, select(state, unit, definition.id)).ok).toBe(
      false,
    );
    expect(state).toEqual(locked);
    unit.progression!.unlockedMasteryIds = [definition.id];
    state.round = 2;
    const started = structuredClone(state);
    expect(evaluate(data, state, select(state, unit, definition.id)).ok).toBe(
      false,
    );
    expect(state).toEqual(started);
  });
});
