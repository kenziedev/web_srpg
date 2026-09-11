import { describe, expect, it } from "vitest";
import {
  contentSchema,
  savedCommandSchema,
  savedProgressionSchema,
  unitProgressionSchema,
  type Content,
} from "@orden/schema";
import { content } from "./index";

function invalid(mutate: (data: Content) => void) {
  const data = structuredClone(content);
  mutate(data);
  expect(contentSchema.safeParse(data).success).toBe(false);
}
const ledger = () => ({
  roster: structuredClone(
    content.scenario.units.filter((unit) => unit.progression),
  ),
  contributions: {
    A1: { damage: 20, kills: 60, retreats: 15, healing: 0, clear: 0 },
  },
  damageAwarded: { E1: 20 },
  healingAwarded: { A3: 30 },
  defeated: ["E1"],
  lastDamageOwner: { E1: "A1" },
  rewardedScenarioIds: [],
  battleStartRevision: 0,
  settlement: null,
});

describe("S04/S05 growth content", () => {
  it("defines six independent base classes with two branches and one promotion stat each", () => {
    const roots = content.classes.filter((job) => job.tier === 1);
    expect(roots).toHaveLength(6);
    expect(content.classes.filter((job) => job.tier === 2)).toHaveLength(12);
    for (const root of roots) expect(root.promotions).toHaveLength(2);
    expect(new Set(roots.flatMap((job) => job.promotions)).size).toBe(12);
    for (const job of content.classes.filter((entry) => entry.tier === 2))
      expect(Object.values(job.statBonus)).toEqual([1]);
    expect(
      content.classes.find((job) => job.id === "sky-knight")!.moveType,
    ).toBe("flying");
    expect(
      content.classes.find((job) => job.id === "naval-captain")!.moveType,
    ).toBe("amphibious");
    expect(
      content.classes.find((job) => job.id === "arcane-commander")!.squadRes,
    ).toBe(2);
  });

  it("starts only the original three commanders at Lv1 without modifying their existing combat roles", () => {
    const roster = content.scenario.units.filter((unit) => unit.progression);
    expect(roster.map((unit) => unit.id)).toEqual(["A1", "A2", "A3"]);
    expect(roster.map((unit) => unit.progression!.classId)).toEqual([
      "lord",
      "warrior",
      "mage",
    ]);
    for (const unit of roster) {
      expect(unit.progression).toMatchObject({
        level: 1,
        exp: 0,
        totalExp: 0,
        learnedSpellIds: unit.spellIds,
      });
      expect(unit.progression!.classHistory).toEqual([
        unit.progression!.baseClassId,
      ]);
    }
    const mira = roster.find((unit) => unit.id === "A3")!;
    expect(mira.stats).toEqual({
      at: 8,
      df: 5,
      mag: 4,
      res: 5,
      maxMp: 9,
      move: 4,
    });
    expect(mira.unitType).toBe("archer");
    expect(mira.range).toEqual([2, 3]);
    expect(mira.spellIds).toEqual([
      "heal-1",
      "magic-arrow",
      "fireball",
      "force-heal-1",
    ]);
  });

  it("limits each profile to four combat stat points and explicitly budgets Mira MP", () => {
    expect(content.growthProfiles).toHaveLength(3);
    for (const profile of content.growthProfiles) {
      expect(
        profile.levels.reduce(
          (sum, entry) =>
            sum +
            (entry.gains.at ?? 0) +
            (entry.gains.df ?? 0) +
            (entry.gains.mag ?? 0) +
            (entry.gains.res ?? 0),
          0,
        ),
      ).toBe(4);
    }
    expect(
      content.growthProfiles
        .find((profile) => profile.id === "mira")!
        .levels.filter((entry) => entry.gains.maxMp)
        .map((entry) => [entry.level, entry.gains.maxMp]),
    ).toEqual([
      [2, 2],
      [4, 2],
      [6, 2],
      [8, 2],
      [10, 2],
    ]);
  });

  it("provides class learning for every ordinary or natural summon spell while reserving equipment grants", () => {
    const allLearned = new Set(
      content.classes.flatMap((job) =>
        job.learns.flatMap((entry) => entry.spellIds),
      ),
    );
    expect([...allLearned].sort()).toEqual(
      content.spells
        .filter((spell) => spell.learnable !== false)
        .map((spell) => spell.id)
        .sort(),
    );
    const support = content.classes.find(
      (job) => job.id === "arcane-commander",
    )!;
    expect(
      support.learns
        .flatMap((entry) => entry.spellIds)
        .some(
          (id) =>
            content.spells.find((spell) => spell.id === id)!.effect.type ===
            "damage",
        ),
    ).toBe(false);
  });

  it("rejects broken, cyclic, duplicate, or multi-parent class references", () => {
    invalid((data) => data.classes.push(data.classes[0]!));
    invalid((data) => {
      data.classes[0]!.promotions[0] = "missing";
    });
    invalid((data) => {
      data.classes[0]!.promotions[0] = data.classes[0]!.id;
    });
    invalid((data) => {
      data.classes[0]!.promotions.push(data.classes[0]!.promotions[0]!);
    });
    invalid((data) => {
      data.classes[3]!.promotions.push(data.classes[0]!.promotions[0]!);
    });
    invalid((data) => {
      data.classes[1]!.promotions = [data.classes[0]!.id];
    });
    invalid((data) => {
      data.classes[1]!.statBonus = { at: 1, df: 1 };
    });
    invalid((data) => {
      data.classes[0]!.statBonus = { at: 1 };
    });
    invalid((data) => {
      data.classes[1]!.range = [3, 1];
    });
  });

  it("rejects invalid growth budgets, ordering, and spell learning references", () => {
    invalid((data) => data.growthProfiles.push(data.growthProfiles[0]!));
    invalid((data) => {
      data.growthProfiles[0]!.levels[0]!.gains = { at: 2 };
    });
    invalid((data) => {
      data.growthProfiles[0]!.levels.reverse();
    });
    invalid((data) => {
      data.growthProfiles[0]!.levels[0]!.gains = {};
    });
    invalid((data) => {
      data.classes[12]!.learns[0]!.spellIds = ["missing"];
    });
    invalid((data) => {
      data.classes[12]!.learns[0]!.spellIds = ["summon-aniki"];
    });
    invalid((data) => {
      data.classes[12]!.learns[0]!.spellIds.push("heal-1");
    });
    invalid((data) => {
      data.classes[12]!.learns.reverse();
    });
    invalid((data) => {
      data.scenario.units[0]!.progression!.growthId = "missing";
    });
    invalid((data) => {
      data.scenario.units[0]!.progression!.baseClassId = "mage";
    });
    invalid((data) => {
      data.scenario.units.find(
        (unit) => unit.kind === "mercenary",
      )!.progression = structuredClone(data.scenario.units[0]!.progression);
    });
  });
});

