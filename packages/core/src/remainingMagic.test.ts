import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import {
  apply,
  createBattle,
  evaluate,
  knownSpells,
  nextEnemyCommand,
  nextNpcCommand,
  phaseEndCommand,
  previewSpell,
  reachable,
  terrainAt,
  damage,
  commandBonus,
  type ActCommand,
  type BattleState,
  type Content,
  type Position,
  type Unit,
} from "./index";
import { effectiveUnit } from "./effective";
import { hasStatus } from "./statuses";

function fixture() {
  const data = structuredClone(content);
  data.scenario.width = data.scenario.height = 9;
  data.scenario.tiles = Array<string>(81).fill("plain");
  delete data.scenario.mission;
  delete data.scenario.enemyPlans;
  data.scenario.reinforcement.units = [];
  data.scenario.inventory = {};
  const caster = structuredClone(
    data.scenario.units.find((unit) => unit.id === "A3")!,
  );
  Object.assign(caster, {
    id: "caster",
    pos: { x: 2, y: 2 },
    hp: 10,
    mp: 100,
    spellIds: data.spells
      .filter((spell) => spell.learnable !== false)
      .map((spell) => spell.id),
  });
  caster.stats = { at: 8, df: 5, res: 2, mag: 6, maxMp: 100, move: 4 };
  caster.command = { at: 2, df: 2, radius: 3 };
  delete caster.equipment;
  const leader = structuredClone(
    data.scenario.units.find((unit) => unit.id === "E2")!,
  );
  Object.assign(leader, {
    id: "leader",
    pos: { x: 4, y: 2 },
    hp: 10,
    mp: 20,
    spellIds: [],
    stats: { at: 8, df: 5, res: 0, mag: 4, maxMp: 20, move: 4 },
    command: { at: 2, df: 2, radius: 3 },
  });
  const follower = structuredClone(
    data.scenario.units.find(
      (unit) => unit.kind === "mercenary" && unit.side === "enemy",
    )!,
  );
  Object.assign(follower, {
    id: "follower",
    commanderId: leader.id,
    pos: { x: 5, y: 2 },
    stats: { at: 8, df: 5, res: 0, mag: 0, maxMp: 0, move: 4 },
  });
  const ally = structuredClone(follower);
  Object.assign(ally, {
    id: "ally",
    side: "player",
    commanderId: caster.id,
    pos: { x: 2, y: 3 },
  });
  data.scenario.units = [caster, ally, leader, follower];
  const state = createBattle(data);
  return {
    data,
    state,
    caster: state.units[0]!,
    ally: state.units[1]!,
    leader: state.units[2]!,
    follower: state.units[3]!,
  };
}
function cast(
  state: BattleState,
  spellId: string,
  target: Position,
  unitId = "caster",
  destination?: Position,
): ActCommand {
  return {
    type: "act",
    commandId: `magic-${state.revision + 1}`,
    expectedRevision: state.revision,
    unitId,
    path: [],
    action: {
      type: "cast",
      spellId,
      target,
      ...(destination ? { destination } : {}),
    },
  };
}
function run(
  data: Content,
  state: BattleState,
  command: Parameters<typeof apply>[2],
) {
  const result = apply(data, state, command);
  if (!result.ok) throw Error(result.error);
  return result;
}
function nextPhase(data: Content, state: BattleState) {
  return run(data, state, phaseEndCommand(state)).nextState;
}
function forceSuccess(
  data: Content,
  state: BattleState,
  spellId: string,
  caster: Unit,
  target: Unit,
  success = true,
) {
  for (let seed = 1; seed <= 10000; seed += 1) {
    state.rngSeed = seed;
    const preview = previewSpell(data, state, caster, spellId, target.pos);
    if (preview.ok && preview.targets[0]?.success === success) return;
  }
  throw Error("No deterministic outcome fixture");
}

