import { describe, expect, it } from "vitest";
import {
  contentSchema,
  savedBattleSchema,
  savedCommandSchema,
  spellSchema,
  unitSchema,
  type Content,
} from "@orden/schema";
import { content } from "./index";

function rejectionAfter(mutate: (value: Content) => void, message?: string) {
  const value = structuredClone(content);
  mutate(value);
  const result = contentSchema.safeParse(value);
  expect(result.success).toBe(false);
  if (message && !result.success)
    expect(
      result.error.issues.some((issue) => issue.message.includes(message)),
    ).toBe(true);
}

describe("S01b PC spell content", () => {
  it("preserves the first ten implemented PC targeting profiles within the full catalog", () => {
    expect(content.rulesVersion).toBe("0.8");
    expect(content.spells).toHaveLength(35);
    expect(
      content.spells
        .slice(0, 10)
        .map((spell) => [
          spell.id,
          spell.mpCost,
          spell.range,
          spell.shape,
          spell.radius,
        ]),
    ).toEqual([
      ["heal-1", 2, [0, 6], "radius", 1],
      ["heal-2", 4, [0, 6], "radius", 1],
      ["force-heal-1", 3, [0, 6], "squad", undefined],
      ["force-heal-2", 6, [0, 6], "squad", undefined],
      ["magic-arrow", 1, [0, 5], "single", undefined],
      ["blast", 10, [0, 2], "single", undefined],
      ["thunder", 4, [0, 7], "squad", undefined],
      ["fireball", 2, [0, 4], "radius", 3],
      ["blizzard", 3, [0, 0], "radius", 4],
      ["tornado", 2, [0, 0], "radius", 3],
    ]);
    expect(
      content.spells
        .filter((spell) => spell.effect.bonusAgainst)
        .map((spell) => [
          spell.id,
          spell.effect.bonusAgainst,
          spell.effect.bonusPower,
        ]),
    ).toEqual([
      ["thunder", "water", 2],
      ["tornado", "flying", 2],
    ]);
    expect(
      content.spells
        .filter((spell) => spell.effect.type === "heal")
        .map((spell) => [spell.id, spell.effect.power]),
    ).toEqual([
      ["heal-1", 3],
      ["heal-2", 10],
      ["force-heal-1", 3],
      ["force-heal-2", 10],
    ]);
  });

  it("teaches only the four starter spells without changing Mira's MP budget", () => {
    const units = [
      ...content.scenario.units,
      ...content.scenario.reinforcement.units,
    ];
    expect(
      units.filter((unit) => unit.spellIds.length > 0).map((unit) => unit.id),
    ).toEqual(["A3"]);
    const mira = units.find((unit) => unit.id === "A3")!;
    expect(mira.spellIds).toEqual([
      "heal-1",
      "magic-arrow",
      "fireball",
      "force-heal-1",
    ]);
    expect(mira.mp).toBe(9);
    expect(mira.stats.maxMp).toBe(9);
    expect(units.every((unit) => !Object.hasOwn(unit, "canHeal"))).toBe(true);
  });

  it("requires the spell catalog and permits an empty catalog without learners", () => {
    const { spells: _spells, ...missingCatalog } = structuredClone(content);
    expect(contentSchema.safeParse(missingCatalog).success).toBe(false);
    const value = structuredClone(content);
    value.spells = [];
    value.summons = [];
    value.items = [];
    value.scenario.inventory = {};
    value.scenario.preparation!.inventory = {};
    value.scenario.preparation!.shop = [];
    value.scenario.preparation!.rewards.items = {};
    for (const unit of value.scenario.units) {
      unit.spellIds = [];
      if (unit.progression) unit.progression.learnedSpellIds = [];
    }
    for (const job of value.classes) job.learns = [];
    expect(contentSchema.safeParse(value).success).toBe(true);
  });

  it("defaults omitted learned spells to an empty list", () => {
    const { spellIds: _spellIds, ...withoutSpells } =
      content.scenario.units[0]!;
    expect(unitSchema.parse(withoutSpells).spellIds).toEqual([]);
  });

  it("requires a radius only for radius targeting and preserves omitted optional fields", () => {
    const area = content.spells.find((spell) => spell.id === "fireball")!;
    const { radius: _radius, ...missingRadius } = area;
    expect(spellSchema.safeParse(missingRadius).success).toBe(false);
    for (const shape of ["single", "cross", "squad"] as const) {
      expect(spellSchema.safeParse({ ...area, shape }).success).toBe(false);
      const input = { ...missingRadius, shape };
      const parsed = spellSchema.parse(input);
      expect(parsed).toEqual(input);
      expect(Object.hasOwn(parsed, "radius")).toBe(false);
      expect(Object.hasOwn(parsed.effect, "bonusAgainst")).toBe(false);
      expect(Object.hasOwn(parsed.effect, "bonusPower")).toBe(false);
    }
  });

  it.each([0, -1, 0.5, 64])("rejects invalid area radius %s", (radius) => {
    const area = content.spells.find((spell) => spell.id === "fireball")!;
    expect(spellSchema.safeParse({ ...area, radius }).success).toBe(false);
  });

  it("accepts the maximum area radius of 63", () => {
    const area = content.spells.find((spell) => spell.id === "fireball")!;
    expect(spellSchema.safeParse({ ...area, radius: 63 }).success).toBe(true);
  });

  it.each([
    { bonusAgainst: "water" },
    { bonusPower: 2 },
    { bonusAgainst: "undead", bonusPower: 2 },
    { bonusAgainst: "flying", bonusPower: -1 },
    { bonusAgainst: "water", bonusPower: 11 },
    { bonusAgainst: "water", bonusPower: 1.5 },
    { type: "heal", bonusAgainst: "flying", bonusPower: 2 },
  ])("rejects incomplete or invalid damage bonuses %j", (effect) => {
    const spell = content.spells.find((item) => item.id === "magic-arrow")!;
    expect(
      spellSchema.safeParse({
        ...spell,
        effect: { ...spell.effect, ...effect },
      }).success,
    ).toBe(false);
  });

  it.each([0, 10])(
    "accepts conditional damage bonus boundary %s",
    (bonusPower) => {
      const spell = content.spells.find((item) => item.id === "magic-arrow")!;
      expect(
        spellSchema.safeParse({
          ...spell,
          effect: { ...spell.effect, bonusAgainst: "flying", bonusPower },
        }).success,
      ).toBe(true);
    },
  );

  it("rejects duplicate spell definitions and learned spell IDs", () => {
    rejectionAfter((value) => {
      value.spells.push(structuredClone(value.spells[0]!));
    }, "마법 ID 중복");
    rejectionAfter((value) => {
      value.scenario.units
        .find((unit) => unit.id === "A3")!
        .spellIds.push("heal-1");
    }, "학습 마법 ID 중복");
  });

  it.each(["A3", "E3"])("rejects undefined spells on commander %s", (id) => {
    rejectionAfter((value) => {
      const units = [
        ...value.scenario.units,
        ...value.scenario.reinforcement.units,
      ];
      units.find((unit) => unit.id === id)!.spellIds.push("missing-spell");
    }, "정의되지 않은 학습 마법");
  });

  it.each(["A31", "N1", "E31"])(
    "rejects spell learning on noncommander %s",
    (id) => {
      rejectionAfter((value) => {
        const units = [
          ...value.scenario.units,
          ...value.scenario.reinforcement.units,
        ];
        units.find((unit) => unit.id === id)!.spellIds = ["heal-1"];
      }, "지휘관만 마법 학습 가능");
    },
  );

  it("allows a known spell on a reinforcement commander", () => {
    const value = structuredClone(content);
    value.scenario.reinforcement.units.find(
      (unit) => unit.id === "E3",
    )!.spellIds = ["magic-arrow"];
    expect(contentSchema.safeParse(value).success).toBe(true);
  });

  it("accepts zero cost, zero power, and range endpoints 0 and 63", () => {
    expect(
      spellSchema.safeParse({
        ...content.spells[0]!,
        mpCost: 0,
        range: [0, 63],
        effect: { type: "heal", power: 0 },
      }).success,
    ).toBe(true);
    expect(
      spellSchema.safeParse({
        ...content.spells[1]!,
        range: [63, 63],
        effect: { type: "damage", power: 10 },
      }).success,
    ).toBe(true);
  });

  it.each([
    [3, 2],
    [-1, 3],
    [1, 64],
    [0.5, 3],
    [0, 3.5],
  ])("rejects invalid range [%s, %s]", (min, max) => {
    rejectionAfter((value) => {
      value.spells[0]!.range = [min, max];
    });
  });

  it.each([-1, 0.5])("rejects invalid MP cost %s", (cost) => {
    rejectionAfter((value) => {
      value.spells[0]!.mpCost = cost;
    });
  });

  it.each([-1, 11, 0.5])("rejects invalid effect power %s", (power) => {
    rejectionAfter((value) => {
      value.spells[0]!.effect.power = power;
    });
  });

  it.each([
    { id: "" },
    { id: "x".repeat(129) },
    { name: "" },
    { name: "   " },
    { name: "x".repeat(81) },
    { shape: "square" },
    { effect: { type: "revive", power: 3 } },
  ])("rejects unsupported or unusable spell fields %j", (fields) => {
    expect(
      spellSchema.safeParse({ ...content.spells[0]!, ...fields }).success,
    ).toBe(false);
  });
});

