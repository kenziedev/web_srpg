import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import { apply, createBattle, nextEnemyCommand } from "./index";

function fixture() {
  const data = structuredClone(content);
  data.spells = [
    {
      id: "arcane-bolt",
      name: "마력탄",
      mpCost: 3,
      range: [1, 3],
      shape: "single",
      effect: { type: "damage", power: 3 },
    },
    {
      id: "cross-flare",
      name: "십자 폭발",
      mpCost: 6,
      range: [1, 3],
      shape: "cross",
      effect: { type: "damage", power: 2 },
    },
  ];
  data.scenario.width = data.scenario.height = 7;
  data.scenario.tiles = Array<string>(49).fill("plain");
  delete data.scenario.mission;
  delete data.scenario.enemyPlans;
  data.scenario.reinforcement.units = [];
  const caster = structuredClone(
    data.scenario.units.find((u) => u.id === "A3")!,
  );
  caster.id = "caster";
  caster.side = "enemy";
  caster.pos = { x: 1, y: 2 };
  caster.hp = 10;
  caster.mp = 0;
  caster.spellIds = ["arcane-bolt"];
  caster.stats = { ...caster.stats, mag: 6, at: 0, move: 1, maxMp: 10 };
  const target = structuredClone(
    data.scenario.units.find((u) => u.id === "A1")!,
  );
  target.id = "target";
  target.pos = { x: 6, y: 6 };
  target.stats.at = 0;
  target.stats.res = 3;
  data.scenario.units = [caster, target];
  const state = createBattle(data);
  state.activeSide = "enemy";
  return { data, state, caster: state.units[0]!, target: state.units[1]! };
}

describe("S01 enemy magic recovery", () => {
  it("a healthy exhausted caster safely restores MP in place exactly once", () => {
    const { data, state, caster } = fixture();
    const before = structuredClone(state);
    const command = nextEnemyCommand(data, state);
    expect(command).toMatchObject({
      type: "act",
      path: [],
      action: { type: "treat" },
    });
    expect(nextEnemyCommand(data, state)).toEqual(command);
    expect(state).toEqual(before);
    const result = apply(data, state, command!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.nextState.units.find((unit) => unit.id === caster.id),
    ).toMatchObject({ hp: 10, mp: 2, pos: caster.pos, acted: true });
    expect(result.nextState.commands).toHaveLength(1);
    expect(nextEnemyCommand(data, result.nextState)).toMatchObject({
      type: "endPhase",
      side: "enemy",
    });
    expect(apply(data, result.nextState, command!).ok).toBe(false);
    expect(state).toEqual(before);
  });

  it("values a final one-MP recovery without exceeding the maximum", () => {
    const { data, state, caster } = fixture();
    caster.mp = 2;
    caster.stats.maxMp = 3;
    const command = nextEnemyCommand(data, state);
    expect(command).toMatchObject({ action: { type: "treat" } });
    const result = apply(data, state, command!);
    expect(result.ok && result.nextState.units[0]!.mp).toBe(3);
  });

  it("uses a decisive spell when MP is sufficient", () => {
    const { data, state, caster, target } = fixture();
    caster.mp = 3;
    target.pos = { x: 3, y: 2 };
    target.hp = 3;
    const command = nextEnemyCommand(data, state);
    expect(command).toMatchObject({
      action: { type: "cast", spellId: "arcane-bolt" },
    });
    const result = apply(data, state, command!);
    expect(result.ok && result.nextState.units.map((unit) => unit.id)).toEqual([
      caster.id,
    ]);
  });

  it("does not give up a decisive affordable spell to refill a more expensive one", () => {
    const { data, state, caster, target } = fixture();
    caster.spellIds.push("cross-flare");
    caster.mp = 3;
    target.pos = { x: 3, y: 2 };
    target.hp = 3;
    expect(nextEnemyCommand(data, state)).toMatchObject({
      action: { type: "cast", spellId: "arcane-bolt" },
    });
  });

  it("preserves noncaster decisions even when their MP pool is empty", () => {
    const { data, state, caster } = fixture();
    caster.spellIds = [];
    caster.stats.maxMp = 0;
    const withoutMp = nextEnemyCommand(data, state);
    caster.stats.maxMp = 10;
    expect(nextEnemyCommand(data, state)).toEqual(withoutMp);
    expect(withoutMp).toMatchObject({ action: { type: "wait" } });
  });

  it("does not repeatedly repair when learned spells exceed the maximum MP pool", () => {
    const { data, state, caster } = fixture();
    caster.spellIds = ["cross-flare"];
    caster.mp = caster.stats.maxMp = 3;
    expect(nextEnemyCommand(data, state)).toMatchObject({
      action: { type: "wait" },
    });
  });
});