describe("S02-M01: remaining PC spell catalog and status lifetimes", () => {
  it("registers exactly 26 general spells and all 9 summon templates", () => {
    expect(
      content.spells.filter((spell) => spell.effect.type !== "summon"),
    ).toHaveLength(26);
    expect(
      content.spells.filter((spell) => spell.effect.type === "summon"),
    ).toHaveLength(9);
    expect(content.summons).toHaveLength(9);
  });
  it.each([
    ["attack-1", "attack", 3],
    ["attack-2", "attack", 5],
    ["protection-1", "protection", 3],
    ["protection-2", "protection", 5],
    ["resist", "resist", 2],
    ["quick", "quick", 3],
  ] as const)(
    "%s previews, applies and expires at the source's next phase",
    (spellId, status, power) => {
      const { data, state, caster, ally } = fixture();
      const before = structuredClone(state);
      const command = cast(state, spellId, caster.pos);
      const predicted = evaluate(data, state, command);
      expect(state).toEqual(before);
      const result = run(data, state, command);
      expect(result).toEqual(predicted);
      expect(
        result.events.filter((event) => event.type === "statusApplied"),
      ).toHaveLength(2);
      expect(
        result.nextState.statuses.find((effect) => effect.unitId === caster.id),
      ).toMatchObject({
        status,
        power,
        expiresSide: "player",
        expiresRound: 2,
      });
      const improved = effectiveUnit(
        data,
        result.nextState,
        result.nextState.units[0]!,
      );
      if (status === "attack") {
        expect(improved.stats.at).toBe(caster.stats.at + power);
        expect(commandBonus(result.nextState, ally, data).at).toBe(2 + power);
        expect(effectiveUnit(data, result.nextState, ally).stats.at).toBe(
          ally.stats.at,
        );
      }
      if (status === "protection")
        expect(commandBonus(result.nextState, ally, data).df).toBe(2 + power);
      if (status === "resist")
        expect(improved.stats.res).toBe(caster.stats.res + power);
      if (status === "quick")
        expect(
          reachable(data, result.nextState, result.nextState.units[0]!).some(
            (tile) => tile.cost > caster.stats.move,
          ),
        ).toBe(true);
      const enemy = nextPhase(data, result.nextState);
      expect(hasStatus(enemy, caster, status)).toBe(true);
      const npc = nextPhase(data, enemy);
      expect(hasStatus(npc, caster, status)).toBe(true);
      const player = nextPhase(data, npc);
      expect(player.statuses).toHaveLength(0);
      expect(effectiveUnit(data, player, player.units[0]!).stats).toEqual(
        caster.stats,
      );
    },
  );
  it("refreshing a weaker buff preserves the stronger amount without stacking", () => {
    const { data, state, caster } = fixture();
    const first = run(
      data,
      state,
      cast(state, "attack-2", caster.pos),
    ).nextState;
    first.units[0]!.acted = false;
    const second = run(
      data,
      first,
      cast(first, "attack-1", caster.pos),
    ).nextState;
    expect(
      second.statuses.filter((effect) => effect.status === "attack"),
    ).toHaveLength(1);
    expect(effectiveUnit(data, second, second.units[0]!).stats.at).toBe(13);
  });
  it("attack buff reaches distant followers only inside the living leader's command range", () => {
    const { data, state, caster } = fixture();
    state.units[1]!.pos = { x: 8, y: 8 };
    const next = run(
      data,
      state,
      cast(state, "attack-2", caster.pos),
    ).nextState;
    expect(commandBonus(next, next.units[1]!, data)).toEqual({
      at: 0,
      df: 0,
      active: false,
    });
    expect(effectiveUnit(data, next, next.units[1]!).stats.at).toBe(8);
  });
  it.each(["sleep", "mute", "zone", "decline"])(
    "%s has deterministic resistance and immutable rejection",
    (spellId) => {
      const { data, state, caster, leader } = fixture();
      forceSuccess(data, state, spellId, caster, leader);
      const initial = JSON.stringify(state);
      const command = cast(state, spellId, leader.pos);
      const preview = previewSpell(data, state, caster, spellId, leader.pos);
      expect(preview.ok && preview.targets[0]?.chance).toBe(95);
      const first = run(data, state, command);
      expect(first).toEqual(run(data, JSON.parse(initial), command));
      expect(JSON.stringify(state)).toBe(initial);
      expect(hasStatus(first.nextState, leader, spellId as "sleep")).toBe(true);
      const poorMp = structuredClone(state);
      poorMp.units[0]!.mp = 0;
      const before = structuredClone(poorMp);
      expect(apply(data, poorMp, command).ok).toBe(false);
      expect(poorMp).toEqual(before);
    },
  );
  it("a resisted debuff spends MP and action without installing a status", () => {
    const { data, state, caster, leader } = fixture();
    forceSuccess(data, state, "mute", caster, leader, false);
    const next = run(data, state, cast(state, "mute", leader.pos));
    expect(next.nextState.statuses).toHaveLength(0);
    expect(next.nextState.units[0]!.mp).toBe(97);
    expect(next.nextState.units[0]!.acted).toBe(true);
    expect(next.events).toContainEqual({
      type: "statusApplied",
      unitId: leader.id,
      status: "mute",
      power: 0,
      chance: 95,
      success: false,
    });
  });
  it("sleep blocks movement, attacks, spellcasting, treatment and counters", () => {
    const { data, state, caster, leader } = fixture();
    state.statuses.push({
      unitId: caster.id,
      status: "sleep",
      power: 0,
      sourceId: leader.id,
      expiresRound: 2,
      expiresSide: "enemy",
    });
    expect(reachable(data, state, caster)).toHaveLength(1);
    const base = cast(state, "magic-arrow", leader.pos);
    for (const action of [
      { type: "attack", targetId: leader.id },
      { type: "treat" },
      base.action,
    ] as const)
      expect(apply(data, state, { ...base, action }).ok).toBe(false);
    expect(
      apply(data, state, {
        ...base,
        path: [{ x: 2, y: 1 }],
        action: { type: "wait" },
      }).ok,
    ).toBe(false);
    expect(apply(data, state, { ...base, action: { type: "wait" } }).ok).toBe(
      true,
    );
    state.activeSide = "enemy";
    leader.pos = { x: 3, y: 2 };
    const combat = run(data, state, {
      ...base,
      unitId: leader.id,
      action: { type: "attack", targetId: caster.id },
    });
    expect(combat.events).toContainEqual({
      type: "damaged",
      unitId: leader.id,
      amount: 0,
    });
    const asleep = nextPhase(
      data,
      nextPhase(data, { ...state, activeSide: "enemy" }),
    );
    expect(asleep.units[0]!.acted).toBe(true);
  });
  it("mute blocks summons and spells while zone removes command bonuses and decline lowers RES", () => {
    const { data, state, caster, ally } = fixture();
    state.statuses.push(
      ...(["mute", "zone", "decline"] as const).map((status) => ({
        unitId: caster.id,
        status,
        power: status === "decline" ? 2 : 0,
        sourceId: "leader",
        expiresRound: 2,
        expiresSide: "enemy" as const,
      })),
    );
    expect(previewSpell(data, state, caster, "heal-1", caster.pos).ok).toBe(
      false,
    );
    expect(
      previewSpell(data, state, caster, "summon-valkyrie", { x: 1, y: 2 }).ok,
    ).toBe(false);
    expect(commandBonus(state, ally, data).active).toBe(false);
    expect(effectiveUnit(data, state, caster).stats.res).toBe(0);
  });
});

