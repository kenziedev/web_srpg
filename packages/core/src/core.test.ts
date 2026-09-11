import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import {
  apply,
  commandBonus,
  createBattle,
  damage,
  evaluate,
  inAttackRange,
  reachable,
  type ActCommand,
  type BattleState,
  type Unit,
} from "./index";

function unit(
  id: string,
  type: Unit["unitType"],
  side: Unit["side"],
  x: number,
  y: number,
): Unit {
  return {
    id,
    name: id,
    side,
    kind: "mercenary",
    commanderId: side === "player" ? "A" : "E",
    unitType: type,
    moveType: "foot",
    pos: { x, y },
    hp: 10,
    mp: 0,
    stats: {
      at: type === "pike" ? 8 : 9,
      df: type === "pike" ? 7 : 6,
      res: 3,
      mag: 0,
      maxMp: 0,
      move: 4,
    },
    range: [1, 1],
    command: null,
    acted: false,
    spellIds: [],
  };
}
function fixture() {
  const a = unit("a", "infantry", "player", 2, 10);
  const e = unit("e", "pike", "enemy", 3, 10);
  const leader = (soldier: Unit, id: string, y: number): Unit => ({
    ...structuredClone(soldier),
    id,
    kind: "commander",
    commanderId: null,
    command: { radius: 3, at: 2, df: 2 },
    pos: { x: soldier.pos.x, y },
  });
  const state: BattleState = {
    ...createBattle(content),
    units: [a, e, leader(a, "A", 11), leader(e, "E", 11)],
  };
  return { state, a, e };
}
const attack = (overrides: Partial<ActCommand> = {}): ActCommand => ({
  type: "act",
  commandId: "test",
  expectedRevision: 0,
  unitId: "a",
  path: [],
  action: { type: "attack", targetId: "e" },
  ...overrides,
});

describe("documented combat cases", () => {
  it.each([
    ["full health", 10, true, true, 5],
    ["HP 4", 4, true, true, 3],
    ["defender outside command", 10, true, false, 7],
    ["attacker outside command", 10, false, true, 2],
  ])("%s", (_label, hp, own, other, expected) => {
    const { state, a, e } = fixture();
    a.hp = hp as number;
    if (!own) a.commanderId = null;
    if (!other) e.commanderId = null;
    expect(damage(content, state, a, e)).toBe(expected);
  });
  it("C01: command radius includes boundary and never buffs commanders", () => {
    const { state, a } = fixture();
    state.units.find((u) => u.id === "A")!.pos = { x: 2, y: 7 };
    expect(commandBonus(state, a).active).toBe(true);
    a.pos.y = 11;
    expect(commandBonus(state, a).active).toBe(false);
    expect(commandBonus(state, state.units[2]!).active).toBe(false);
  });
  it("forest defense gives 3 damage", () => {
    const { state, a, e } = fixture();
    e.pos = { x: 6, y: 6 };
    state.units[3]!.pos = { x: 6, y: 7 };
    expect(damage(content, state, a, e)).toBe(3);
  });
  it("C09: minimum range prevents archer counter at distance 1", () => {
    const { a, e } = fixture();
    a.range = [2, 3];
    expect(inAttackRange(a, e)).toBe(false);
    e.pos.x = 4;
    expect(inAttackRange(a, e)).toBe(true);
    e.pos.x = 5;
    expect(inAttackRange(a, e)).toBe(true);
    e.pos.x = 6;
    expect(inAttackRange(a, e)).toBe(false);
  });
  it("C07: lethal exchanges use both pre-combat HP values", () => {
    const { state, a, e } = fixture();
    e.unitType = "infantry";
    e.stats = { ...a.stats };
    a.hp = e.hp = 2;
    const result = apply(content, state, attack());
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.nextState.units.map((u) => u.id)).not.toContain("a");
    if (result.ok)
      expect(result.nextState.units.map((u) => u.id)).not.toContain("e");
  });
  it("commander defeat removes the whole troop", () => {
    const { state, a, e } = fixture();
    e.kind = "commander";
    e.commanderId = null;
    e.command = { radius: 3, at: 2, df: 2 };
    e.hp = 1;
    state.units.push({
      ...structuredClone(a),
      id: "vassal",
      side: "enemy",
      commanderId: "e",
      pos: { x: 4, y: 10 },
    });
    const result = apply(content, state, attack());
    expect(result.ok && result.events).toContainEqual({
      type: "removed",
      unitId: "vassal",
      reason: "retreated",
    });
  });
});

