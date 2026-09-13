import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import { createBattle, type Unit } from "./types";
import { enemyPhysicalThreat, previewCommandRange } from "./threat";

function fixture() {
  const world = structuredClone(content);
  world.scenario.width = 13;
  world.scenario.height = 7;
  world.scenario.tiles = Array(13 * 7).fill("plain");
  const enemy: Unit = {
    ...structuredClone(
      content.scenario.units.find((unit) => unit.kind === "commander")!,
    ),
    id: "enemy",
    side: "enemy",
    pos: { x: 4, y: 3 },
    kind: "commander",
    commanderId: null,
    acted: true,
    range: [1, 1],
    equipment: undefined,
    progression: undefined,
    command: { radius: 2, at: 2, df: 3 },
  };
  enemy.stats.move = 1;
  const state = { ...createBattle(content), units: [enemy] };
  return { world, state, enemy };
}

describe("R04 current physical threat", () => {
  it("includes spent enemies, excludes spells and does not mutate a battle", () => {
    const { world, state, enemy } = fixture();
    enemy.spellIds = ["meteor"];
    const before = structuredClone(state);
    const threat = enemyPhysicalThreat(world, state);
    expect(threat).toContainEqual({ pos: { x: 6, y: 3 }, enemyIds: ["enemy"] });
    expect(threat.some((tile) => tile.pos.x === 7 && tile.pos.y === 3)).toBe(
      false,
    );
    expect(state).toEqual(before);
    enemy.acted = false;
    expect(enemyPhysicalThreat(world, state)).toEqual(threat);
  });

  it.each(["enemy", "player"] as const)(
    "does not attack from an occupied %s endpoint",
    (side) => {
      const { world, state, enemy } = fixture();
      state.units.push({
        ...structuredClone(enemy),
        id: "blocker",
        side,
        kind: "escort",
        pos: { x: 5, y: 3 },
      });
      expect(
        enemyPhysicalThreat(world, state).some(
          (tile) => tile.pos.x === 6 && tile.pos.y === 3,
        ),
      ).toBe(false);
    },
  );

  it("flying can cross a wall but cannot use it as an attack endpoint", () => {
    const { world, state, enemy } = fixture();
    enemy.moveType = "flying";
    state.terrainChanges["5,3"] = "wall";
    expect(
      enemyPhysicalThreat(world, state).some(
        (tile) => tile.pos.x === 6 && tile.pos.y === 3,
      ),
    ).toBe(false);
    enemy.stats.move = 2;
    expect(enemyPhysicalThreat(world, state)).toContainEqual({
      pos: { x: 7, y: 3 },
      enemyIds: ["enemy"],
    });
    enemy.moveType = "foot";
    expect(
      enemyPhysicalThreat(world, state).some(
        (tile) => tile.pos.x === 7 && tile.pos.y === 3,
      ),
    ).toBe(false);
  });

  it("honors minimum range and the equipped maximum range", () => {
    const { world, state, enemy } = fixture();
    for (const cell of ["3,3", "5,3", "4,2", "4,4"])
      state.terrainChanges[cell] = "wall";
    enemy.range = [2, 3];
    let threat = enemyPhysicalThreat(world, state);
    expect(threat.some((tile) => tile.pos.x === 5 && tile.pos.y === 3)).toBe(
      false,
    );
    expect(threat).toContainEqual({ pos: { x: 7, y: 3 }, enemyIds: ["enemy"] });
    expect(threat.some((tile) => tile.pos.x === 8 && tile.pos.y === 3)).toBe(
      false,
    );
    enemy.equipment = { weapon: "arbalest", armor: null };
    threat = enemyPhysicalThreat(world, state);
    expect(threat).toContainEqual({ pos: { x: 5, y: 3 }, enemyIds: ["enemy"] });
    expect(threat).toContainEqual({
      pos: { x: 10, y: 3 },
      enemyIds: ["enemy"],
    });
    expect(threat.some((tile) => tile.pos.x === 11 && tile.pos.y === 3)).toBe(
      false,
    );
  });

  it("uses current movement buffs while omitting sleepers, dead units and other sides", () => {
    const { world, state, enemy } = fixture();
    state.statuses.push({
      unitId: enemy.id,
      sourceId: enemy.id,
      status: "quick",
      power: 3,
      expiresRound: 3,
      expiresSide: "enemy",
    });
    expect(enemyPhysicalThreat(world, state)).toContainEqual({
      pos: { x: 9, y: 3 },
      enemyIds: ["enemy"],
    });
    state.statuses.push({
      unitId: enemy.id,
      sourceId: enemy.id,
      status: "sleep",
      power: 1,
      expiresRound: 3,
      expiresSide: "enemy",
    });
    expect(enemyPhysicalThreat(world, state)).toEqual([]);
    state.statuses = [];
    enemy.hp = 0;
    expect(enemyPhysicalThreat(world, state)).toEqual([]);
    enemy.hp = 10;
    enemy.side = "npc";
    expect(enemyPhysicalThreat(world, state)).toEqual([]);
    enemy.side = "player";
    expect(enemyPhysicalThreat(world, state)).toEqual([]);
  });

  it("deduplicates coverage and remains ordered regardless of unit array order", () => {
    const { world, state, enemy } = fixture();
    state.units.push({
      ...structuredClone(enemy),
      id: "another",
      pos: { x: 6, y: 3 },
    });
    const result = enemyPhysicalThreat(world, state);
    expect(result).toContainEqual({
      pos: { x: 5, y: 3 },
      enemyIds: ["another", "enemy"],
    });
    expect(
      new Set(result.map((tile) => `${tile.pos.x},${tile.pos.y}`)).size,
    ).toBe(result.length);
    state.units.reverse();
    expect(enemyPhysicalThreat(world, state)).toEqual(result);
  });
});