describe("S02-M02: charm preserves squads and restores original allegiance", () => {
  it("charms a full squad using one roll, runs allied NPC AI, then restores both sides", () => {
    const { data, state, caster, leader, follower } = fixture();
    forceSuccess(data, state, "charm", caster, leader);
    const next = run(data, state, cast(state, "charm", follower.pos)).nextState;
    expect(
      next.units.filter((unit) => unit.side === "npc").map((unit) => unit.id),
    ).toEqual([leader.id, follower.id]);
    expect(
      next.statuses.filter((effect) => effect.status === "charm"),
    ).toHaveLength(2);
    let npc = nextPhase(data, nextPhase(data, next));
    expect(npc.activeSide).toBe("npc");
    const action = nextNpcCommand(data, npc)!;
    expect(action.type).toBe("act");
    expect(apply(data, npc, action).ok).toBe(true);
    // Both enemies are now allies, so the NPC policy produces a valid hold action.
    npc = run(data, npc, action).nextState;
    const player = nextPhase(data, npc);
    expect(player.units.find((unit) => unit.id === leader.id)!.side).toBe(
      "enemy",
    );
    expect(player.units.find((unit) => unit.id === follower.id)!.side).toBe(
      "enemy",
    );
    expect(player.statuses).toHaveLength(0);
  });
  it("enemy charm transfers the player squad to enemy AI and fixed expiry restores it", () => {
    const { data, state, caster, leader } = fixture();
    state.activeSide = "enemy";
    leader.spellIds = ["charm"];
    leader.mp = 20;
    forceSuccess(data, state, "charm", leader, caster);
    let next = run(
      data,
      state,
      cast(state, "charm", caster.pos, leader.id),
    ).nextState;
    expect(next.units.every((unit) => unit.side === "enemy")).toBe(true);
    next = nextPhase(data, nextPhase(data, nextPhase(data, next)));
    expect(next.activeSide).toBe("enemy");
    expect(next.units[0]!.side).toBe("player");
    expect(next.units[1]!.side).toBe("player");
  });
});

