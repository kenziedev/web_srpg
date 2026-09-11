import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import {
  apply,
  createBattle,
  nextEnemyCommand,
  previewSpell,
  spellArea,
  spellTargetTiles,
  type ActCommand,
  type Unit,
} from "./index";

function fixture() {
  const data = structuredClone(content);
  data.scenario.width = data.scenario.height = 9;
  data.scenario.tiles = Array<string>(81).fill("plain");
  delete data.scenario.mission;
  delete data.scenario.enemyPlans;
  data.scenario.reinforcement.units = [];
  const caster = structuredClone(
    data.scenario.units.find((u) => u.id === "A3")!,
  );
  caster.id = "caster";
  caster.pos = { x: 2, y: 4 };
  caster.spellIds = data.spells.map((spell) => spell.id);
  caster.stats.mag = 6;
  caster.mp = caster.stats.maxMp = 30;
  const leader = structuredClone(
    data.scenario.units.find((u) => u.id === "E2")!,
  );
  leader.id = "enemy-leader";
  leader.pos = { x: 4, y: 4 };
  leader.stats.res = 3;
  const follower: Unit = {
    ...structuredClone(leader),
    id: "enemy-follower",
    kind: "mercenary",
    commanderId: leader.id,
    command: null,
    pos: { x: 8, y: 8 },
  };
  data.scenario.units = [caster, leader, follower];
  const state = createBattle(data);
  return {
    data,
    state,
    caster: state.units[0]!,
    leader: state.units[1]!,
    follower: state.units[2]!,
  };
}

function cast(
  spellId: string,
  target: Unit["pos"],
  path: Unit["pos"][] = [],
): ActCommand {
  return {
    type: "act",
    commandId: "classic-1",
    expectedRevision: 0,
    unitId: "caster",
    path,
    action: { type: "cast", spellId, target },
  };
}

