import { expect, it } from "vitest";
import { content } from "../../content/src/index";
import { apply, createBattle, distance, nextFollowerCommand } from "./index";
function fixture() {
  const data = structuredClone(content);
  delete data.scenario.mission;
  const state = createBattle(data);
  state.units = state.units.filter((u) => ["A2", "A21"].includes(u.id));
  state.units.find((u) => u.id === "A2")!.pos = { x: 5, y: 10 };
  return { data, state };
}
it("follows own moved leader and leaves acted mercenaries and commanders untouched", () => {
  const { data, state } = fixture();
  const before = structuredClone(state);
  const cmd = nextFollowerCommand(data, state)!;
  expect(cmd.unitId).toBe("A21");
  const r = apply(data, state, cmd);
  if (!r.ok) throw Error(r.error);
  expect(
    distance(
      r.nextState.units.find((u) => u.id === "A21")!.pos,
      state.units[0]!.pos,
    ),
  ).toBe(1);
  expect(nextFollowerCommand(data, r.nextState)).toBeNull();
  expect(state).toEqual(before);
  expect(r.nextState.units[0]!.acted).toBe(false);
});
it("attacks a safe target in command range and applies damage once", () => {
  const { data, state } = fixture();
  state.units[0]!.pos = { x: 8, y: 10 };
  const enemy = structuredClone(
    content.scenario.units.find((u) => u.id === "E11")!,
  );
  enemy.pos = { x: 11, y: 10 };
  enemy.hp = 1;
  enemy.stats.at = 0;
  state.units.push(enemy);
  const cmd = nextFollowerCommand(data, state)!;
  expect(cmd.action).toEqual({ type: "attack", targetId: enemy.id });
  const r = apply(data, state, cmd);
  if (!r.ok) throw Error(r.error);
  expect(r.nextState.units.some((u) => u.id === enemy.id)).toBe(false);
  expect(apply(data, r.nextState, cmd).ok).toBe(false);
});
it("does not chase targets beyond its own leader range", () => {
  const { data, state } = fixture();
  state.units[0]!.pos = { x: 4, y: 10 };
  state.units[1]!.pos = { x: 8, y: 10 };
  const enemy = structuredClone(
    content.scenario.units.find((u) => u.id === "E11")!,
  );
  enemy.pos = { x: 12, y: 10 };
  state.units.push(enemy);
  const cmd = nextFollowerCommand(data, state)!;
  expect(cmd.action.type).toBe("wait");
  expect(distance(cmd.path.at(-1)!, state.units[0]!.pos)).toBeLessThanOrEqual(
    3,
  );
});
it("blocked or orphaned mercenaries finish with a valid wait; no infinite queue", () => {
  const { data, state } = fixture();
  state.units = state.units.filter((u) => u.id === "A21");
  const cmd = nextFollowerCommand(data, state)!;
  expect(cmd.path).toEqual([]);
  const r = apply(data, state, cmd);
  if (!r.ok) throw Error(r.error);
  expect(nextFollowerCommand(data, r.nextState)).toBeNull();
  state.activeSide = "enemy";
  expect(nextFollowerCommand(data, state)).toBeNull();
});
it("a manual wait holds position and is never repeated by follow automation", () => {
  const { data, state } = fixture();
  const r = apply(data, state, {
    type: "act",
    unitId: "A21",
    path: [],
    action: { type: "wait" },
    commandId: "manual",
    expectedRevision: 0,
  });
  if (!r.ok) throw Error(r.error);
  expect(nextFollowerCommand(data, r.nextState)).toBeNull();
  expect(r.nextState.units[1]!.pos).toEqual(state.units[1]!.pos);
});
it("the finite follower queue has deterministic order and replays exactly", () => {
  const data = structuredClone(content);
  delete data.scenario.mission;
  const initial = createBattle(data);
  let state = initial;
  for (let i = 0; i < 10; i++) {
    const cmd = nextFollowerCommand(data, state);
    if (!cmd) break;
    expect(nextFollowerCommand(data, state)).toEqual(cmd);
    const r = apply(data, state, cmd);
    if (!r.ok) throw Error(r.error);
    state = r.nextState;
  }
  expect(nextFollowerCommand(data, state)).toBeNull();
  expect(state.commands).toHaveLength(9);
  let replay = initial;
  for (const cmd of state.commands) {
    const r = apply(data, replay, cmd);
    if (!r.ok) throw Error(r.error);
    replay = r.nextState;
  }
  expect(replay).toEqual(state);
});