describe("S02-M03: terrain and specialized damage", () => {
  it("meteor persists center destruction and movement, defense and replay use it", () => {
    const { data, state, caster, leader } = fixture();
    data.scenario.tiles[leader.pos.y * 9 + leader.pos.x] = "forest";
    const physicalBefore = damage(data, state, caster, leader);
    const command = cast(state, "meteor", leader.pos);
    const result = run(data, state, command);
    expect(result.nextState.terrainChanges).toEqual({ "4,2": "plain" });
    expect(terrainAt(data, leader.pos, result.nextState)?.id).toBe("plain");
    expect(terrainAt(data, leader.pos, state)?.id).toBe("forest");
    expect(result).toEqual(
      run(data, JSON.parse(JSON.stringify(state)), command),
    );
    expect(damage(data, result.nextState, caster, leader)).toBeGreaterThan(
      physicalBefore,
    );
  });
  it("earthquake affects ground units, destroys declared area terrain, and preserves road", () => {
    const { data, state, caster, leader, follower } = fixture();
    leader.moveType = "flying";
    data.scenario.tiles[3 * 9 + 3] = "forest";
    data.scenario.tiles[3 * 9 + 4] = "road";
    const preview = previewSpell(data, state, caster, "earthquake", caster.pos);
    expect(
      preview.ok && preview.targets.map((target) => target.unitId),
    ).toEqual([follower.id]);
    const next = run(
      data,
      state,
      cast(state, "earthquake", caster.pos),
    ).nextState;
    expect(terrainAt(data, { x: 3, y: 3 }, next)?.id).toBe("plain");
    expect(terrainAt(data, { x: 4, y: 3 }, next)?.id).toBe("road");
    expect(next.units.find((unit) => unit.id === leader.id)!.hp).toBe(10);
  });
  it("turn undead removes only undead mercenaries regardless of RES", () => {
    const { data, state, caster, leader, follower } = fixture();
    leader.unitType = follower.unitType = "undead";
    follower.stats.res = 1000;
    const result = run(data, state, cast(state, "turn-undead", caster.pos));
    expect(result.nextState.units.some((unit) => unit.id === follower.id)).toBe(
      false,
    );
    expect(
      result.nextState.units.find((unit) => unit.id === leader.id)!.hp,
    ).toBe(10);
    expect(
      result.nextState.units.find((unit) => unit.id === caster.id)!.mp,
    ).toBe(95);
  });
});

