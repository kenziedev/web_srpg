import { describe, expect, it } from "vitest";
import {
  contentSchema,
  itemSchema,
  savedBattleSchema,
  savedCommandSchema,
  spellSchema,
  type Content,
} from "@orden/schema";
import { content } from "./index";
import spellReference from "../references/langrisser2-pc-spells.json";
import itemReference from "../references/langrisser2-pc-items.json";

const baseBattle = () => ({
  rulesVersion: content.rulesVersion,
  revision: 0,
  round: 1,
  activeSide: "player",
  units: structuredClone(content.scenario.units),
  statuses: [],
  terrainChanges: {},
  inventory: structuredClone(content.scenario.inventory),
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
});
function invalidContent(mutate: (value: Content) => void) {
  const value = structuredClone(content);
  mutate(value);
  expect(contentSchema.safeParse(value).success).toBe(false);
}

describe("S02 full PC catalogs and reference integrity", () => {
  it("covers all 26 ordinary spells, 9 summons and 34 unique PC items", () => {
    expect(
      content.spells
        .filter((spell) => spell.effect.type !== "summon")
        .map((spell) => spell.id)
        .sort(),
    ).toEqual(spellReference.spells.map((spell) => spell.id).sort());
    expect(content.summons.map((summon) => summon.id).sort()).toEqual(
      spellReference.summons.map((summon) => summon.id).sort(),
    );
    expect(
      content.spells
        .filter((spell) => spell.effect.type === "summon")
        .map((spell) => spell.effect.summonId)
        .sort(),
    ).toEqual(content.summons.map((summon) => summon.id).sort());
    expect(content.items.map((item) => item.id).sort()).toEqual(
      itemReference.items.map((item) => item.id).sort(),
    );
    expect(Object.values(content.scenario.inventory!)).toEqual(
      Array(34).fill(1),
    );
  });

  it("keeps all ordinary PC MP costs and separates the three equipment summons", () => {
    for (const spell of spellReference.spells)
      expect(
        content.spells.find((entry) => entry.id === spell.id)!.mpCost,
      ).toBe(spell.baseMpCost);
    expect(
      content.spells
        .filter((spell) => spell.learnable === false)
        .map((spell) => spell.id)
        .sort(),
    ).toEqual(["summon-aniki", "summon-fenrir", "summon-sleipnir"]);
    expect(
      content.items.flatMap((item) => item.grantedSpellIds).sort(),
    ).toEqual(["summon-aniki", "summon-fenrir", "summon-sleipnir"]);
    expect(
      content.items
        .filter((item) => item.unavailableReason)
        .map((item) => item.id)
        .sort(),
    ).toEqual([]);
    expect(
      content.items.find((item) => item.id === "masayan-sword")!.modifiers
        .expMultiplier,
    ).toBe(2);
    expect(
      content.items.find((item) => item.id === "runestone")!.useEffect,
    ).toBe("class-reset");
  });

  it("rejects duplicate definitions, unresolved references and excess equipped ownership", () => {
    invalidContent((data) => data.summons.push(data.summons[0]!));
    invalidContent((data) => data.items.push(data.items[0]!));
    invalidContent((data) => {
      data.spells.find(
        (spell) => spell.effect.type === "summon",
      )!.effect.summonId = "missing";
    });
    invalidContent((data) => {
      data.summons[0]!.spellIds = ["missing"];
    });
    invalidContent((data) => {
      data.summons[0]!.spellIds = ["heal-1", "heal-1"];
    });
    invalidContent((data) => {
      data.items[0]!.grantedSpellIds = ["missing"];
    });
    invalidContent((data) => {
      data.scenario.inventory!.missing = 1;
    });
    invalidContent((data) => {
      data.terrains[0]!.destroyedTo = "missing";
    });
    invalidContent((data) => {
      data.terrains[0]!.destroyedTo = data.terrains[0]!.id;
    });
    invalidContent((data) => {
      data.scenario.units.find((unit) => unit.id === "A1")!.equipment = {
        weapon: "knife",
        armor: null,
      };
      data.scenario.units.find((unit) => unit.id === "A2")!.equipment = {
        weapon: "knife",
        armor: null,
      };
    });
  });

  it("validates equipment slots, restrictions, availability and runtime-only summon markers", () => {
    for (const equipment of [
      { weapon: "missing", armor: null },
      { weapon: "robe", armor: null },
      { weapon: "runestone", armor: null },
      { weapon: null, armor: "cross" },
      { weapon: null, armor: "runestone" },
    ])
      invalidContent((data) => {
        data.scenario.units.find((unit) => unit.id === "A1")!.equipment =
          equipment;
      });
    invalidContent((data) => {
      data.scenario.units.find((unit) => unit.id === "A11")!.equipment = {
        weapon: "knife",
        armor: null,
      };
    });
    invalidContent((data) => {
      data.scenario.units[0]!.summon = {
        ownerId: "A3",
        templateId: "valkyrie",
      };
    });
    invalidContent((data) => {
      data.scenario.units[0]!.refreshedRound = 1;
    });
    const valid = structuredClone(content);
    const caster = valid.scenario.units.find((unit) => unit.id === "A3")!;
    caster.equipment = { weapon: "orb", armor: null };
    caster.mp = 18;
    expect(contentSchema.safeParse(valid).success).toBe(true);
    caster.mp = 19;
    expect(contentSchema.safeParse(valid).success).toBe(false);
  });

  it("rejects incoherent spell effect fields instead of silently treating them as damage", () => {
    const attack = content.spells.find((spell) => spell.id === "attack-1")!;
    for (const key of ["status", "hostile", "duration"] as const) {
      const effect = { ...attack.effect };
      delete effect[key];
      expect(spellSchema.safeParse({ ...attack, effect }).success).toBe(false);
    }
    const damage = content.spells.find((spell) => spell.id === "magic-arrow")!;
    for (const effect of [
      { type: "heal", power: 3, terrainChange: "center" },
      { type: "heal", power: 3, groundOnly: true },
      { type: "heal", power: 3, commanderOnly: true },
      { type: "summon", power: 0 },
      { type: "heal", power: 0, summonId: "valkyrie" },
      { type: "teleport", power: 0 },
      { type: "again", power: 0 },
      { type: "slay-undead", power: 2 },
    ])
      expect(spellSchema.safeParse({ ...damage, effect }).success).toBe(false);
  });

  it("validates item modifier ranges and unambiguous grant lists", () => {
    const item = content.items[0]!;
    for (const modifiers of [
      { attackRange: [6, 1] },
      { maxMpMultiplier: 0 },
      { maxMpMultiplier: 5 },
      { move: 0.5 },
      { at: -65 },
    ])
      expect(itemSchema.safeParse({ ...item, modifiers }).success).toBe(false);
    expect(
      itemSchema.safeParse({ ...item, grantedSpellIds: ["heal-1", "heal-1"] })
        .success,
    ).toBe(false);
    expect(
      itemSchema.safeParse({ ...item, allowedUnitTypes: ["cleric", "cleric"] })
        .success,
    ).toBe(false);
  });
});

