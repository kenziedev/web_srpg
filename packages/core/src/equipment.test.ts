import { describe, expect, it } from "vitest";
import type { StatusEffect } from "@orden/schema";
import { content } from "../../content/src/index";
import { apply, evaluate } from "./commands";
import { createBattle, type BattleState, type EquipCommand } from "./types";
import { canPrepare, equipmentOptions, evaluateEquip } from "./equipment";
import { effectiveUnit, equipmentSpellIds, spellRangeBonus } from "./effective";
import { commandBonus, damage, inAttackRange } from "./combat";
import { knownSpells, spellTargetTiles } from "./spells";
import { reachable } from "./movement";

function equip(
  state: BattleState,
  itemId: string | null,
  unitId = "A1",
  slot: EquipCommand["slot"] = "weapon",
): EquipCommand {
  return {
    type: "equip",
    commandId: `equip-${state.revision}`,
    expectedRevision: state.revision,
    unitId,
    slot,
    itemId,
  };
}
function change(
  state: BattleState,
  itemId: string | null,
  unitId = "A1",
  slot: EquipCommand["slot"] = "weapon",
): BattleState {
  const result = apply(content, state, equip(state, itemId, unitId, slot));
  if (!result.ok) throw new Error(result.error);
  return result.nextState;
}
function status(
  unitId: string,
  kind: StatusEffect["status"],
  power: number,
): StatusEffect {
  return {
    unitId,
    status: kind,
    power,
    sourceId: "A3",
    expiresRound: 2,
    expiresSide: "player",
  };
}