describe("R04 temporary command coverage", () => {
  it("previews followers entering and leaving a moved leader's range without changing state", () => {
    const { world, state, enemy: leader } = fixture();
    state.units.push(
      {
        ...structuredClone(leader),
        id: "near",
        kind: "mercenary",
        commanderId: leader.id,
        pos: { x: 2, y: 3 },
        command: null,
      },
      {
        ...structuredClone(leader),
        id: "far",
        kind: "mercenary",
        commanderId: leader.id,
        pos: { x: 7, y: 3 },
        command: null,
      },
    );
    const before = structuredClone(state);
    const preview = previewCommandRange(world, state, leader.id, {
      x: 6,
      y: 3,
    })!;
    expect(preview.origin).toEqual({ x: 6, y: 3 });
    expect(preview.tiles).toContainEqual({ x: 8, y: 3 });
    expect(preview.tiles).not.toContainEqual({ x: 9, y: 3 });
    expect(preview.bonuses).toContainEqual({
      unitId: "near",
      before: { at: 2, df: 3, active: true },
      after: { at: 0, df: 0, active: false },
    });
    expect(preview.bonuses).toContainEqual({
      unitId: "far",
      before: { at: 0, df: 0, active: false },
      after: { at: 2, df: 3, active: true },
    });
    expect(state).toEqual(before);
  });

  it("moving a follower leaves the leader's center in place and updates that follower's bonus", () => {
    const { world, state, enemy: leader } = fixture();
    state.units.push({
      ...structuredClone(leader),
      id: "follower",
      kind: "mercenary",
      commanderId: leader.id,
      pos: { x: 7, y: 3 },
      command: null,
    });
    const preview = previewCommandRange(world, state, "follower", {
      x: 5,
      y: 3,
    })!;
    expect(preview.origin).toEqual(leader.pos);
    expect(preview.bonuses[0]!.after).toEqual({ at: 2, df: 3, active: true });
    leader.hp = 0;
    expect(previewCommandRange(world, state, "follower")).toBeNull();
  });

  it("honors zone's effective radius and rejects absent selection or off-map previews", () => {
    const { world, state, enemy } = fixture();
    state.statuses.push({
      unitId: enemy.id,
      sourceId: enemy.id,
      status: "zone",
      power: 1,
      expiresRound: 3,
      expiresSide: "enemy",
    });
    expect(previewCommandRange(world, state, enemy.id)!.tiles).toEqual([
      enemy.pos,
    ]);
    expect(previewCommandRange(world, state, "missing")).toBeNull();
    expect(
      previewCommandRange(world, state, enemy.id, { x: -1, y: 0 }),
    ).toBeNull();
  });
});