describe("atomic commands and movement", () => {
  it.each([
    ["stale revision", { expectedRevision: 9 }],
    ["nonadjacent path", { path: [{ x: 8, y: 10 }] }],
    [
      "enemy occupied destination",
      { path: [{ x: 3, y: 10 }], action: { type: "wait" } },
    ],
    ["noncommander treat", { action: { type: "treat" } }],
    ["MP/ability missing", { action: { type: "heal", targetId: "a" } }],
  ])("C10: %s leaves state and log unchanged", (_label, overrides) => {
    const { state } = fixture();
    const before = structuredClone(state);
    expect(
      apply(content, state, attack(overrides as Partial<ActCommand>)).ok,
    ).toBe(false);
    expect(state).toEqual(before);
  });
  it("preview and execution match without mutating input; duplicate command rejected", () => {
    const { state } = fixture();
    const before = structuredClone(state);
    const preview = evaluate(content, state, attack());
    expect(apply(content, state, attack())).toEqual(preview);
    expect(state).toEqual(before);
    if (preview.ok)
      expect(
        apply(content, preview.nextState, attack({ expectedRevision: 1 })).ok,
      ).toBe(false);
  });
  it("C11: flight crosses enemies/water but cannot stop on an enemy", () => {
    const { state, a } = fixture();
    a.moveType = "flying";
    const tiles = reachable(content, state, a);
    expect(tiles.some((t) => t.pos.x === 4 && t.pos.y === 10)).toBe(true);
    expect(tiles.some((t) => t.pos.x === 3 && t.pos.y === 10)).toBe(false);
    a.pos = { x: 9, y: 5 };
    expect(
      reachable(content, state, a).some((t) => t.pos.x === 10 && t.pos.y === 5),
    ).toBe(true);
  });
  it("mounted units cannot enter the northern ford", () => {
    const { state, a } = fixture();
    a.moveType = "mounted";
    a.pos = { x: 9, y: 3 };
    expect(
      reachable(content, state, a).some((t) => t.pos.x === 10 && t.pos.y === 3),
    ).toBe(false);
  });
  it("allies can be traversed but not occupied", () => {
    const { state, a } = fixture();
    state.units.find((u) => u.id === "A")!.pos = { x: 2, y: 9 };
    const tiles = reachable(content, state, a);
    expect(tiles.some((t) => t.pos.x === 2 && t.pos.y === 8)).toBe(true);
    expect(tiles.some((t) => t.pos.x === 2 && t.pos.y === 9)).toBe(false);
  });
  it("C05: stationary commander treat restores bounded HP/MP; movement invalid", () => {
    const { state } = fixture();
    const leader = state.units.find((u) => u.id === "A")!;
    leader.hp = 4;
    leader.mp = 1;
    leader.stats.maxMp = 9;
    const cmd = attack({ unitId: "A", action: { type: "treat" } });
    const result = apply(content, state, cmd);
    expect(
      result.ok && result.nextState.units.find((u) => u.id === "A"),
    ).toMatchObject({ hp: 7, mp: 3, acted: true });
    expect(apply(content, state, { ...cmd, path: [{ x: 2, y: 12 }] }).ok).toBe(
      false,
    );
  });
  it("heal requires MP and a wounded ally, restores 3 HP", () => {
    const { state, a } = fixture();
    const leader = state.units.find((u) => u.id === "A")!;
    leader.spellIds = ["heal-1"];
    leader.mp = leader.stats.maxMp = 9;
    a.hp = 4;
    const result = apply(
      content,
      state,
      attack({ unitId: "A", action: { type: "heal", targetId: "a" } }),
    );
    expect(
      result.ok && result.nextState.units.find((u) => u.id === "a")?.hp,
    ).toBe(7);
    expect(
      result.ok && result.nextState.units.find((u) => u.id === "A")?.mp,
    ).toBe(7);
  });
});