describe("S03 equipment ownership and preparation", () => {
  it("registers 34 functioning PC items, with 33 equipment and a class-reset consumable", () => {
    expect(content.items).toHaveLength(34);
    expect(
      content.items
        .filter((item) => item.unavailableReason)
        .map((item) => item.id)
        .sort(),
    ).toEqual([]);
    expect(content.items.filter((item) => !item.useEffect)).toHaveLength(33);
    expect(
      content.items.filter((item) => item.useEffect).map((item) => item.id),
    ).toEqual(["runestone"]);
    for (const item of content.items.filter((item) => !item.useEffect)) {
      expect(
        Object.keys(item.modifiers).length + item.grantedSpellIds.length,
      ).toBeGreaterThan(0);
      expect(content.scenario.inventory?.[item.id]).toBe(1);
    }
  });
  it("equipping is atomic, preserves base stats and action rights, and replays with ordinary commands", () => {
    const initial = createBattle(content);
    const before = structuredClone(initial);
    const command = equip(initial, "great-sword");
    const preview = evaluate(content, initial, command);
    expect(apply(content, initial, command)).toEqual(preview);
    expect(initial).toEqual(before);
    if (!preview.ok) throw new Error(preview.error);
    const next = preview.nextState;
    expect(next.units.find((unit) => unit.id === "A1")?.stats).toEqual(
      initial.units.find((unit) => unit.id === "A1")?.stats,
    );
    expect(next.units.every((unit) => !unit.acted)).toBe(true);
    expect(next.inventory).toEqual(initial.inventory);
    expect(next.commands).toEqual([command]);
    expect(next.revision).toBe(1);
    expect(preview.events).toContainEqual({
      type: "equipmentChanged",
      unitId: "A1",
      slot: "weapon",
      itemId: "great-sword",
    });
    expect(apply(content, createBattle(content), command)).toEqual(preview);
    expect(apply(content, next, command).ok).toBe(false);
  });
  it("one owned copy cannot be worn twice and becomes available immediately after removal", () => {
    let state = change(createBattle(content), "great-sword");
    const before = structuredClone(state);
    expect(apply(content, state, equip(state, "great-sword", "A2")).ok).toBe(
      false,
    );
    expect(state).toEqual(before);
    state = change(state, null);
    state = change(state, "great-sword", "A2");
    expect(
      state.units.find((unit) => unit.id === "A2")?.equipment?.weapon,
    ).toBe("great-sword");
    expect(state.inventory["great-sword"]).toBe(1);
  });
  it("replacing a slot returns its old item without consuming either owned copy", () => {
    let state = change(createBattle(content), "knife");
    state = change(state, "great-sword");
    const unit = state.units.find((candidate) => candidate.id === "A2")!;
    expect(
      equipmentOptions(content, state, unit, "weapon").find(
        (option) => option.item.id === "knife",
      ),
    ).toMatchObject({ owned: 1, available: 1, reason: null });
    expect(
      equipmentOptions(content, state, unit, "weapon").find(
        (option) => option.item.id === "great-sword",
      ),
    ).toMatchObject({ owned: 1, available: 0 });
  });
  it.each([
    ["wrong slot", "small-shield", "A1", "weapon"],
    ["unknown item", "missing", "A1", "weapon"],
    ["mercenary", "knife", "A11", "weapon"],
    ["enemy", "knife", "E1", "weapon"],
    ["class restriction", "cross", "A1", "armor"],
    ["consumable cannot be worn", "runestone", "A1", "armor"],
    ["empty slot", null, "A1", "weapon"],
  ] as const)(
    "rejects %s without mutating inventory, MP, or log",
    (_label, itemId, unitId, slot) => {
      const state = createBattle(content);
      const before = structuredClone(state);
      expect(apply(content, state, equip(state, itemId, unitId, slot)).ok).toBe(
        false,
      );
      expect(state).toEqual(before);
    },
  );
  it("rejects unowned stock and allows a second legitimately owned copy", () => {
    const state = createBattle(content);
    state.inventory.knife = 0;
    expect(evaluateEquip(content, state, equip(state, "knife")).ok).toBe(false);
    state.inventory.knife = 2;
    const next = change(change(state, "knife"), "knife", "A2");
    expect(
      next.units.filter((unit) => unit.equipment?.weapon === "knife"),
    ).toHaveLength(2);
  });
  it("preparation remains open through equipment but closes after any tactical action or phase", () => {
    const initial = change(createBattle(content), "knife");
    expect(canPrepare(initial)).toBe(true);
    const wait = apply(content, initial, {
      type: "act",
      commandId: "begin",
      expectedRevision: initial.revision,
      unitId: "A1",
      path: [],
      action: { type: "wait" },
    });
    if (!wait.ok) throw new Error(wait.error);
    expect(canPrepare(wait.nextState)).toBe(false);
    expect(
      apply(content, wait.nextState, equip(wait.nextState, "great-sword", "A2"))
        .ok,
    ).toBe(false);
    const ended = apply(content, initial, {
      type: "endPhase",
      commandId: "phase",
      expectedRevision: initial.revision,
      side: "player",
    });
    expect(ended.ok && canPrepare(ended.nextState)).toBe(false);
  });
  it("orb changes MP capacity proportionally and repeated swaps never refill depleted MP", () => {
    let state = createBattle(content);
    const base = state.units.find((unit) => unit.id === "A3")!;
    expect(base.mp).toBe(9);
    state = change(state, "orb", "A3");
    let mage = state.units.find((unit) => unit.id === "A3")!;
    expect(mage.mp).toBe(18);
    expect(mage.stats.maxMp).toBe(9);
    expect(effectiveUnit(content, state, mage).stats.maxMp).toBe(18);
    mage.mp = 9;
    state = change(state, null, "A3");
    expect(state.units.find((unit) => unit.id === "A3")!.mp).toBe(4);
    state = change(state, "orb", "A3");
    mage = state.units.find((unit) => unit.id === "A3")!;
    expect(mage.mp).toBe(8);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe("S03 equipment effective rules", () => {
  it("physical bonuses affect real predicted damage without permanently raising base stats", () => {
    const initial = createBattle(content);
    const actor = initial.units.find((unit) => unit.id === "A1")!;
    const enemy = initial.units.find((unit) => unit.id === "E1")!;
    actor.pos = { x: 2, y: 10 };
    enemy.pos = { x: 3, y: 10 };
    const baseDamage = damage(content, initial, actor, enemy);
    const state = change(initial, "great-sword");
    const equipped = state.units.find((unit) => unit.id === actor.id)!;
    expect(effectiveUnit(content, state, equipped).stats.at).toBe(
      actor.stats.at + 4,
    );
    expect(
      damage(
        content,
        state,
        equipped,
        state.units.find((unit) => unit.id === enemy.id)!,
      ),
    ).toBeGreaterThan(baseDamage);
  });
  it("bow range replaces the existing attack range and its movement penalty changes reachable tiles", () => {
    const initial = createBattle(content);
    const state = change(initial, "arbalest", "A3");
    const mage = state.units.find((unit) => unit.id === "A3")!;
    const view = effectiveUnit(content, state, mage);
    expect(view.range).toEqual([1, 6]);
    expect(view.stats.move).toBe(Math.max(1, mage.stats.move - 3));
    const farTarget = {
      ...mage,
      id: "target",
      pos: { x: mage.pos.x + 6, y: mage.pos.y },
    };
    expect(inAttackRange(view, farTarget)).toBe(true);
    expect(
      reachable(content, state, mage).every(
        (tile) => tile.cost <= view.stats.move,
      ),
    ).toBe(true);
    expect(
      reachable(
        content,
        initial,
        initial.units.find((unit) => unit.id === "A3")!,
      ).length,
    ).toBeGreaterThan(reachable(content, state, mage).length);
  });
  it("squad boots benefit the holder and only their living same-side followers, even outside command range", () => {
    const state = change(createBattle(content), "speed-boots", "A1", "armor");
    const leader = state.units.find((unit) => unit.id === "A1")!;
    const follower = state.units.find(
      (unit) => unit.commanderId === leader.id,
    )!;
    follower.pos = { x: 18, y: 14 };
    expect(effectiveUnit(content, state, leader).stats.move).toBe(
      leader.stats.move + 2,
    );
    expect(effectiveUnit(content, state, follower).stats.move).toBe(
      follower.stats.move + 2,
    );
    const other = state.units.find((unit) => unit.id === "A2")!;
    expect(effectiveUnit(content, state, other).stats.move).toBe(
      other.stats.move,
    );
    leader.side = "enemy";
    expect(effectiveUnit(content, state, follower).stats.move).toBe(
      follower.stats.move,
    );
  });
  it("crown adds command stats under the radius cap and does not add personal AT", () => {
    const state = change(createBattle(content), "crown", "A1", "armor");
    const leader = state.units.find((unit) => unit.id === "A1")!;
    const view = effectiveUnit(content, state, leader);
    expect(view.command).toEqual({
      radius: 4,
      at: leader.command!.at + 3,
      df: leader.command!.df + 2,
    });
    expect(view.stats.at).toBe(leader.stats.at);
    const follower = state.units.find(
      (unit) => unit.commanderId === leader.id,
    )!;
    follower.pos = { x: leader.pos.x + 4, y: leader.pos.y };
    expect(commandBonus(state, follower, content)).toEqual({
      at: view.command!.at,
      df: view.command!.df,
      active: true,
    });
    follower.pos.x += 1;
    expect(commandBonus(state, follower, content).active).toBe(false);
  });
  it("amulet uses the documented project MDF conversion and applies squad resistance", () => {
    const state = change(createBattle(content), "amulet", "A1", "armor");
    const leader = state.units.find((unit) => unit.id === "A1")!;
    const follower = state.units.find(
      (unit) => unit.commanderId === leader.id,
    )!;
    expect(effectiveUnit(content, state, leader).stats.res).toBe(
      leader.stats.res + 1,
    );
    expect(effectiveUnit(content, state, follower).stats.res).toBe(
      follower.stats.res + 1,
    );
  });
  it("spell equipment extends target range and grants only the worn item's summon", () => {
    let state = change(createBattle(content), "wand", "A3");
    let mage = state.units.find((unit) => unit.id === "A3")!;
    expect(spellRangeBonus(content, mage)).toBe(2);
    const arrow = content.spells.find((spell) => spell.id === "magic-arrow")!;
    const targets = spellTargetTiles(content, mage, arrow, { x: 8, y: 8 });
    expect(targets).toContainEqual({ x: 15, y: 8 });
    expect(targets).not.toContainEqual({ x: 16, y: 8 });
    state = change(state, "iron-dumbbell", "A3");
    mage = state.units.find((unit) => unit.id === "A3")!;
    const granted = equipmentSpellIds(content, mage);
    expect(granted).toEqual(
      content.items.find((item) => item.id === "iron-dumbbell")!
        .grantedSpellIds,
    );
    expect(granted).toHaveLength(1);
    expect(knownSpells(content, mage).map((spell) => spell.id)).toContain(
      granted[0],
    );
    state = change(state, null, "A3");
    expect(
      equipmentSpellIds(
        content,
        state.units.find((unit) => unit.id === "A3")!,
      ),
    ).toEqual([]);
  });
  it("buffs and gear compose once, and zone/sleep override the effective radius/movement", () => {
    const state = change(createBattle(content), "crown", "A1", "armor");
    const leader = state.units.find((unit) => unit.id === "A1")!;
    const follower = state.units.find(
      (unit) => unit.commanderId === leader.id,
    )!;
    state.statuses.push(
      status(leader.id, "attack", 3),
      status(leader.id, "attack", 5),
      status(follower.id, "attack", 5),
    );
    const view = effectiveUnit(content, state, leader);
    expect(view.stats.at).toBe(leader.stats.at + 5);
    expect(view.command!.at).toBe(leader.command!.at + 3 + 5);
    expect(effectiveUnit(content, state, follower).stats.at).toBe(
      follower.stats.at,
    );
    state.statuses.push(
      status(leader.id, "zone", 0),
      status(leader.id, "sleep", 0),
    );
    expect(effectiveUnit(content, state, leader)).toMatchObject({
      command: { radius: 0 },
      stats: { move: 0 },
    });
  });
  it("negative modifiers and decline cannot produce negative combat stats", () => {
    const state = createBattle(content);
    const mage = state.units.find((unit) => unit.id === "A3")!;
    mage.stats.at = 1;
    mage.stats.df = 0;
    mage.stats.res = 1;
    mage.equipment = { weapon: "devil-axe", armor: null };
    state.statuses.push(status(mage.id, "decline", 3));
    expect(effectiveUnit(content, state, mage).stats).toMatchObject({
      at: 9,
      df: 0,
      res: 0,
    });
  });
});