describe("S02 strict saved systems", () => {
  it("requires every new battle field and preserves explicit empty state", () => {
    const battle = baseBattle();
    expect(savedBattleSchema.parse(battle)).toEqual(battle);
    for (const key of [
      "statuses",
      "terrainChanges",
      "inventory",
      "rngSeed",
      "progression",
    ] as const) {
      const missing: Record<string, unknown> = { ...battle };
      delete missing[key];
      expect(savedBattleSchema.safeParse(missing).success).toBe(false);
    }
  });

  it("round-trips statuses, charm origins, terrain, equipment and summons without dropping fields", () => {
    const battle = baseBattle();
    const extended = {
      ...battle,
      statuses: [
        {
          unitId: "E1",
          status: "charm",
          power: 0,
          sourceId: "A3",
          expiresRound: 2,
          expiresSide: "player",
          originalSide: "enemy",
        },
      ],
      terrainChanges: { "0,0": "plain", "63,63": "plain" },
      units: battle.units.map((unit, index) =>
        index === 0
          ? {
              ...unit,
              equipment: { weapon: "knife", armor: null },
              refreshedRound: 1,
            }
          : unit,
      ),
    };
    expect(savedBattleSchema.parse(extended)).toEqual(extended);
    const summon = {
      ...battle.units[0]!,
      id: "summon-1",
      commanderId: "A3",
      summon: { ownerId: "A3", templateId: "valkyrie" },
    };
    expect(
      savedBattleSchema.safeParse({ ...battle, units: [summon] }).success,
    ).toBe(true);
    expect(
      savedBattleSchema.safeParse({
        ...battle,
        units: [{ ...summon, summon: { ...summon.summon, unknown: true } }],
      }).success,
    ).toBe(false);
  });

  it("rejects malformed nested state and invalid random seeds", () => {
    const battle = baseBattle();
    const status = {
      unitId: "A3",
      status: "mute",
      power: 0,
      sourceId: "E1",
      expiresRound: 2,
      expiresSide: "enemy",
    };
    for (const fields of [
      { statuses: [{ ...status, extra: true }] },
      { statuses: [{ ...status, expiresRound: 0 }] },
      { statuses: [{ ...status, status: "charm" }] },
      { statuses: [{ ...status, originalSide: "player" }] },
      { terrainChanges: { "64,0": "plain" } },
      { terrainChanges: { "01,0": "plain" } },
      { inventory: { knife: -1 } },
      { inventory: { knife: 1.5 } },
      { inventory: { knife: 10000 } },
      { rngSeed: -1 },
      { rngSeed: 4294967296 },
      { rngSeed: 0.5 },
      {
        units: [
          {
            ...battle.units[0]!,
            equipment: { weapon: "knife", armor: null, hidden: true },
          },
        ],
      },
      { units: [{ ...battle.units[0]!, equipment: { weapon: "knife" } }] },
    ])
      expect(
        savedBattleSchema.safeParse({ ...battle, ...fields }).success,
      ).toBe(false);
  });

  it("preserves equip, train and teleport commands and rejects malformed variants", () => {
    const base = { commandId: "prepare-1", expectedRevision: 0, unitId: "A3" };
    const commands = [
      { ...base, type: "equip", slot: "weapon", itemId: "orb" },
      { ...base, type: "equip", slot: "weapon", itemId: null },
      { ...base, type: "train", spellIds: ["heal-1", "teleport"] },
      {
        ...base,
        type: "act",
        path: [],
        action: {
          type: "cast",
          spellId: "teleport",
          target: { x: 0, y: 0 },
          destination: { x: 3, y: 5 },
        },
      },
    ];
    for (const command of commands)
      expect(savedCommandSchema.parse(command)).toEqual(command);
    for (const command of [
      { ...commands[0], slot: "ring" },
      { ...commands[0], itemId: "" },
      { ...commands[0], quantity: 2 },
      { ...commands[2], spellIds: ["heal-1", "heal-1"] },
      {
        ...commands[3],
        action: {
          type: "cast",
          spellId: "teleport",
          target: { x: 0, y: 0 },
          destination: { x: 64, y: 0 },
        },
      },
    ])
      expect(savedCommandSchema.safeParse(command).success).toBe(false);
  });
});
