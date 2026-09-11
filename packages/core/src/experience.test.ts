import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import {
  createBattle,
  type ActCommand,
  type BattleEvent,
  type BattleState,
  type Content,
  type Unit,
} from "./types";
import { apply, evaluate } from "./commands";
import {
  experienceOwner,
  gainExperience,
  recordContribution,
  settleExperience,
} from "./experience";
import { savedBattleSchema } from "@orden/schema";

function fixture() {
  const data = structuredClone(content);
  delete data.scenario.mission;
  const state = createBattle(data);
  return { data, state };
}
function get(state: BattleState, id: string) {
  return state.units.find((unit) => unit.id === id)!;
}
function attack(unitId: string, targetId: string): ActCommand {
  return {
    type: "act",
    commandId: "contribution",
    expectedRevision: 0,
    unitId,
    path: [],
    action: { type: "attack", targetId },
  };
}
function contribute(
  data: Content,
  state: BattleState,
  command: ActCommand,
  events: BattleEvent[],
) {
  const next = structuredClone(state);
  recordContribution(data, state, next, command, events);
  return next;
}
function damage(unitId: string, amount: number): BattleEvent {
  return { type: "damaged", unitId, amount };
}
function remove(
  unitId: string,
  reason: "defeated" | "retreated" = "defeated",
): BattleEvent {
  return { type: "removed", unitId, reason };
}
function finish(state: BattleState, status: "victory" | "defeat" = "victory") {
  state.outcome = {
    status,
    reason: "experience acceptance fixture",
    round: state.round,
    bonuses: [],
  };
  const events: BattleEvent[] = [];
  settleExperience(content, state, events);
  return events;
}

