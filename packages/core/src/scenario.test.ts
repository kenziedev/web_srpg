import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import {
  apply,
  createBattle,
  escortForecast,
  phaseEndCommand,
  type BattleState,
  type Content,
} from "./index";
function end(state: BattleState, data: Content = content) {
  const result = apply(data, state, phaseEndCommand(state));
  if (!result.ok) throw Error(result.error);
  return result.nextState;
}
function openRoad() {
  const s = createBattle(content);
  s.units = s.units.filter((u) => ["A1", "N1"].includes(u.id));
  s.units.find((u) => u.id === "A1")!.pos = { x: 0, y: 9 };
  s.mission.reinforcement = "cancelled";
  return s;
}
function npcEnd(round = 3) {
  const s = createBattle(content);
  s.activeSide = "npc";
  s.round = round;
  return s;
}

describe("escort and battle outcome", () => {
  it("escapes on exactly the ninth unobstructed NPC phase and replays the full log", () => {
    const initial = openRoad();
    let s = initial;
    while (!s.outcome && s.commands.length < 30) s = end(s);
    expect(s.outcome).toMatchObject({
      status: "victory",
      round: 9,
      bonuses: ["호송대 안전 탈출"],
    });
    expect(s.units.find((u) => u.id === "N1")!.pos).toEqual({ x: 19, y: 10 });
    let replay = initial;
    for (const command of s.commands) {
      const r = apply(content, replay, command);
      if (!r.ok) throw Error(r.error);
      replay = r.nextState;
    }
    expect(replay).toEqual(s);
    expect(initial.commands).toEqual([]);
    const snapshot = structuredClone(s);
    expect(apply(content, s, phaseEndCommand(s)).ok).toBe(false);
    expect(s).toEqual(snapshot);
  });
  it("passes allies but chooses the last empty tile; enemy blocks passage", () => {
    const s = createBattle(content);
    const ally = s.units.find((u) => u.id === "A11")!;
    ally.pos = { x: 2, y: 10 };
    expect(escortForecast(content, s)?.to).toEqual({ x: 3, y: 10 });
    ally.pos = { x: 3, y: 10 };
    expect(escortForecast(content, s)).toMatchObject({
      to: { x: 2, y: 10 },
      blockedBy: ally.id,
    });
    s.units.find((u) => u.id === "A12")!.pos = { x: 2, y: 10 };
    expect(escortForecast(content, s)?.to).toEqual({ x: 1, y: 10 });
    ally.pos = { x: 5, y: 9 };
    s.units.find((u) => u.id === "A12")!.pos = { x: 5, y: 10 };
    s.units.find((u) => u.id === "E11")!.pos = { x: 2, y: 10 };
    expect(escortForecast(content, s)).toMatchObject({
      to: { x: 1, y: 10 },
      blockedBy: "E11",
    });
    const before = structuredClone(s);
    s.activeSide = "enemy";
    const next = end(s);
    expect(next.units.find((u) => u.id === "N1")!.pos).toEqual({ x: 1, y: 10 });
    expect(before.units).toEqual(s.units);
  });
  it("C12: escape in final allowed NPC phase wins; failure only at round end", () => {
    const s = openRoad();
    s.round = 10;
    s.activeSide = "enemy";
    s.units.find((u) => u.id === "N1")!.pos = { x: 17, y: 10 };
    expect(end(s).outcome?.status).toBe("victory");
    s.units.find((u) => u.id === "N1")!.pos = { x: 16, y: 10 };
    const npc = end(s);
    expect(npc.outcome).toBeNull();
    expect(end(npc).outcome).toMatchObject({ status: "defeat", round: 10 });
  });
  it("C08: simultaneous protected commander and enemy commander deaths lose before victory", () => {
    const s = createBattle(content);
    s.units = s.units.filter((u) => ["A1", "E1", "N1"].includes(u.id));
    const a = s.units.find((u) => u.id === "A1")!;
    const e = s.units.find((u) => u.id === "E1")!;
    a.pos = { x: 2, y: 10 };
    e.pos = { x: 3, y: 10 };
    a.hp = 1;
    e.hp = 1;
    a.stats.at = 30;
    e.stats.at = 30;
    s.units.find((u) => u.id === "N1")!.pos = { x: 19, y: 10 };
    const r = apply(content, s, {
      type: "act",
      unitId: "A1",
      path: [],
      action: { type: "attack", targetId: "E1" },
      commandId: "mutual",
      expectedRevision: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nextState.units.map((u) => u.id)).toEqual(["N1"]);
    expect(r.nextState.outcome?.status).toBe("defeat");
    expect(s.outcome).toBeNull();
  });
  it("escort destruction ends battle immediately; manual NPC commands are rejected", () => {
    const s = createBattle(content);
    s.activeSide = "enemy";
    const e = s.units.find((u) => u.id === "E11")!;
    e.pos = { x: 2, y: 10 };
    e.stats.at = 30;
    const command = {
      type: "act" as const,
      unitId: e.id,
      path: [],
      action: { type: "attack" as const, targetId: "N1" },
      commandId: "escort-loss",
      expectedRevision: 0,
    };
    const r = apply(content, s, command);
    expect(r.ok && r.nextState.outcome?.status).toBe("defeat");
    s.activeSide = "npc";
    expect(
      apply(content, s, { ...command, unitId: "N1", action: { type: "wait" } })
        .ok,
    ).toBe(false);
  });
});

describe("round-end capture and atomic reinforcements", () => {
  it("only a living player commander captures; round 3 capture cancels that same wave", () => {
    const s = npcEnd();
    s.units.find((u) => u.id === "A31")!.pos = { x: 7, y: 2 };
    const merc = end(s);
    expect(merc.mission.capturedRound).toBeNull();
    expect(merc.mission.reinforcement).toBe("spawned");
    s.units.find((u) => u.id === "A31")!.pos = { x: 4, y: 6 };
    s.units.find((u) => u.id === "A3")!.pos = { x: 7, y: 2 };
    const commander = end(s);
    expect(commander.mission).toEqual({
      capturedRound: 3,
      reinforcement: "cancelled",
    });
    expect(commander.units).toHaveLength(21);
  });
  it.each([2, 3])(
    "capture round %s correctly controls early bonus",
    (round) => {
      const s = npcEnd(round);
      s.units.find((u) => u.id === "A3")!.pos = { x: 7, y: 2 };
      let next = end(s);
      next.activeSide = "enemy";
      next.units.find((u) => u.id === "N1")!.pos = { x: 18, y: 10 };
      next = end(next);
      expect(next.outcome?.status).toBe("victory");
      expect(next.outcome?.bonuses.includes("봉화 조기 점령")).toBe(
        round === 2,
      );
    },
  );
  it("C13: one blocked member defers the whole squad without displacing existing units, then retries once", () => {
    const s = npcEnd();
    s.units.find((u) => u.id === "A31")!.pos = { x: 12, y: 1 };
    s.units.find((u) => u.id === "A32")!.pos = { x: 12, y: 0 };
    const before = s.units.map((u) => ({ id: u.id, pos: u.pos }));
    let next = end(s);
    expect(next.mission.reinforcement).toBe("deferred");
    expect(next.units.map((u) => ({ id: u.id, pos: u.pos }))).toEqual(before);
    next.units.find((u) => u.id === "A32")!.pos = { x: 11, y: 0 };
    next.activeSide = "npc";
    next = end(next);
    expect(next.mission.reinforcement).toBe("spawned");
    expect(next.units.find((u) => u.id === "E31")!.pos).toEqual({
      x: 12,
      y: 0,
    });
    expect(
      next.units
        .filter((u) => ["E3", "E31", "E32"].includes(u.id))
        .every((u) => u.acted),
    ).toBe(true);
    const enemy = end(next);
    expect(enemy.units.find((u) => u.id === "E31")!.acted).toBe(false);
    next.activeSide = "npc";
    next = end(next);
    expect(next.units.filter((u) => u.id === "E31")).toHaveLength(1);
  });
  it("capture cancels deferred waves and unit capacity also defers", () => {
    const data = structuredClone(content);
    data.scenario.mission!.unitLimit = 21;
    const s = npcEnd();
    let next = end(s, data);
    expect(next.mission.reinforcement).toBe("deferred");
    next.units.find((u) => u.id === "A3")!.pos = { x: 7, y: 2 };
    next.activeSide = "npc";
    next = end(next, data);
    expect(next.mission.reinforcement).toBe("cancelled");
  });
  it("uses alternate slots when greedy primary placement would block a full squad", () => {
    const data = structuredClone(content);
    data.scenario.reinforcement.reserves.E3 = [{ x: 13, y: 0 }];
    data.scenario.reinforcement.reserves.E31 = [{ x: 13, y: 1 }];
    const s = npcEnd();
    s.units.find((u) => u.id === "A31")!.pos = { x: 12, y: 1 };
    const next = end(s, data);
    expect(next.mission.reinforcement).toBe("spawned");
    expect(next.units.find((u) => u.id === "E3")!.pos).toEqual({ x: 13, y: 0 });
    expect(next.units.find((u) => u.id === "E31")!.pos).toEqual({
      x: 13,
      y: 1,
    });
  });
});
