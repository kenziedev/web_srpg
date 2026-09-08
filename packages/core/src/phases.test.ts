import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import {
  apply,
  createBattle,
  nextEnemyCommand,
  phaseEndCommand,
  type BattleState,
  type Command,
} from "./index";

function end(state: BattleState) {
  const result = apply(content, state, phaseEndCommand(state));
  if (!result.ok) throw Error(result.error);
  return result.nextState;
}

describe("phase lifecycle", () => {
  it("advances player → enemy → NPC → next player round and resets only the arriving side", () => {
    const initial = createBattle(content);
    initial.units.forEach((u) => {
      u.acted = true;
    });
    const enemy = end(initial);
    expect(enemy.activeSide).toBe("enemy");
    expect(enemy.round).toBe(1);
    expect(
      enemy.units.filter((u) => u.side === "enemy").every((u) => !u.acted),
    ).toBe(true);
    expect(
      enemy.units.filter((u) => u.side !== "enemy").every((u) => u.acted),
    ).toBe(true);
    const npc = end(enemy);
    expect(npc.activeSide).toBe("npc");
    expect(npc.round).toBe(1);
    const player = end(npc);
    expect(player.activeSide).toBe("player");
    expect(player.round).toBe(2);
    expect(
      player.units.filter((u) => u.side === "player").every((u) => !u.acted),
    ).toBe(true);
    expect(
      player.units.filter((u) => u.side !== "player").every((u) => u.acted),
    ).toBe(true);
    expect(initial.round).toBe(1);
    expect(initial.commands).toEqual([]);
  });
  it("C03: adjacent + village recovery takes the larger amount, with no MP regeneration", () => {
    const state = createBattle(content);
    state.activeSide = "npc";
    const merc = state.units.find((u) => u.id === "A21")!;
    merc.pos = { x: 8, y: 9 };
    merc.hp = 4;
    const leader = state.units.find((u) => u.id === "A2")!;
    leader.pos = { x: 8, y: 8 };
    leader.hp = 4;
    const mage = state.units.find((u) => u.id === "A3")!;
    mage.mp = 1;
    const result = end(state);
    expect(result.units.find((u) => u.id === merc.id)?.hp).toBe(7);
    expect(result.units.find((u) => u.id === leader.id)?.hp).toBe(4);
    expect(result.units.find((u) => u.id === mage.id)?.mp).toBe(1);
    expect(merc.hp).toBe(4);
  });
  it("only own living commander grants adjacent recovery; flight does not gain village recovery", () => {
    const state = createBattle(content);
    state.activeSide = "npc";
    const merc = state.units.find((u) => u.id === "A21")!;
    merc.pos = { x: 8, y: 9 };
    merc.hp = 4;
    merc.moveType = "flying";
    state.units = state.units.filter((u) => u.id !== "A2");
    state.units.find((u) => u.id === "A1")!.pos = { x: 8, y: 8 };
    expect(end(state).units.find((u) => u.id === merc.id)?.hp).toBe(4);
  });
  it("heals the enemy on its turn, caps HP, and never heals it on player turn", () => {
    const state = createBattle(content);
    const merc = state.units.find((u) => u.id === "E11")!;
    merc.hp = 9;
    merc.pos = { x: 14, y: 9 };
    expect(end(state).units.find((u) => u.id === merc.id)?.hp).toBe(10);
    state.activeSide = "npc";
    expect(end(state).units.find((u) => u.id === merc.id)?.hp).toBe(9);
  });
  it("rejects wrong-side, duplicate and stale phase commands without mutation", () => {
    const state = createBattle(content);
    const before = structuredClone(state);
    const command = phaseEndCommand(state);
    expect(
      apply(content, state, { ...command, type: "endPhase", side: "enemy" }).ok,
    ).toBe(false);
    expect(apply(content, state, { ...command, expectedRevision: 99 }).ok).toBe(
      false,
    );
    const next = end(state);
    expect(
      apply(content, next, { ...command, expectedRevision: next.revision }).ok,
    ).toBe(false);
    expect(state).toEqual(before);
  });
  it("mixed action and phase log replays exactly through two rounds", () => {
    let state = createBattle(content);
    const command: Command = {
      type: "act",
      unitId: "A3",
      path: [],
      action: { type: "wait" },
      commandId: "wait-1",
      expectedRevision: 0,
    };
    const applied = apply(content, state, command);
    if (!applied.ok) throw Error(applied.error);
    state = applied.nextState;
    for (let i = 0; i < 6; i++) state = end(state);
    let replay = createBattle(content);
    for (const logged of state.commands) {
      const result = apply(content, replay, logged);
      if (!result.ok) throw Error(result.error);
      replay = result.nextState;
    }
    expect(replay).toEqual(state);
    expect(state.round).toBe(3);
  });
});

describe("bounded enemy turn", () => {
  it("performs real movement/attacks and terminates after at most one action per unit", () => {
    let state = end(createBattle(content));
    const count = state.units.filter((u) => u.side === "enemy").length;
    const start = structuredClone(state);
    for (let step = 0; step <= count && state.activeSide === "enemy"; step++) {
      const command = nextEnemyCommand(content, state)!;
      expect(command).toEqual(nextEnemyCommand(content, state));
      const result = apply(content, state, command);
      if (!result.ok) throw Error(result.error);
      state = result.nextState;
    }
    expect(state.activeSide).toBe("npc");
    expect(
      state.units.some((u) => {
        const old = start.units.find((old) => old.id === u.id);
        return (
          old &&
          (u.pos.x !== old.pos.x || u.pos.y !== old.pos.y || u.hp !== old.hp)
        );
      }),
    ).toBe(true);
    const actions = state.commands.filter((c) => c.type === "act");
    expect(new Set(actions.map((c) => c.unitId)).size).toBe(actions.length);
  });
  it("takes a safe lethal attack instead of waiting", () => {
    const state = createBattle(content);
    state.activeSide = "enemy";
    state.units = state.units.filter((u) => ["A1", "E1"].includes(u.id));
    const enemy = state.units.find((u) => u.id === "E1")!;
    enemy.pos = { x: 2, y: 10 };
    const target = state.units.find((u) => u.id === "A1")!;
    target.pos = { x: 3, y: 10 };
    target.hp = 1;
    target.stats.at = 0;
    expect(nextEnemyCommand(content, state)).toMatchObject({
      type: "act",
      action: { type: "attack", targetId: "A1" },
    });
  });
  it("empty enemy army advances; player turn cannot invoke enemy automation", () => {
    const state = createBattle(content);
    expect(nextEnemyCommand(content, state)).toBeNull();
    state.activeSide = "enemy";
    state.units = state.units.filter((u) => u.side !== "enemy");
    expect(nextEnemyCommand(content, state)?.type).toBe("endPhase");
  });
});
