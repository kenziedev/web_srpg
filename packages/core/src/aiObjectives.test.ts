import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import {
  apply,
  createBattle,
  enemyIntent,
  nextEnemyCommand,
  phaseEndCommand,
  type BattleState,
  type Content,
} from "./index";

function isolatedMap() {
  const data = structuredClone(content);
  data.scenario.width = 7;
  data.scenario.height = 5;
  data.scenario.tiles = Array<string>(35).fill("plain");
  delete data.scenario.mission;
  data.scenario.reinforcement.units = [];
  const guard = structuredClone(
    data.scenario.units.find((u) => u.id === "E2")!,
  );
  guard.id = "guard";
  guard.pos = { x: 2, y: 1 };
  guard.stats.move = 2;
  guard.stats.at = 0;
  const bait = structuredClone(data.scenario.units.find((u) => u.id === "A1")!);
  bait.id = "bait";
  bait.pos = { x: 0, y: 0 };
  bait.stats.at = 0;
  data.scenario.units = [guard, bait];
  data.scenario.enemyPlans = [
    {
      commanderId: guard.id,
      stages: [
        { fromRound: 1, label: "동쪽 집결", target: { x: 4, y: 1 } },
        { fromRound: 3, label: "서쪽 집결", target: { x: 0, y: 1 } },
      ],
    },
  ];
  const state = createBattle(data);
  state.activeSide = "enemy";
  return { data, state };
}

function act(data: Content, state: BattleState) {
  const command = nextEnemyCommand(data, state);
  if (!command || command.type !== "act")
    throw Error("Expected one legal action");
  const result = apply(data, state, command);
  if (!result.ok) throw Error(result.error);
  return { command, state: result.nextState };
}

describe("P03a content-defined enemy operations", () => {
  it("shares the current and next stage within a squad and changes exactly on round 3", () => {
    const state = createBattle(content);
    const leader = state.units.find((u) => u.id === "E2")!;
    const follower = state.units.find((u) => u.id === "E21")!;
    for (const round of [1, 2]) {
      state.round = round;
      expect(enemyIntent(content, state, follower)).toEqual(
        enemyIntent(content, state, leader),
      );
      expect(enemyIntent(content, state, follower)).toMatchObject({
        fromRound: 1,
        target: { x: 11, y: 3 },
        next: { fromRound: 3, target: { x: 11, y: 10 } },
      });
    }
    state.round = 3;
    expect(enemyIntent(content, state, leader)).toMatchObject({
      fromRound: 3,
      target: { x: 11, y: 10 },
      next: null,
    });
    const snapshot = structuredClone(content);
    enemyIntent(content, state, leader)!.target.x = 0;
    expect(content).toEqual(snapshot);
  });

  it("uses objective distance, even when a harmless opposing unit is closer in the other direction", () => {
    const { data, state } = isolatedMap();
    const before = structuredClone(state);
    const decision = act(data, state);
    expect(decision.state.units.find((u) => u.id === "guard")!.pos).toEqual({
      x: 4,
      y: 1,
    });
    expect(state).toEqual(before);
    state.round = 3;
    expect(
      act(data, state).state.units.find((u) => u.id === "guard")!.pos,
    ).toEqual({ x: 0, y: 1 });
  });

  it("follows a detour that initially increases geometric distance instead of walking into a river", () => {
    const { data, state } = isolatedMap();
    const water = content.terrains.find((t) => t.costs.foot === null)!;
    for (let y = 0; y < 4; y++) data.scenario.tiles[y * 7 + 3] = water.id;
    const decision = act(data, state);
    expect(decision.command.path).toEqual([
      { x: 2, y: 2 },
      { x: 2, y: 3 },
    ]);
    expect(decision.state.units.find((u) => u.id === "guard")!.pos).toEqual({
      x: 2,
      y: 3,
    });
  });

  it("takes the cheaper route around expensive terrain using forward entry costs", () => {
    const { data, state } = isolatedMap();
    state.units[0]!.stats.move = 3;
    const mud = structuredClone(data.terrains.find((t) => t.id === "plain")!);
    mud.id = "slow";
    mud.costs.foot = 9;
    data.terrains.push(mud);
    data.scenario.tiles[1 * 7 + 3] = mud.id;
    const decision = act(data, state);
    expect(decision.command.path).not.toContainEqual({ x: 3, y: 1 });
    expect(decision.command.path).toHaveLength(3);
    expect(decision.state.units[0]!.pos.x).toBe(4);
  });

  it("does not force an unsafe objective rush over a safe lethal attack", () => {
    const { data, state } = isolatedMap();
    state.units[0]!.stats.at = 20;
    state.units[1]!.hp = 1;
    state.units[1]!.pos = { x: 1, y: 1 };
    expect(act(data, state).command.action).toEqual({
      type: "attack",
      targetId: "bait",
    });
  });

  it("approaches an occupied objective without overlapping or deleting its occupant", () => {
    const { data, state } = isolatedMap();
    state.units[1]!.pos = { x: 4, y: 1 };
    const decision = act(data, state);
    expect(decision.state.units[0]!.pos).toEqual({ x: 3, y: 1 });
    expect(decision.state.units[1]).toEqual(state.units[1]);
  });

  it("unreachable and absent plans still produce bounded legal deterministic decisions", () => {
    const { data, state } = isolatedMap();
    const water = content.terrains.find((t) => t.costs.foot === null)!;
    for (let y = 0; y < 5; y++) data.scenario.tiles[y * 7 + 3] = water.id;
    const before = structuredClone({ data, state });
    const first = act(data, state);
    expect(first.command).toEqual(nextEnemyCommand(data, state));
    expect({ data, state }).toEqual(before);
    expect(nextEnemyCommand(data, first.state)).toEqual(
      phaseEndCommand(first.state),
    );
    delete data.scenario.enemyPlans;
    expect(enemyIntent(data, state, state.units[0]!)).toBeNull();
    expect(act(data, state).command).toEqual(nextEnemyCommand(data, state));
  });

  it("re-evaluates changing blockers and ends a real enemy phase without duplicate actions", () => {
    let state = createBattle(content);
    state.activeSide = "enemy";
    const before = structuredClone(state);
    for (let count = 0; count < 12 && state.activeSide === "enemy"; count++) {
      const command = nextEnemyCommand(content, state)!;
      expect(command).toEqual(nextEnemyCommand(content, state));
      const result = apply(content, state, command);
      if (!result.ok) throw Error(result.error);
      state = result.nextState;
    }
    expect(state.activeSide).toBe("npc");
    expect(before.commands).toHaveLength(0);
    const actions = state.commands.filter((c) => c.type === "act");
    expect(new Set(actions.map((c) => c.unitId)).size).toBe(actions.length);
    const stale = actions[0]!;
    const snapshot = structuredClone(state);
    expect(apply(content, state, stale).ok).toBe(false);
    expect(state).toEqual(snapshot);
  });
});
