import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import {
  apply,
  createBattle,
  evaluate,
  knownSpells,
  nextEnemyCommand,
  previewSpell,
  spellArea,
  spellTargetTiles,
  type ActCommand,
  type BattleState,
  type Content,
  type Position,
  type Unit,
} from "./index";

function fixture() {
  const data = structuredClone(content);
  // These generic shapes remain supported independently of the active catalog.
  data.spells = [
    {
      id: "heal",
      name: "회복",
      mpCost: 3,
      range: [0, 3],
      shape: "single",
      effect: { type: "heal", power: 3 },
    },
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
  caster.pos = { x: 1, y: 2 };
  caster.spellIds = ["heal", "arcane-bolt", "cross-flare"];
  caster.stats.mag = 6;
  caster.mp = caster.stats.maxMp = 10;
  const target = structuredClone(
    data.scenario.units.find((u) => u.id === "E2")!,
  );
  target.id = "target";
  target.pos = { x: 3, y: 2 };
  target.stats.res = 3;
  data.scenario.units = [caster, target];
  const state = createBattle(data);
  return { data, state, caster: state.units[0]!, target: state.units[1]! };
}

const cast = (
  spellId = "arcane-bolt",
  target: Position = { x: 3, y: 2 },
  overrides: Partial<ActCommand> = {},
): ActCommand => ({
  type: "act",
  commandId: "spell-1",
  expectedRevision: 0,
  unitId: "caster",
  path: [],
  action: { type: "cast", spellId, target },
  ...overrides,
});

function amount(data: Content, state: BattleState, caster: Unit, target: Unit) {
  const preview = previewSpell(data, state, caster, "arcane-bolt", target.pos);
  if (!preview.ok) throw Error(preview.error);
  return preview.targets[0]!.amount;
}

describe("S01 / combat-rules section 6: data-defined magic", () => {
  it.each([
    [6, 3, 10, 3],
    [5, 3, 10, 3],
    [4, 3, 10, 2],
    [6, 20, 10, 0],
    [30, 0, 10, 10],
    [6, 3, 1, 1],
  ])(
    "MAG %i, RES %i, HP %i predicts an actual loss of %i",
    (mag, res, hp, expected) => {
      const { data, state, caster, target } = fixture();
      caster.stats.mag = mag;
      target.stats.res = res;
      target.hp = hp;
      expect(amount(data, state, caster, target)).toBe(expected);
    },
  );

  it("magic ignores physical stats, affinities, terrain defense, command bonuses and caster HP", () => {
    const { data, state, caster, target } = fixture();
    const baseline = amount(data, state, caster, target);
    caster.hp = 1;
    caster.stats.at = 99;
    target.stats.df = 99;
    caster.unitType = "cleric";
    target.unitType = "undead";
    target.command = { radius: 99, at: 99, df: 99 };
    data.scenario.tiles[target.pos.y * 7 + target.pos.x] = "forest";
    expect(amount(data, state, caster, target)).toBe(baseline);
    const result = apply(data, state, cast());
    expect(result.ok && result.events).toContainEqual({
      type: "damaged",
      unitId: target.id,
      amount: 3,
    });
  });

  it("a melee-range spell never counterattacks and spends MP exactly once", () => {
    const { data, state, caster, target } = fixture();
    target.pos = { x: 2, y: 2 };
    target.stats.at = 99;
    const result = apply(data, state, cast("arcane-bolt", target.pos));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.nextState.units.find((u) => u.id === caster.id),
    ).toMatchObject({ hp: 10, mp: 7, acted: true });
    expect(result.events.filter((event) => event.type === "damaged")).toEqual([
      { type: "damaged", unitId: target.id, amount: 3 },
    ]);
    expect(result.events).toContainEqual({
      type: "spellCast",
      unitId: caster.id,
      spellId: "arcane-bolt",
      center: target.pos,
      affectedIds: [target.id],
    });
  });

  it("range display includes both boundaries, clips cross areas and allows wall centers", () => {
    const { data, state, caster, target } = fixture();
    const bolt = knownSpells(data, caster).find(
      (spell) => spell.id === "arcane-bolt",
    )!;
    const cross = knownSpells(data, caster).find(
      (spell) => spell.id === "cross-flare",
    )!;
    const tiles = spellTargetTiles(data, caster, bolt);
    expect(tiles).not.toContainEqual(caster.pos);
    expect(tiles).toContainEqual({ x: 4, y: 2 });
    expect(tiles).not.toContainEqual({ x: 5, y: 2 });
    expect(spellArea(data, cross, { x: 0, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
    // Spell targeting does not inherit movement or line-of-sight restrictions.
    data.scenario.tiles[2 * 7 + 2] = "wall";
    expect(
      previewSpell(data, state, caster, cross.id, { x: 2, y: 2 }),
    ).toMatchObject({
      ok: true,
      targets: [{ unitId: target.id, amount: 2 }],
    });
  });

  it("an empty cross center damages every enemy once, including outside center range, but excludes allied NPCs", () => {
    const { data, state, caster, target } = fixture();
    const center = { x: 4, y: 2 };
    const second = {
      ...structuredClone(target),
      id: "second",
      pos: { x: 5, y: 2 },
    };
    const ally = {
      ...structuredClone(caster),
      id: "ally",
      pos: { x: 4, y: 1 },
    };
    const npc = {
      ...structuredClone(caster),
      id: "npc",
      side: "npc" as const,
      pos: { x: 4, y: 3 },
    };
    state.units.push(second, ally, npc);
    const preview = previewSpell(data, state, caster, "cross-flare", center);
    expect(preview).toMatchObject({
      ok: true,
      targets: [
        { unitId: target.id, amount: 2 },
        { unitId: second.id, amount: 2 },
      ],
    });
    const result = apply(data, state, cast("cross-flare", center));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextState.units.map((u) => [u.id, u.hp, u.mp])).toEqual([
      ["caster", 10, 4],
      ["target", 8, target.mp],
      ["second", 8, second.mp],
      ["ally", 10, 10],
      ["npc", 10, 10],
    ]);
  });

  it("applies all area damage before commander defeat retreats surviving troops", () => {
    const { data, state, target } = fixture();
    target.hp = 2;
    const defeated = {
      ...structuredClone(target),
      id: "defeated-follower",
      kind: "mercenary" as const,
      commanderId: target.id,
      pos: { x: 3, y: 1 },
    };
    const survivor = {
      ...structuredClone(defeated),
      id: "retreated-follower",
      hp: 9,
      pos: { x: 4, y: 2 },
    };
    state.units.push(defeated, survivor);
    const result = apply(data, state, cast("cross-flare"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextState.units.map((u) => u.id)).toEqual(["caster"]);
    expect(result.events.filter((event) => event.type === "damaged")).toEqual([
      { type: "damaged", unitId: target.id, amount: 2 },
      { type: "damaged", unitId: defeated.id, amount: 2 },
      { type: "damaged", unitId: survivor.id, amount: 2 },
    ]);
    expect(result.events.filter((event) => event.type === "removed")).toEqual([
      { type: "removed", unitId: target.id, reason: "defeated" },
      { type: "removed", unitId: defeated.id, reason: "defeated" },
      { type: "removed", unitId: survivor.id, reason: "retreated" },
    ]);
    expect(
      result.events.findIndex((event) => event.type === "removed"),
    ).toBeGreaterThan(
      result.events.map((event) => event.type).lastIndexOf("damaged"),
    );
  });

  it("a lethal enemy spell resolves protected-unit defeat immediately", () => {
    const { data, state, caster, target } = fixture();
    state.activeSide = caster.side = "enemy";
    target.side = "player";
    target.hp = 1;
    data.scenario.mission = {
      protectedIds: [target.id],
      escortId: "missing-escort",
      route: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      escapeTiming: "immediate",
      captureTiming: "roundEnd",
      maxRounds: 12,
      bonusDeadline: 3,
      healthyEscapeHp: 6,
      beacon: { x: 6, y: 6 },
      unitLimit: 25,
    };
    const result = apply(data, state, cast());
    expect(result.ok && result.nextState.outcome).toMatchObject({
      status: "defeat",
      round: 1,
    });
  });

  it("supports moving then self-healing, allied NPC healing and content-defined heal amounts", () => {
    const { data, state, caster, target } = fixture();
    caster.hp = 8;
    const origin = { x: 1, y: 3 };
    const preview = previewSpell(data, state, caster, "heal", origin, origin);
    expect(preview).toMatchObject({
      ok: true,
      targets: [{ unitId: caster.id, amount: 2 }],
    });
    const result = apply(data, state, cast("heal", origin, { path: [origin] }));
    expect(result.ok && result.nextState.units[0]).toMatchObject({
      pos: origin,
      hp: 10,
      mp: 7,
    });
    target.side = "npc";
    target.hp = 5;
    data.spells.find((spell) => spell.id === "heal")!.effect.power = 4;
    expect(previewSpell(data, state, caster, "heal", target.pos)).toMatchObject(
      {
        ok: true,
        targets: [{ unitId: target.id, amount: 4 }],
      },
    );
  });

  it("legacy heal commands use the first learned healing spell without a hardcoded ID or price", () => {
    const { data, state, caster, target } = fixture();
    const heal = data.spells.find((spell) => spell.id === "heal")!;
    heal.id = "custom-restore";
    heal.mpCost = 2;
    heal.effect.power = 4;
    caster.spellIds = ["arcane-bolt", heal.id];
    target.side = "npc";
    target.hp = 4;
    const result = apply(
      data,
      state,
      cast("", target.pos, { action: { type: "heal", targetId: target.id } }),
    );
    expect(result.ok && result.nextState.units[0]!.mp).toBe(8);
    expect(result.ok && result.nextState.units[1]!.hp).toBe(8);
  });

  it.each([
    [
      "unknown spell",
      (state: BattleState) => {
        state.units[0]!.spellIds = [];
      },
      cast(),
    ],
    [
      "noncommander",
      (state: BattleState) => {
        state.units[0]!.kind = "mercenary";
      },
      cast(),
    ],
    [
      "insufficient MP",
      (state: BattleState) => {
        state.units[0]!.mp = 2;
      },
      cast(),
    ],
    ["zero range", () => {}, cast("arcane-bolt", { x: 1, y: 2 })],
    ["above maximum range", () => {}, cast("cross-flare", { x: 6, y: 2 })],
    ["outside map", () => {}, cast("cross-flare", { x: -1, y: 2 })],
    ["fractional center", () => {}, cast("cross-flare", { x: 2.5, y: 2 })],
    ["no affected targets", () => {}, cast("cross-flare", { x: 1, y: 0 })],
    ["hostile heal", () => {}, cast("heal")],
    ["full-health heal", () => {}, cast("heal", { x: 1, y: 2 })],
    [
      "stale command",
      () => {},
      cast("arcane-bolt", { x: 3, y: 2 }, { expectedRevision: 8 }),
    ],
    [
      "blocked movement",
      () => {},
      cast("arcane-bolt", { x: 3, y: 2 }, { path: [{ x: 3, y: 2 }] }),
    ],
  ])(
    "rejected %s preserves every state field and command log",
    (_name, setup, command) => {
      const { data, state } = fixture();
      setup(state);
      const before = structuredClone(state);
      expect(evaluate(data, state, command).ok).toBe(false);
      expect(apply(data, state, command).ok).toBe(false);
      expect(state).toEqual(before);
    },
  );

  it("preview, execution and a JSON command-log replay produce identical results", () => {
    const { data, state, caster, target } = fixture();
    const before = structuredClone(state);
    const preview = previewSpell(
      data,
      state,
      caster,
      "arcane-bolt",
      target.pos,
    );
    const evaluated = evaluate(data, state, cast());
    const applied = apply(data, state, cast());
    expect(applied).toEqual(evaluated);
    expect(state).toEqual(before);
    if (!applied.ok || !preview.ok) throw Error("Expected valid spell");
    expect(applied.events.filter((event) => event.type === "damaged")).toEqual(
      preview.targets.map((target) => ({ type: "damaged", ...target })),
    );
    let replay = structuredClone(before);
    for (const command of JSON.parse(
      JSON.stringify(applied.nextState.commands),
    )) {
      const result = apply(data, replay, command);
      if (!result.ok) throw Error(result.error);
      replay = result.nextState;
    }
    expect(replay).toEqual(applied.nextState);
    expect(
      apply(
        data,
        replay,
        cast("arcane-bolt", target.pos, { expectedRevision: 1 }),
      ).ok,
    ).toBe(false);
  });

  it("enemy casters choose a deterministic legal offensive spell without mutating inputs", () => {
    const { data, state, caster, target } = fixture();
    state.activeSide = caster.side = "enemy";
    caster.stats.at = 0;
    caster.stats.move = 1;
    target.side = "player";
    target.hp = 3;
    target.stats.at = 0;
    const before = structuredClone(state);
    const command = nextEnemyCommand(data, state);
    expect(command).toMatchObject({
      type: "act",
      action: { type: "cast", spellId: "arcane-bolt" },
    });
    expect(nextEnemyCommand(data, state)).toEqual(command);
    expect(state).toEqual(before);
    const result = apply(data, state, command!);
    expect(result.ok && result.nextState.units.map((u) => u.id)).not.toContain(
      target.id,
    );
  });

  it("enemy casters prioritize an endangered allied commander and avoid invalid full-health heals", () => {
    const { data, state, caster, target } = fixture();
    state.activeSide = caster.side = "enemy";
    caster.spellIds = ["heal"];
    caster.stats.at = 0;
    caster.stats.move = 1;
    target.side = "player";
    target.pos = { x: 6, y: 6 };
    const ally = {
      ...structuredClone(caster),
      id: "wounded",
      hp: 1,
      acted: true,
      pos: { x: 2, y: 2 },
    };
    state.units.push(ally);
    const command = nextEnemyCommand(data, state);
    expect(command).toMatchObject({
      type: "act",
      action: { type: "cast", spellId: "heal", target: ally.pos },
    });
    expect(command && apply(data, state, command).ok).toBe(true);
    ally.hp = 10;
    expect(nextEnemyCommand(data, state)).toMatchObject({
      type: "act",
      action: { type: "wait" },
    });
  });
});