describe("S04 contribution attribution and anti-farming boundaries", () => {
  it("assigns a mercenary's actual damage to its commander, with one shared 20 EXP cap per enemy", () => {
    const { data, state } = fixture();
    const before = structuredClone(state);
    let next = contribute(data, state, attack("A11", "E11"), [
      damage("E11", 7),
    ]);
    expect(next.progression.contributions.A1!.damage).toBe(14);
    // Another commander cannot reclaim the cap after the same enemy heals.
    next = contribute(data, next, attack("A21", "E11"), [damage("E11", 7)]);
    expect(next.progression.contributions.A2!.damage).toBe(6);
    next = contribute(data, next, attack("A11", "E11"), [damage("E11", 10)]);
    expect(next.progression.damageAwarded.E11).toBe(20);
    expect(next.progression.contributions.A1!.damage).toBe(14);
    expect(state).toEqual(before);
  });

  it("C15 credits simultaneous direct kills and only surviving troops' retreats", () => {
    const { data, state } = fixture();
    const command: ActCommand = {
      ...attack("A3", "E1"),
      action: {
        type: "cast",
        spellId: "fireball",
        target: get(state, "E1").pos,
      },
    };
    const next = contribute(data, state, command, [
      damage("E1", 10),
      damage("E11", 10),
      damage("E12", 3),
      remove("E1"),
      remove("E11"),
      remove("E12", "retreated"),
      remove("E13", "retreated"),
    ]);
    expect(next.progression.contributions.A3).toEqual({
      damage: 46,
      kills: 80,
      retreats: 10,
      healing: 0,
      clear: 0,
    });
    const repeated = contribute(data, next, command, [
      damage("E1", 0),
      remove("E1"),
      remove("E11"),
      remove("E12", "retreated"),
    ]);
    expect(repeated.progression.contributions).toEqual(
      next.progression.contributions,
    );
  });

  it("attributes physical counter kills and retreats to the defender's commander", () => {
    const { data, state } = fixture();
    state.activeSide = "enemy";
    const next = contribute(data, state, attack("E1", "A21"), [
      damage("A21", 4),
      damage("E1", 8),
      remove("E1"),
      remove("E11", "retreated"),
      remove("E12", "retreated"),
      remove("E13", "retreated"),
    ]);
    expect(next.progression.contributions.A2).toEqual({
      damage: 16,
      kills: 60,
      retreats: 15,
      healing: 0,
      clear: 0,
    });
    expect(Object.keys(next.progression.contributions)).toEqual(["A2"]);
  });

  it("never transfers an old attack's kill credit to later ownerless removal", () => {
    const { data, state } = fixture();
    const prior = contribute(data, state, attack("A11", "E11"), [
      damage("E11", 2),
    ]);
    const wait: ActCommand = {
      ...attack("A11", "E11"),
      action: { type: "wait" },
    };
    const next = contribute(data, prior, wait, [
      damage("E11", 8),
      remove("E11"),
    ]);
    expect(next.progression.contributions.A1).toMatchObject({
      damage: 4,
      kills: 0,
    });
    expect(next.progression.lastDamageOwner.E11).toBeUndefined();
  });

  it("recursively assigns owned summons while enemy summons never supply repeatable EXP", () => {
    const { data, state } = fixture();
    const first: Unit = {
      ...structuredClone(get(state, "A3")),
      id: "summon-first",
      commanderId: "A3",
      summon: { ownerId: "A3", templateId: "salamander" },
    };
    const second: Unit = {
      ...structuredClone(first),
      id: "summon-second",
      commanderId: first.id,
      summon: { ownerId: first.id, templateId: "salamander" },
    };
    const enemy: Unit = {
      ...structuredClone(get(state, "E1")),
      id: "enemy-summon",
      commanderId: "E1",
      summon: { ownerId: "E1", templateId: "salamander" },
    };
    state.units.push(first, second, enemy);
    expect(experienceOwner(data, state, second)?.id).toBe("A3");
    let next = contribute(data, state, attack(second.id, "E11"), [
      damage("E11", 10),
      remove("E11"),
    ]);
    expect(next.progression.contributions.A3!.damage).toBe(20);
    expect(next.progression.contributions.A3!.kills).toBe(20);
    next = contribute(data, next, attack("A11", enemy.id), [
      damage(enemy.id, 10),
      remove(enemy.id),
    ]);
    expect(next.progression.contributions.A1).toBeUndefined();
    expect(next.progression.damageAwarded[enemy.id]).toBeUndefined();
  });

  it("does not pay for attacks made by enemy-controlled allies or against originally allied units", () => {
    const { data, state } = fixture();
    get(state, "A21").side = "enemy";
    const controlled = contribute(data, state, attack("A21", "A11"), [
      damage("A11", 10),
      remove("A11"),
    ]);
    expect(controlled.progression.contributions).toEqual({});
    const friendly = contribute(data, state, attack("A11", "A21"), [
      damage("A21", 10),
      remove("A21"),
    ]);
    expect(friendly.progression.contributions).toEqual({});
    get(state, "E1").side = "npc";
    const charmedEnemy = contribute(data, state, attack("E1", "E21"), [
      damage("E21", 10),
      remove("E21"),
    ]);
    expect(charmedEnemy.progression.contributions).toEqual({});
  });

  it("caps actual spell healing at 30 per caster owner and excludes treat, automatic recovery, and charmed enemies", () => {
    const { data, state } = fixture();
    const heal: ActCommand = {
      ...attack("A3", "A11"),
      action: {
        type: "cast",
        spellId: "heal-1",
        target: get(state, "A11").pos,
      },
    };
    let next = contribute(data, state, heal, [
      { type: "healed", unitId: "A11", amount: 8 },
      { type: "healed", unitId: "A21", amount: 8 },
    ]);
    next = contribute(data, next, heal, [
      { type: "healed", unitId: "A1", amount: 10 },
    ]);
    expect(next.progression.contributions.A3!.healing).toBe(30);
    expect(next.progression.healingAwarded.A3).toBe(30);
    const treat = contribute(
      data,
      state,
      { ...heal, action: { type: "treat" } },
      [{ type: "healed", unitId: "A3", amount: 3 }],
    );
    expect(treat.progression.contributions).toEqual({});
    const automatic = structuredClone(state);
    recordContribution(
      data,
      state,
      automatic,
      {
        type: "endPhase",
        commandId: "phase",
        expectedRevision: 0,
        side: "player",
      },
      [{ type: "healed", unitId: "A3", amount: 3 }],
    );
    expect(automatic.progression.contributions).toEqual({});
    get(state, "E1").side = "npc";
    expect(
      contribute(data, state, heal, [
        { type: "healed", unitId: "E1", amount: 10 },
      ]).progression.contributions,
    ).toEqual({});
  });

  it("doubles only combat contribution through the owner's sword without increasing base caps or clear rewards", () => {
    const { data, state } = fixture();
    get(state, "A1").equipment = { weapon: "masayan-sword", armor: null };
    const next = contribute(data, state, attack("A11", "E11"), [
      damage("E11", 10),
      remove("E11"),
    ]);
    expect(next.progression.damageAwarded.E11).toBe(20);
    expect(next.progression.contributions.A1).toMatchObject({
      damage: 40,
      kills: 40,
    });
    finish(next);
    expect(
      next.progression.settlement!.entries.find(
        (entry) => entry.unitId === "A1",
      ),
    ).toMatchObject({ earned: { clear: 180 }, awardedExp: 260 });
  });

  it("the actual reducer and preview share EXP events and keep failed commands entirely immutable", () => {
    const { data, state } = fixture();
    get(state, "A11").pos = { x: 2, y: 10 };
    get(state, "E11").pos = { x: 3, y: 10 };
    const command = attack("A11", "E11");
    const before = structuredClone(state);
    const result = evaluate(data, state, command);
    expect(apply(data, state, command)).toEqual(result);
    expect(state).toEqual(before);
    if (!result.ok) throw Error(result.error);
    const dealt = result.events.find(
      (event) => event.type === "damaged" && event.unitId === "E11",
    );
    expect(dealt?.type === "damaged" && dealt.amount).toBeGreaterThan(0);
    expect(result.nextState.progression.contributions.A1!.damage).toBe(
      dealt!.type === "damaged" ? dealt!.amount * 2 : -1,
    );
    const snapshot = structuredClone(result.nextState);
    expect(apply(data, result.nextState, command).ok).toBe(false);
    expect(result.nextState).toEqual(snapshot);
  });
});