describe("S01b classic PC spell families with explicit engine adaptations", () => {
  it("legacy heal requires an allied unit anchor while generic area healing may center on an enemy", () => {
    const { data, state, caster, leader } = fixture();
    caster.pos = { x: 2, y: 2 };
    caster.hp = 5;
    leader.pos = { x: 3, y: 2 };
    const before = structuredClone(state);
    const command = cast("heal-1", leader.pos);
    expect(
      apply(data, state, {
        ...command,
        action: { type: "heal", targetId: leader.id },
      }).ok,
    ).toBe(false);
    expect(state).toEqual(before);
    const result = apply(data, state, command);
    expect(result.ok && result.nextState.units[0]).toMatchObject({
      hp: 8,
      mp: 28,
    });
    expect(state).toEqual(before);
  });

  it("clips Manhattan radius areas at map corners and bounds enumeration by the map", () => {
    const { data, state, caster, leader } = fixture();
    const spell = data.spells.find((item) => item.id === "fireball")!;
    caster.pos = { x: 0, y: 0 };
    leader.pos = { x: 3, y: 0 };
    const area = spellArea(data, spell, caster.pos);
    expect(area).toHaveLength(10);
    expect(area).toContainEqual({ x: 3, y: 0 });
    expect(area).not.toContainEqual({ x: 2, y: 2 });
    expect(
      previewSpell(data, state, caster, spell.id, caster.pos),
    ).toMatchObject({ ok: true, targets: [{ unitId: leader.id, amount: 2 }] });
    spell.radius = 1_000_000;
    expect(spellArea(data, spell, caster.pos)).toHaveLength(81);
  });

  it("Thunder targets a selected commander's distant followers but excludes independent commanders and orphans", () => {
    const { data, state, caster, leader, follower } = fixture();
    state.units.push(
      { ...structuredClone(leader), id: "independent", pos: { x: 4, y: 5 } },
      {
        ...structuredClone(follower),
        id: "orphan",
        commanderId: null,
        pos: { x: 5, y: 4 },
      },
      {
        ...structuredClone(follower),
        id: "wrong-side",
        side: "player",
        pos: { x: 5, y: 5 },
      },
    );
    const before = structuredClone(state);
    const preview = previewSpell(data, state, caster, "thunder", leader.pos);
    expect(preview).toMatchObject({
      ok: true,
      targets: [
        { unitId: leader.id, amount: 3 },
        { unitId: follower.id, amount: 3 },
      ],
    });
    expect(preview.ok && preview.tiles).toEqual([leader.pos, follower.pos]);
    const result = apply(data, state, cast("thunder", leader.pos));
    expect(result.ok && result.nextState.units[0]!.mp).toBe(26);
    expect(
      result.ok && result.events.filter((event) => event.type === "damaged"),
    ).toHaveLength(2);
    expect(state).toEqual(before);
  });

  it("selecting a follower includes its distant commander, while an unaffiliated unit stays a singleton", () => {
    const { data, state, caster, leader, follower } = fixture();
    leader.pos = { x: 8, y: 8 };
    follower.pos = { x: 4, y: 4 };
    expect(
      previewSpell(data, state, caster, "thunder", follower.pos),
    ).toMatchObject({
      ok: true,
      targets: [
        { unitId: leader.id, amount: 3 },
        { unitId: follower.id, amount: 3 },
      ],
    });
    follower.commanderId = null;
    expect(
      previewSpell(data, state, caster, "thunder", follower.pos),
    ).toMatchObject({
      ok: true,
      targets: [{ unitId: follower.id, amount: 3 }],
    });
  });

  it("Force Heal uses the selected squad even when its selected commander is at full HP", () => {
    const { data, state, caster, leader, follower } = fixture();
    leader.side = follower.side = "player";
    follower.hp = 2;
    const partial = previewSpell(
      data,
      state,
      caster,
      "force-heal-1",
      leader.pos,
    );
    const full = previewSpell(data, state, caster, "force-heal-2", leader.pos);
    expect(partial).toMatchObject({
      ok: true,
      targets: [{ unitId: follower.id, amount: 3 }],
    });
    expect(full).toMatchObject({
      ok: true,
      targets: [{ unitId: follower.id, amount: 8 }],
    });
    const result = apply(data, state, cast("force-heal-2", leader.pos));
    expect(
      result.ok &&
        result.nextState.units.find((unit) => unit.id === follower.id)!.hp,
    ).toBe(10);
    expect(result.ok && result.nextState.units[0]!.mp).toBe(24);
  });

  it("NPC squad targets never collect unrelated NPCs or player commanders", () => {
    const { data, state, caster, leader, follower } = fixture();
    leader.side = "npc";
    leader.kind = "escort";
    leader.hp = 4;
    follower.side = "npc";
    follower.hp = 1;
    caster.hp = 2;
    expect(
      previewSpell(data, state, caster, "force-heal-1", leader.pos),
    ).toMatchObject({
      ok: true,
      tiles: [leader.pos],
      targets: [{ unitId: leader.id, amount: 3 }],
    });
  });

  it("rejects hostile squad healing, allied Thunder centers and empty squad centers atomically", () => {
    const { data, state, caster, leader } = fixture();
    const before = structuredClone(state);
    for (const command of [
      cast("force-heal-1", leader.pos),
      cast("thunder", caster.pos),
      cast("thunder", { x: 3, y: 4 }),
    ])
      expect(apply(data, state, command).ok).toBe(false);
    expect(state).toEqual(before);
  });

  it("self-centered Blizzard follows temporary movement and cannot select another center", () => {
    const { data, state, caster, leader } = fixture();
    leader.pos = { x: 7, y: 4 };
    const origin = { x: 3, y: 4 };
    const spell = data.spells.find((item) => item.id === "blizzard")!;
    expect(spellTargetTiles(data, caster, spell, origin)).toEqual([origin]);
    expect(
      previewSpell(data, state, caster, spell.id, origin, origin),
    ).toMatchObject({ ok: true, targets: [{ unitId: leader.id, amount: 2 }] });
    expect(
      previewSpell(data, state, caster, spell.id, caster.pos, origin).ok,
    ).toBe(false);
    const result = apply(data, state, cast(spell.id, origin, [origin]));
    expect(result.ok && result.nextState.units[0]).toMatchObject({
      pos: origin,
      mp: 27,
    });
    expect(result.ok && result.nextState.units[1]!.hp).toBe(8);
  });

  it("squad center selection uses the moved caster rather than its uncommitted old tile", () => {
    const { data, state, caster, follower } = fixture();
    caster.hp = 4;
    follower.side = "player";
    follower.commanderId = caster.id;
    follower.hp = 1;
    const origin = { x: 3, y: 4 };
    const preview = previewSpell(
      data,
      state,
      caster,
      "force-heal-1",
      origin,
      origin,
    );
    expect(preview).toMatchObject({
      ok: true,
      tiles: [origin, follower.pos],
      targets: [
        { unitId: caster.id, amount: 3 },
        { unitId: follower.id, amount: 3 },
      ],
    });
    expect(
      previewSpell(data, state, caster, "force-heal-1", caster.pos, origin).ok,
    ).toBe(false);
    const result = apply(data, state, cast("force-heal-1", origin, [origin]));
    expect(result.ok && result.nextState.units[0]).toMatchObject({
      pos: origin,
      hp: 7,
      mp: 27,
    });
    expect(result.ok && result.nextState.units[2]!.hp).toBe(4);
  });

  it("Thunder's adapted water bonus uses each target's terrain, never amphibious movement alone", () => {
    const { data, state, caster, leader, follower } = fixture();
    data.scenario.tiles[leader.pos.y * 9 + leader.pos.x] = "shallow";
    follower.moveType = "amphibious";
    expect(
      previewSpell(data, state, caster, "thunder", leader.pos),
    ).toMatchObject({
      ok: true,
      targets: [
        { unitId: leader.id, amount: 5 },
        { unitId: follower.id, amount: 3 },
      ],
    });
    leader.stats.res = 8;
    expect(
      previewSpell(data, state, caster, "thunder", leader.pos),
    ).toMatchObject({
      ok: true,
      targets: [
        { unitId: leader.id, amount: 0 },
        { unitId: follower.id, amount: 3 },
      ],
    });
  });

  it("Tornado adds its adapted flying bonus before RES and actual-HP limits", () => {
    const { data, state, caster, leader, follower } = fixture();
    leader.moveType = "flying";
    follower.pos = { x: 3, y: 4 };
    follower.unitType = "flier";
    follower.moveType = "foot";
    expect(
      previewSpell(data, state, caster, "tornado", caster.pos),
    ).toMatchObject({
      ok: true,
      targets: [
        { unitId: leader.id, amount: 4 },
        { unitId: follower.id, amount: 2 },
      ],
    });
    leader.hp = 1;
    follower.stats.res = 99;
    expect(
      previewSpell(data, state, caster, "tornado", caster.pos),
    ).toMatchObject({
      ok: true,
      targets: [
        { unitId: leader.id, amount: 1 },
        { unitId: follower.id, amount: 0 },
      ],
    });
  });

  it("Heal 2 completely restores wounded units in its area while excluding enemies", () => {
    const { data, state, caster, leader, follower } = fixture();
    caster.pos = { x: 3, y: 4 };
    caster.hp = 1;
    follower.pos = { x: 4, y: 3 };
    follower.side = "player";
    follower.hp = 7;
    const preview = previewSpell(data, state, caster, "heal-2", leader.pos);
    expect(preview).toMatchObject({
      ok: true,
      targets: [
        { unitId: caster.id, amount: 9 },
        { unitId: follower.id, amount: 3 },
      ],
    });
    const result = apply(data, state, cast("heal-2", leader.pos));
    expect(result.ok && result.nextState.units.map((unit) => unit.hp)).toEqual([
      10, 10, 10,
    ]);
  });

  it("enemy AI deterministically evaluates whole-squad Thunder and replays the same result", () => {
    const { data, state, caster, leader, follower } = fixture();
    state.activeSide = caster.side = "enemy";
    caster.stats.at = 0;
    caster.stats.move = 1;
    caster.spellIds = ["thunder"];
    leader.side = follower.side = "player";
    leader.hp = follower.hp = 3;
    leader.stats.at = follower.stats.at = 0;
    const before = structuredClone(state);
    const command = nextEnemyCommand(data, state);
    expect(command).toMatchObject({
      type: "act",
      action: { type: "cast", spellId: "thunder" },
    });
    expect(nextEnemyCommand(data, state)).toEqual(command);
    const result = apply(data, state, command!);
    expect(result.ok && result.nextState.units.map((unit) => unit.id)).toEqual([
      caster.id,
    ]);
    expect(apply(data, before, JSON.parse(JSON.stringify(command)))).toEqual(
      result,
    );
    expect(state).toEqual(before);
  });
});