describe("S02-M04: atomic teleport and bounded reactivation", () => {
  it("teleports the selected squad into unique legal cells and keeps action flags", () => {
    const { data, state, caster, ally } = fixture();
    ally.acted = true;
    const command = cast(state, "teleport", caster.pos, caster.id, {
      x: 7,
      y: 7,
    });
    const preview = previewSpell(
      data,
      state,
      caster,
      "teleport",
      caster.pos,
      caster.pos,
      { x: 7, y: 7 },
    );
    expect(preview.ok && preview.placements).toHaveLength(2);
    const result = run(data, state, command);
    expect(result.nextState.units[0]!.pos).toEqual({ x: 7, y: 7 });
    expect(result.nextState.units[1]!.pos).toEqual({ x: 7, y: 8 });
    expect(result.nextState.units[1]!.acted).toBe(true);
    expect(
      result.events.filter((event) => event.type === "teleported"),
    ).toHaveLength(2);
    expect(result.nextState.units[0]!.mp).toBe(95);
    expect(result).toEqual(
      run(data, JSON.parse(JSON.stringify(state)), command),
    );
  });
  it.each(["missing", "occupied", "outside", "blocked-squad"])(
    "rejects %s destination without moving or spending MP",
    (reason) => {
      const { data, state, caster, leader } = fixture();
      let destination: Position | undefined = { x: 7, y: 7 };
      if (reason === "missing") destination = undefined;
      if (reason === "occupied") destination = leader.pos;
      if (reason === "outside") destination = { x: 40, y: 40 };
      if (reason === "blocked-squad") {
        data.scenario.tiles.fill("wall");
        data.scenario.tiles[7 * 9 + 7] = "plain";
        for (const unit of state.units)
          data.scenario.tiles[unit.pos.y * 9 + unit.pos.x] = "plain";
      }
      const before = structuredClone(state);
      expect(
        apply(
          data,
          state,
          cast(state, "teleport", caster.pos, caster.id, destination),
        ).ok,
      ).toBe(false);
      expect(state).toEqual(before);
    },
  );
  it("again refreshes only already-acted squad members once per round, excluding caster", () => {
    const { data, state, caster, ally } = fixture();
    ally.acted = true;
    const next = run(data, state, cast(state, "again", caster.pos)).nextState;
    expect(next.units[1]!.acted).toBe(false);
    expect(next.units[1]!.refreshedRound).toBe(1);
    expect(next.units[0]!.acted).toBe(true);
    next.units[0]!.acted = false;
    next.units[1]!.acted = true;
    expect(apply(data, next, cast(next, "again", caster.pos)).ok).toBe(false);
    next.round = 2;
    expect(apply(data, next, cast(next, "again", caster.pos)).ok).toBe(true);
  });
});

describe("S02-M05: summons, ownership and capacity", () => {
  it.each(
    content.spells
      .filter((spell) => spell.effect.type === "summon")
      .map((spell) => spell.id),
  )("%s creates the declared usable summon with MP paid once", (spellId) => {
    const { data, state, caster } = fixture();
    caster.spellIds.push(spellId); // Item-only summons are granted by equipment in real content.
    const spell = data.spells.find((item) => item.id === spellId)!;
    const result = run(data, state, cast(state, spellId, { x: 1, y: 2 }));
    const summon = result.nextState.units.find((unit) => unit.summon)!;
    expect(summon).toMatchObject({
      pos: { x: 1, y: 2 },
      hp: 10,
      acted: true,
      side: caster.side,
      commanderId: caster.id,
      summon: { ownerId: caster.id, templateId: spell.effect.summonId },
    });
    expect(summon.mp).toBe(summon.stats.maxMp);
    expect(knownSpells(data, summon).map((item) => item.id)).toEqual(
      summon.spellIds,
    );
    expect(result.nextState.units[0]!.mp).toBe(100 - spell.mpCost);
    expect(result).toEqual(
      run(
        data,
        JSON.parse(JSON.stringify(state)),
        cast(state, spellId, { x: 1, y: 2 }),
      ),
    );
  });
  it("replaces an owned summon only after valid placement; blocked replacement is atomic", () => {
    const { data, state, caster } = fixture();
    let next = run(
      data,
      state,
      cast(state, "summon-valkyrie", { x: 1, y: 2 }),
    ).nextState;
    next.units[0]!.acted = false;
    const previous = next.units.find((unit) => unit.summon)!;
    const before = structuredClone(next);
    expect(
      apply(data, next, cast(next, "summon-freya", next.units[1]!.pos)).ok,
    ).toBe(false);
    expect(next).toEqual(before);
    next = run(data, next, cast(next, "summon-freya", previous.pos)).nextState;
    expect(next.units.filter((unit) => unit.summon)).toHaveLength(1);
    expect(next.units.find((unit) => unit.summon)!.summon!.templateId).toBe(
      "freya",
    );
    expect(next.units.some((unit) => unit.id === previous.id)).toBe(false);
    expect(next.units[0]!.mp).toBe(caster.mp - 25);
  });
  it("a fallen owner removes surviving summoned units and their statuses", () => {
    const { data, state, caster } = fixture();
    const summoned = run(
      data,
      state,
      cast(state, "summon-valkyrie", { x: 1, y: 2 }),
    ).nextState;
    const summonId = summoned.units.find((unit) => unit.summon)!.id;
    summoned.activeSide = "enemy";
    const owner = summoned.units[0]!;
    owner.hp = 1;
    owner.stats.res = 0;
    const enemy = summoned.units.find((unit) => unit.id === "leader")!;
    enemy.spellIds = ["blast"];
    enemy.mp = 20;
    summoned.statuses.push({
      unitId: summonId,
      status: "quick",
      power: 3,
      sourceId: caster.id,
      expiresRound: 2,
      expiresSide: "player",
    });
    const result = run(
      data,
      summoned,
      cast(summoned, "blast", owner.pos, enemy.id),
    );
    expect(result.nextState.units.some((unit) => unit.summon)).toBe(false);
    expect(result.nextState.statuses).toHaveLength(0);
    expect(result.events).toContainEqual({
      type: "removed",
      unitId: summonId,
      reason: "retreated",
    });
  });
  it("enemy magic policy can choose a successful status spell without nondeterminism", () => {
    const { data, state, caster, leader } = fixture();
    state.activeSide = "enemy";
    leader.spellIds = ["mute"];
    leader.stats.at = 0;
    leader.range = [0, 0];
    state.units = [caster, leader];
    forceSuccess(data, state, "mute", leader, caster);
    const command = nextEnemyCommand(data, state)!;
    expect(command).toEqual(nextEnemyCommand(data, structuredClone(state)));
    expect(command.type === "act" && command.action.type).toBe("cast");
    expect(apply(data, state, command).ok).toBe(true);
  });
});

