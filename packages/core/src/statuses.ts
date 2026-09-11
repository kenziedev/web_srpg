import type { BattleEvent, BattleState, Content, Unit } from "./types";
import type { StatusEffect } from "@orden/schema";

export function hasStatus(
  state: BattleState,
  unit: Unit,
  status: StatusEffect["status"],
) {
  return state.statuses.some(
    (effect) => effect.unitId === unit.id && effect.status === status,
  );
}

/** Stable per-target roll: previewing never advances a generator or changes state. */
export function statusRoll(
  state: BattleState,
  source: Unit,
  target: Unit,
  spellId: string,
) {
  const input = `${state.rngSeed}|${state.revision}|${source.id}|${target.id}|${spellId}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 100;
}

/** Expire before recovery/action reset; changing sides never changes the stored deadline. */
export function expireStatuses(state: BattleState, events: BattleEvent[]) {
  const expired = state.statuses.filter(
    (effect) =>
      effect.expiresSide === state.activeSide &&
      effect.expiresRound <= state.round,
  );
  state.statuses = state.statuses.filter((effect) => !expired.includes(effect));
  for (const effect of expired) {
    const unit = state.units.find(
      (candidate) => candidate.id === effect.unitId,
    );
    if (!unit) continue;
    if (effect.status === "charm" && effect.originalSide) {
      unit.side = effect.originalSide;
      // Temporary allied buffs do not survive the return to the original side.
      state.statuses = state.statuses.filter(
        (entry) =>
          entry.unitId !== unit.id ||
          !["attack", "protection", "resist", "quick"].includes(entry.status),
      );
    }
    events.push({
      type: "statusExpired",
      unitId: unit.id,
      status: effect.status,
    });
  }
  state.statuses = state.statuses.filter((effect) =>
    state.units.some((unit) => unit.id === effect.unitId),
  );
}

/** Remove dead leaders, their troops and recursively owned summons in one stable pass. */
export function removeDefeated(state: BattleState, events: BattleEvent[]) {
  const removed = new Set(
    state.units.filter((unit) => unit.hp <= 0).map((unit) => unit.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of state.units) {
      if (
        !removed.has(unit.id) &&
        ((unit.commanderId && removed.has(unit.commanderId)) ||
          (unit.summon && removed.has(unit.summon.ownerId)))
      ) {
        removed.add(unit.id);
        changed = true;
      }
    }
  }
  state.units = state.units.filter((unit) => {
    if (!removed.has(unit.id)) return true;
    events.push({
      type: "removed",
      unitId: unit.id,
      reason: unit.hp <= 0 ? "defeated" : "retreated",
    });
    return false;
  });
  state.statuses = state.statuses.filter(
    (effect) => !removed.has(effect.unitId),
  );
}

export function statusChance(content: Content, source: Unit, target: Unit) {
  // Project rule: PC sources establish resistance dependence, not an exact formula.
  void content;
  return Math.max(
    10,
    Math.min(95, 90 + source.stats.mag * 3 - target.stats.res * 7),
  );
}
