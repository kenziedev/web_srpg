import type { BattleEvent, BattleState, Unit } from "./types";
import type { SpellPreview } from "./spells";
import { key } from "./movement";

/** Called only with a successful preview against this reducer-owned state. */
export function executeSpell(
  state: BattleState,
  actor: Unit,
  preview: Extract<SpellPreview, { ok: true }>,
  events: BattleEvent[],
) {
  const effect = preview.spell.effect;
  actor.mp -= preview.spell.mpCost;
  for (const affected of preview.targets) {
    const target = state.units.find((unit) => unit.id === affected.unitId)!;
    if (effect.type === "heal") {
      target.hp += affected.amount;
      events.push({
        type: "healed",
        unitId: target.id,
        amount: affected.amount,
      });
    } else if (effect.type === "damage" || effect.type === "slay-undead") {
      target.hp -= affected.amount;
      events.push({
        type: "damaged",
        unitId: target.id,
        amount: affected.amount,
      });
    } else if (effect.type === "status") {
      const status = effect.status!;
      events.push({
        type: "statusApplied",
        unitId: target.id,
        status,
        power: effect.power,
        success: affected.success ?? true,
        chance: affected.chance ?? 100,
      });
      if (!affected.success) continue;
      // Attack/protection modify command bonuses; followers must not receive it twice.
      if (
        (status === "attack" || status === "protection") &&
        target.kind === "mercenary" &&
        state.units.some(
          (leader) =>
            leader.id === target.commanderId &&
            leader.kind === "commander" &&
            leader.side === target.side &&
            leader.hp > 0,
        )
      )
        continue;
      const existing = state.statuses.find(
        (entry) => entry.unitId === target.id && entry.status === status,
      );
      const originalSide = existing?.originalSide ?? target.side;
      state.statuses = state.statuses.filter((entry) => entry !== existing);
      state.statuses.push({
        unitId: target.id,
        sourceId: actor.id,
        status,
        power: Math.max(existing?.power ?? 0, effect.power),
        expiresRound: state.round + (effect.duration ?? 1),
        expiresSide: actor.side,
        ...(status === "charm" ? { originalSide } : {}),
      });
      if (status === "charm") {
        target.side = actor.side === "enemy" ? "enemy" : "npc";
        target.acted = true;
      }
    } else if (effect.type === "again") {
      target.acted = false;
      target.refreshedRound = state.round;
      events.push({ type: "refreshed", unitId: target.id });
    }
  }
  for (const placement of preview.placements ?? []) {
    const target = state.units.find((unit) => unit.id === placement.unitId)!;
    const from = { ...target.pos };
    target.pos = { ...placement.pos };
    events.push({
      type: "teleported",
      unitId: target.id,
      from,
      to: { ...target.pos },
    });
  }
  if (preview.summon) {
    const removed = new Set(
      state.units
        .filter((unit) => unit.summon?.ownerId === actor.id)
        .map((unit) => unit.id),
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const unit of state.units)
        if (
          unit.summon &&
          removed.has(unit.summon.ownerId) &&
          !removed.has(unit.id)
        ) {
          removed.add(unit.id);
          changed = true;
        }
    }
    state.units = state.units.filter((unit) => {
      if (!removed.has(unit.id)) return true;
      events.push({ type: "removed", unitId: unit.id, reason: "retreated" });
      return false;
    });
    state.statuses = state.statuses.filter(
      (entry) => !removed.has(entry.unitId),
    );
    state.units.push(structuredClone(preview.summon));
    events.push({
      type: "summoned",
      unitId: preview.summon.id,
      ownerId: actor.id,
      templateId: preview.summon.summon!.templateId,
    });
  }
  for (const tile of preview.terrainChanges ?? []) {
    state.terrainChanges[key(tile.pos)] = tile.terrainId;
    events.push({
      type: "terrainChanged",
      pos: { ...tile.pos },
      terrainId: tile.terrainId,
    });
  }
}