describe("S02-M06: cross-system invariants and failure boundaries", () => {
  it("charm keeps owned equipment counted and applies command buffs once to the converted squad", () => {
    const { data, state, caster, leader, follower } = fixture();
    const sword =
      data.items.find((item) => item.id === "long-sword") ??
      data.items.find(
        (item) => item.slot === "weapon" && !item.unavailableReason,
      )!;
    leader.equipment = { weapon: sword.id, armor: null };
    state.inventory[sword.id] = 1;
    forceSuccess(data, state, "charm", caster, leader);
    let next = run(data, state, cast(state, "charm", leader.pos)).nextState;
    expect(
      next.units.find((unit) => unit.id === leader.id)!.equipment?.weapon,
    ).toBe(sword.id);
    expect(next.inventory[sword.id]).toBe(1);
    next.units[0]!.acted = false;
    next = run(data, next, cast(next, "attack-2", follower.pos)).nextState;
    const converted = next.units.find((unit) => unit.id === follower.id)!;
    const commander = next.units.find((unit) => unit.id === leader.id)!;
    expect(converted.side).toBe("npc");
    expect(commandBonus(next, converted, data).at).toBe(7);
    expect(effectiveUnit(data, next, converted).stats.at).toBe(
      follower.stats.at,
    );
    expect(effectiveUnit(data, next, commander).stats.at).toBe(
      leader.stats.at + (sword.modifiers.at ?? 0) + 5,
    );
    // The next source phase returns both units, clears allied buffs, keeps the gear.
    next = nextPhase(data, nextPhase(data, nextPhase(data, next)));
    expect(next.units.find((unit) => unit.id === leader.id)!.side).toBe(
      "enemy",
    );
    expect(next.statuses).toHaveLength(0);
    expect(next.inventory[sword.id]).toBe(1);
  });
  it("a charmed summoner and its existing summon convert and restore together", () => {
    const { data, state, caster, leader } = fixture();
    leader.spellIds = ["summon-valkyrie"];
    leader.mp = 30;
    state.activeSide = "enemy";
    let next = run(
      data,
      state,
      cast(state, "summon-valkyrie", { x: 4, y: 1 }, leader.id),
    ).nextState;
    next.activeSide = "player";
    next.units[0]!.acted = false;
    forceSuccess(
      data,
      next,
      "charm",
      next.units[0]!,
      next.units.find((unit) => unit.id === leader.id)!,
    );
    next = run(
      data,
      next,
      cast(next, "charm", leader.pos, caster.id),
    ).nextState;
    expect(next.units.find((unit) => unit.summon)!.side).toBe("npc");
    expect(next.units.find((unit) => unit.summon)!.summon!.ownerId).toBe(
      leader.id,
    );
    next = nextPhase(data, nextPhase(data, nextPhase(data, next)));
    expect(next.units.find((unit) => unit.summon)!.side).toBe("enemy");
  });
  it("owner loss cascades through a summon that is independently charmed", () => {
    const { data, state, caster, leader } = fixture();
    leader.spellIds = ["summon-valkyrie"];
    leader.mp = 30;
    state.activeSide = "enemy";
    let next = run(
      data,
      state,
      cast(state, "summon-valkyrie", { x: 4, y: 1 }, leader.id),
    ).nextState;
    const summon = next.units.find((unit) => unit.summon)!;
    next.activeSide = "player";
    next.units[0]!.acted = false;
    forceSuccess(data, next, "charm", next.units[0]!, summon);
    next = run(data, next, cast(next, "charm", summon.pos)).nextState;
    expect(next.units.find((unit) => unit.summon)!.side).toBe("npc");
    next.units[0]!.acted = false;
    next.units.find((unit) => unit.id === leader.id)!.hp = 1;
    const result = run(data, next, cast(next, "blast", leader.pos, caster.id));
    expect(result.nextState.units.some((unit) => unit.id === summon.id)).toBe(
      false,
    );
    expect(
      result.nextState.statuses.some((effect) => effect.unitId === summon.id),
    ).toBe(false);
  });
  it("summon failure at the unit cap preserves every unit and MP", () => {
    const { data, state, caster } = fixture();
    const template = structuredClone(state.units[1]!);
    for (let i = 0; state.units.length < 42; i += 1) {
      const pos = { x: i % 9, y: Math.floor(i / 9) + 4 };
      state.units.push({ ...structuredClone(template), id: `extra-${i}`, pos });
    }
    const before = structuredClone(state);
    expect(
      apply(
        data,
        state,
        cast(state, "summon-valkyrie", { x: 1, y: 2 }, caster.id),
      ).ok,
    ).toBe(false);
    expect(state).toEqual(before);
  });
  it("teleport relocates a mixed flying/ground squad without placing walkers on water or walls", () => {
    const { data, state, caster, ally } = fixture();
    caster.moveType = "flying";
    data.scenario.tiles.fill("wall");
    for (const unit of state.units)
      data.scenario.tiles[unit.pos.y * 9 + unit.pos.x] = "plain";
    data.scenario.tiles[7 * 9 + 7] = "water";
    data.scenario.tiles[7 * 9 + 6] = "plain";
    const preview = previewSpell(
      data,
      state,
      caster,
      "teleport",
      caster.pos,
      caster.pos,
      { x: 7, y: 7 },
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw Error(preview.error);
    expect(preview.placements).toContainEqual({
      unitId: ally.id,
      pos: { x: 6, y: 7 },
    });
  });
  it("again cannot replenish the casting unit through its own squad and remains capped after JSON restore", () => {
    const { data, state, caster, ally } = fixture();
    ally.acted = true;
    const first = run(data, state, cast(state, "again", caster.pos)).nextState;
    const restored: BattleState = JSON.parse(JSON.stringify(first));
    restored.units[0]!.acted = false;
    restored.units[1]!.acted = true;
    const before = structuredClone(restored);
    expect(apply(data, restored, cast(restored, "again", ally.pos)).ok).toBe(
      false,
    );
    expect(restored).toEqual(before);
    expect(restored.units[0]!.mp).toBe(90);
  });
  it("new caster spells stay usable after summoning and phase reset without granting a second entry action", () => {
    const { data, state } = fixture();
    let next = run(
      data,
      state,
      cast(state, "summon-valkyrie", { x: 1, y: 2 }),
    ).nextState;
    const summonId = next.units.find((unit) => unit.summon)!.id;
    expect(
      apply(data, next, cast(next, "quick", { x: 1, y: 2 }, summonId)).ok,
    ).toBe(false);
    next = nextPhase(data, nextPhase(data, nextPhase(data, next)));
    const summon = next.units.find((unit) => unit.id === summonId)!;
    const result = run(data, next, cast(next, "quick", summon.pos, summonId));
    expect(result.nextState.statuses).toContainEqual({
      unitId: summonId,
      sourceId: summonId,
      status: "quick",
      power: 3,
      expiresRound: 3,
      expiresSide: "player",
    });
    expect(
      result.nextState.units.find((unit) => unit.id === summonId)!.mp,
    ).toBe(summon.mp - 5);
  });
});