describe("S01 saved cast commands", () => {
  const command = {
    type: "act",
    commandId: "cast-1",
    expectedRevision: 0,
    unitId: "A3",
    path: [],
    action: { type: "cast", spellId: "cross-flare", target: { x: 63, y: 0 } },
  };

  it("round-trips spell ID and target tile without rewriting the command", () => {
    expect(savedCommandSchema.parse(command)).toEqual(command);
    const legacy = savedCommandSchema.parse({
      ...command,
      action: { type: "heal", targetId: "A3" },
    });
    expect(legacy.type).toBe("act");
    if (legacy.type !== "act") throw new Error("Expected a saved action");
    expect(legacy.action).toEqual({ type: "heal", targetId: "A3" });
  });

  it.each([
    { spellId: "" },
    { spellId: "x".repeat(129) },
    { target: { x: 64, y: 0 } },
    { target: { x: 0, y: -1 } },
    { target: { x: 0, y: 0.5 } },
    { target: { x: 0, y: 0, z: 0 } },
    { targetId: "A3" },
  ])("rejects malformed cast fields %j", (fields) => {
    expect(
      savedCommandSchema.safeParse({
        ...command,
        action: { ...command.action, ...fields },
      }).success,
    ).toBe(false);
  });
});

describe("S01 saved learned spells", () => {
  const battle = {
    mode: "practice",
    operation: null,
    rulesVersion: content.rulesVersion,
    revision: 0,
    round: 1,
    activeSide: "player",
    units: content.scenario.units,
    statuses: [],
    terrainChanges: {},
    inventory: content.scenario.inventory,
    rngSeed: content.scenario.seed,
    progression: {
      roster: structuredClone(
        content.scenario.units.filter((unit) => unit.progression),
      ),
      contributions: {},
      damageAwarded: {},
      healingAwarded: {},
      defeated: [],
      lastDamageOwner: {},
      rewardedScenarioIds: [],
      battleStartRevision: 0,
      settlement: null,
    },
    commands: [],
    mission: { capturedRound: null, reinforcement: "scheduled" },
    outcome: null,
  };

  it("preserves explicit empty learned spell lists", () => {
    expect(savedBattleSchema.parse(battle)).toEqual(battle);
  });

  it("rejects a missing learned spell field instead of repairing a saved snapshot", () => {
    const { spellIds: _spellIds, ...missingSpells } = battle.units[0]!;
    expect(
      savedBattleSchema.safeParse({
        ...battle,
        units: [missingSpells, ...battle.units.slice(1)],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate learned spell IDs in a saved snapshot", () => {
    const invalid = structuredClone(battle);
    invalid.units.find((unit) => unit.id === "A3")!.spellIds.push("heal-1");
    expect(savedBattleSchema.safeParse(invalid).success).toBe(false);
  });
});
