import { describe, expect, it } from "vitest";
import {
  contentSchema,
  savedBattleSchema,
  savedCommandSchema,
  unitProgressionSchema,
  type Content,
} from "@orden/schema";
import { content } from "./index";
import { createBattle } from "../../core/src/types";

function invalid(mutate: (data: Content) => void) {
  const data = structuredClone(content);
  mutate(data);
  expect(contentSchema.safeParse(data).success).toBe(false);
}
describe("S06/S07 operation and mastery data", () => {
  it("supplies seven priced mercenary templates and the original nine legal hiring slots within budget", () => {
    expect(
      content.mercenaryTemplates.map((entry) => [entry.id, entry.cost]),
    ).toEqual([
      ["infantry", 100],
      ["pike", 110],
      ["cavalry", 160],
      ["archer", 130],
      ["flier", 220],
      ["sailor", 140],
      ["cleric", 150],
    ]);
    expect(content.scenario.preparation!.slots).toHaveLength(9);
    expect(
      content.scenario.preparation!.slots.map((entry) => entry.unitId),
    ).toEqual(["A11", "A12", "A13", "A21", "A22", "A23", "A31", "A32", "A33"]);
    expect(
      content.classes.every((entry) => entry.hireTemplateIds!.length > 0),
    ).toBe(true);
  });
  it("validates prices, total baseline affordability, slot ownership and all referenced inventory", () => {
    invalid((data) => {
      data.scenario.preparation!.operationBudget = 1019;
    });
    invalid((data) => {
      data.scenario.preparation!.slots[0]!.commanderId = "E1";
    });
    invalid((data) => {
      data.scenario.preparation!.slots[0]!.templateId = "archer";
    });
    invalid((data) => {
      data.scenario.preparation!.slots.pop();
    });
    invalid((data) => {
      data.scenario.preparation!.slots.push(
        data.scenario.preparation!.slots[0]!,
      );
    });
    invalid((data) => {
      data.scenario.preparation!.shop[0]!.sellPrice = 51;
    });
    invalid((data) => {
      data.scenario.preparation!.shop[0]!.buyPrice = 0;
    });
    invalid((data) => {
      data.scenario.preparation!.shop[0]!.itemId = "missing";
    });
    invalid((data) => {
      data.scenario.preparation!.rewards.items.missing = 1;
    });
    invalid((data) => {
      data.scenario.preparation!.inventory.missing = 1;
    });
    invalid((data) => {
      data.classes[0]!.hireTemplateIds!.push("missing");
    });
    invalid((data) => {
      data.mercenaryTemplates[0]!.stats.maxMp = 1;
    });
  });
  it("has six source-class masteries and rejects duplicate sources, unknown unlocks and uneared equipment", () => {
    expect(content.masteries).toHaveLength(6);
    expect(
      new Set(content.masteries!.map((entry) => entry.sourceClassId)).size,
    ).toBe(6);
    expect(
      content.terrains.find((entry) => entry.id === "plain")!.masteryTags,
    ).toEqual(["charge"]);
    expect(
      content.terrains.find((entry) => entry.id === "road")!.masteryTags,
    ).toEqual(["charge"]);
    expect(
      content.terrains.find((entry) => entry.id === "forest")!.masteryTags,
    ).toEqual(["forest"]);
    invalid((data) => {
      data.masteries![0]!.sourceClassId = "missing";
    });
    invalid((data) => {
      data.masteries![0]!.sourceClassId = "frontline-captain";
    });
    invalid((data) => {
      data.masteries![1]!.sourceClassId = data.masteries![0]!.sourceClassId;
    });
    invalid((data) => {
      data.terrains[0]!.masteryTags = ["charge", "charge"];
    });
    invalid((data) => {
      data.scenario.units[0]!.progression!.unlockedMasteryIds = ["missing"];
    });
    invalid((data) => {
      data.scenario.units[0]!.progression!.unlockedMasteryIds = [
        "mage-mastery",
      ];
    });
    const progression = content.scenario.units[0]!.progression!;
    expect(
      unitProgressionSchema.safeParse({
        ...progression,
        equippedMasteryId: "lord-mastery",
      }).success,
    ).toBe(false);
    expect(
      unitProgressionSchema.safeParse({
        ...progression,
        unlockedMasteryIds: ["lord-mastery", "lord-mastery"],
      }).success,
    ).toBe(false);
  });
  it("strictly saves mode, operation checkpoint, masteries and every new command", () => {
    const state = createBattle(content, "operation");
    expect(savedBattleSchema.parse(state)).toEqual(state);
    const missing = structuredClone(state) as unknown as Record<
      string,
      unknown
    >;
    delete missing.operation;
    expect(savedBattleSchema.safeParse(missing).success).toBe(false);
    expect(
      savedBattleSchema.safeParse({ ...state, mode: "practice" }).success,
    ).toBe(false);
    expect(
      savedBattleSchema.safeParse({
        ...state,
        operation: { ...state.operation, equipmentFunds: -1 },
      }).success,
    ).toBe(false);
    expect(
      savedBattleSchema.safeParse({
        ...state,
        operation: { ...state.operation, unknown: true },
      }).success,
    ).toBe(false);
    for (const input of [
      { type: "hire", unitId: "A11", templateId: "pike" },
      { type: "buy", itemId: "knife", quantity: 1 },
      { type: "sell", itemId: "knife", quantity: 1 },
      { type: "mastery", unitId: "A1", masteryId: null },
      { type: "startBattle" },
    ]) {
      const cmd = { ...input, commandId: "prepare", expectedRevision: 0 };
      expect(savedCommandSchema.parse(cmd)).toEqual(cmd);
      expect(
        savedCommandSchema.safeParse({ ...cmd, extra: true }).success,
      ).toBe(false);
    }
  });
});