describe("S04/S05 strict progression saves", () => {
  it("preserves progression ledgers and command variants without filling missing fields", () => {
    const source = ledger();
    expect(savedProgressionSchema.parse(source)).toEqual(source);
    for (const key of Object.keys(source)) {
      const missing: Record<string, unknown> = { ...source };
      delete missing[key];
      expect(savedProgressionSchema.safeParse(missing).success).toBe(false);
    }
    const base = { commandId: "growth-1", expectedRevision: 1 };
    for (const command of [
      { ...base, type: "promote", unitId: "A1", classId: "frontline-captain" },
      { ...base, type: "reclass", unitId: "A1" },
      { ...base, type: "deploy" },
    ]) {
      expect(savedCommandSchema.parse(command)).toEqual(command);
      expect(
        savedCommandSchema.safeParse({ ...command, reward: 100 }).success,
      ).toBe(false);
    }
  });

  it("bounds growth levels, banked experience, and the remembered class path", () => {
    const base = content.scenario.units[0]!.progression!;
    expect(
      unitProgressionSchema.parse({ ...base, level: 10, exp: 100 }),
    ).toMatchObject({ level: 10, exp: 100 });
    for (const fields of [
      { level: 0 },
      { level: 11 },
      { level: 1, exp: 100 },
      { level: 10, exp: 101 },
      { exp: -1 },
      { totalExp: 1.5 },
      { classHistory: [] },
      { classHistory: ["warrior"] },
      { learnedSpellIds: ["heal-1", "heal-1"] },
    ])
      expect(
        unitProgressionSchema.safeParse({ ...base, ...fields }).success,
      ).toBe(false);
  });

  it("rejects altered nested progression fields and EXP cap violations", () => {
    const source = ledger();
    for (const fields of [
      { damageAwarded: { E1: 21 } },
      { healingAwarded: { A3: 31 } },
      {
        contributions: {
          A1: { damage: 0, kills: -1, retreats: 0, healing: 0, clear: 0 },
        },
      },
      {
        contributions: {
          A1: {
            damage: 0,
            kills: 0,
            retreats: 0,
            healing: 0,
            clear: 0,
            hidden: true,
          },
        },
      },
      { defeated: ["E1", "E1"] },
      { rewardedScenarioIds: ["S01", "S01"] },
      { battleStartRevision: -1 },
      { roster: [source.roster[0], source.roster[0]] },
      {
        roster: [
          {
            ...source.roster[0],
            progression: { ...source.roster[0]!.progression, extra: true },
          },
        ],
      },
    ])
      expect(
        savedProgressionSchema.safeParse({ ...source, ...fields }).success,
      ).toBe(false);
  });
});