describe("S04 one-time settlement and deterministic fixed growth", () => {
  it("leaves battle units untouched while learning class magic and fixed stats on the persistent roster", () => {
    const { state } = fixture();
    state.progression.contributions.A3 = {
      damage: 20,
      kills: 0,
      retreats: 0,
      healing: 0,
      clear: 0,
    };
    const units = structuredClone(state.units);
    const events = finish(state);
    expect(state.units).toEqual(units);
    const mira = state.progression.roster.find((unit) => unit.id === "A3")!;
    expect(mira.progression).toMatchObject({ level: 3, exp: 0, totalExp: 200 });
    expect(mira.stats.maxMp).toBe(11);
    expect(mira.progression!.learnedSpellIds).toContain("protection-1");
    expect(mira.spellIds).toContain("protection-1");
    expect(events).toContainEqual({
      type: "levelUp",
      unitId: "A3",
      from: 1,
      to: 3,
    });
    expect(savedBattleSchema.safeParse(state).success).toBe(true);
    const settled = structuredClone(state);
    expect(finish(state)).toEqual([]);
    expect(state).toEqual(settled);
  });

  it("retains fallen commanders for clear rewards, but defeat discards every contribution", () => {
    const victory = fixture().state;
    victory.units = victory.units.filter((unit) => unit.id !== "A2");
    finish(victory);
    expect(
      victory.progression.roster.find((unit) => unit.id === "A2")!.progression!
        .totalExp,
    ).toBe(180);
    const defeat = fixture().state;
    defeat.progression.contributions.A1 = {
      damage: 20,
      kills: 80,
      retreats: 10,
      healing: 0,
      clear: 0,
    };
    const roster = structuredClone(defeat.progression.roster);
    expect(finish(defeat, "defeat")).toEqual([]);
    expect(defeat.progression.roster).toEqual(roster);
    expect(defeat.progression.contributions).toEqual({});
    expect(defeat.progression.rewardedScenarioIds).toEqual([]);
    expect(
      defeat.progression.settlement!.entries.every(
        (entry) => entry.awardedExp === 0,
      ),
    ).toBe(true);
  });

  it("does not award contributions or clear EXP again for an already rewarded scenario", () => {
    const { state } = fixture();
    state.progression.rewardedScenarioIds.push(content.scenario.id);
    state.progression.contributions.A1 = {
      damage: 20,
      kills: 60,
      retreats: 15,
      healing: 0,
      clear: 0,
    };
    const roster = structuredClone(state.progression.roster);
    expect(finish(state)).toEqual([]);
    expect(state.progression.roster).toEqual(roster);
    expect(state.progression.settlement).toMatchObject({ duplicate: true });
    expect(
      state.progression.settlement!.entries.every(
        (entry) => entry.awardedExp === 0,
      ),
    ).toBe(true);
    expect(state.progression.rewardedScenarioIds).toEqual([
      content.scenario.id,
    ]);
  });

  it("crosses exact level boundaries, limits Lv10 carry to 100, and has four general stat growth points", () => {
    const { state } = fixture();
    const original = structuredClone(get(state, "A3"));
    const at99 = gainExperience(content, original, 99).unit;
    expect(at99.progression).toMatchObject({ level: 1, exp: 99 });
    const at100 = gainExperience(content, at99, 1).unit;
    expect(at100.progression).toMatchObject({ level: 2, exp: 0 });
    const capped = gainExperience(content, original, 5000);
    expect(capped.unit.progression).toMatchObject({
      level: 10,
      exp: 100,
      totalExp: 5000,
    });
    expect(capped.unit.stats.maxMp).toBe(19);
    expect(
      ["at", "df", "mag", "res"].reduce(
        (sum, key) =>
          sum + (capped.statGains[key as keyof typeof capped.statGains] ?? 0),
        0,
      ),
    ).toBe(4);
    expect(gainExperience(content, capped.unit, 100).unit.stats).toEqual(
      capped.unit.stats,
    );
    expect(get(state, "A3")).toEqual(original);
    expect(gainExperience(content, original, 5000)).toEqual(capped);
  });
});
