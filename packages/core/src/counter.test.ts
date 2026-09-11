import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import {
  canCounter,
  createBattle,
  apply,
  damage,
  type ActCommand,
} from "./index";

function scene() {
  const data = structuredClone(content);
  delete data.scenario.mission;
  const state = createBattle(data);
  const attacker = state.units.find((unit) => unit.id === "A2")!;
  const defender = state.units.find((unit) => unit.id === "E2")!;
  attacker.pos = { x: 3, y: 3 };
  defender.pos = { x: 5, y: 3 };
  attacker.equipment = { weapon: "arbalest", armor: null };
  defender.equipment = { weapon: "arbalest", armor: null };
  attacker.range = defender.range = [1, 1];
  state.units = [attacker, defender];
  const command: ActCommand = {
    type: "act",
    commandId: "counter",
    expectedRevision: 0,
    unitId: attacker.id,
    path: [],
    action: { type: "attack", targetId: defender.id },
  };
  return { data, state, attacker, defender, command };
}

describe("S02-C01 equipment and sleep counter query matches command results", () => {
  it.each([1, 2, 6, 7])(
    "equipment range includes only legal distance %i",
    (gap) => {
      const { data, state, attacker, defender } = scene();
      defender.pos = { x: attacker.pos.x + gap, y: attacker.pos.y };
      expect(canCounter(data, state, defender, attacker)).toBe(gap <= 6);
      defender.equipment = { weapon: null, armor: null };
      expect(canCounter(data, state, defender, attacker)).toBe(gap === 1);
    },
  );
  it("uses the moved attacker position instead of the stored origin", () => {
    const { data, state, attacker, defender } = scene();
    const snapshot = structuredClone(state);
    expect(
      canCounter(data, state, defender, { ...attacker, pos: { x: 12, y: 3 } }),
    ).toBe(false);
    expect(
      canCounter(data, state, defender, { ...attacker, pos: { x: 11, y: 3 } }),
    ).toBe(true);
    expect(state).toEqual(snapshot);
  });
  it("a sleeping equipped defender cannot counter even with a legal bow range", () => {
    const { data, state, attacker, defender, command } = scene();
    state.statuses.push({
      unitId: defender.id,
      status: "sleep",
      power: 0,
      sourceId: attacker.id,
      expiresRound: 2,
      expiresSide: "player",
    });
    expect(canCounter(data, state, defender, attacker)).toBe(false);
    const result = apply(data, state, command);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.error);
    expect(result.events).toContainEqual({
      type: "damaged",
      unitId: attacker.id,
      amount: 0,
    });
    state.statuses = [];
    expect(canCounter(data, state, defender, attacker)).toBe(true);
    const awake = apply(data, state, command);
    expect(awake.ok && awake.events).toContainEqual({
      type: "damaged",
      unitId: attacker.id,
      amount: Math.min(attacker.hp, damage(data, state, defender, attacker)),
    });
  });
  it("zero damage is still a valid counter, while an escort never counters", () => {
    const { data, state, attacker, defender } = scene();
    defender.stats.at = 0;
    expect(canCounter(data, state, defender, attacker)).toBe(true);
    expect(damage(data, state, defender, attacker)).toBe(0);
    defender.kind = "escort";
    expect(canCounter(data, state, defender, attacker)).toBe(false);
  });
});
