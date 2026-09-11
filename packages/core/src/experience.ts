import type {
  BattleEvent,
  BattleState,
  Command,
  Content,
  ExperienceContribution,
  StatGains,
  Unit,
} from "./types";
import { allied } from "./movement";

const emptyContribution = (): ExperienceContribution => ({
  damage: 0,
  kills: 0,
  retreats: 0,
  healing: 0,
  clear: 0,
});

/** Keep fallen commanders without changing their original allegiance or growth. */
export function syncRoster(before: BattleState, nextState: BattleState) {
  if (nextState.progression.settlement) return;
  nextState.progression.roster = nextState.progression.roster.map((record) => {
    const current = nextState.units.find((unit) => unit.id === record.id);
    const previous = before.units.find((unit) => unit.id === record.id);
    const snapshot = current ?? previous ?? record;
    return { ...structuredClone(snapshot), side: "player" };
  });
}

function originalUnit(content: Content, unitId: string): Unit | undefined {
  return [
    ...content.scenario.units,
    ...content.scenario.reinforcement.units,
  ].find((unit) => unit.id === unitId);
}

/** The command owner is stable even when a temporary charm changes a unit's side. */
export function experienceOwner(
  content: Content,
  state: BattleState,
  source: Unit,
): Unit | null {
  const visited = new Set<string>();
  let unit: Unit | undefined = source;
  while (unit && !visited.has(unit.id)) {
    visited.add(unit.id);
    if (unit.side === "enemy") return null;
    const ownerId: string | null = unit.summon?.ownerId ?? unit.commanderId;
    if (ownerId) {
      unit = state.units.find((candidate) => candidate.id === ownerId);
      continue;
    }
    const original = originalUnit(content, unit.id);
    return unit.kind === "commander" && original?.side === "player"
      ? unit
      : null;
  }
  return null;
}

function originalSide(
  content: Content,
  state: BattleState,
  source: Unit,
): Unit["side"] | null {
  const visited = new Set<string>();
  let unit: Unit | undefined = source;
  while (unit && !visited.has(unit.id)) {
    visited.add(unit.id);
    if (!unit.summon) return originalUnit(content, unit.id)?.side ?? null;
    const ownerId: string = unit.summon.ownerId;
    unit = state.units.find((candidate) => candidate.id === ownerId);
  }
  return null;
}

function multiplier(content: Content, owner: Unit): number {
  return Math.max(
    1,
    ...Object.values(owner.equipment ?? {}).map(
      (id) =>
        content.items.find((item) => item.id === id)?.modifiers.expMultiplier ??
        1,
    ),
  );
}

/** Actual committed events are the sole source of contribution; previews never pay EXP. */
export function recordContribution(
  content: Content,
  before: BattleState,
  nextState: BattleState,
  command: Command,
  events: BattleEvent[],
) {
  if (command.type !== "act" || nextState.progression.settlement) return;
  const actor = before.units.find((unit) => unit.id === command.unitId);
  if (!actor) return;
  const ledger = nextState.progression;
  const credit = (
    owner: Unit,
    category: keyof ExperienceContribution,
    amount: number,
  ) => {
    const record = (ledger.contributions[owner.id] ??= emptyContribution());
    record[category] += amount * multiplier(content, owner);
  };
  const targetEligible = (target: Unit) =>
    !target.summon && originalSide(content, before, target) === "enemy";
  const causedDamage = new Set<string>();
  for (const event of events) {
    if (event.type === "damaged" && event.amount > 0) {
      const target = before.units.find((unit) => unit.id === event.unitId);
      // A physical exchange has two causes, while all spell impacts share the caster.
      const counterSourceId =
        command.action.type === "attack" ? command.action.targetId : null;
      const damageSource =
        counterSourceId && event.unitId === actor.id
          ? before.units.find((unit) => unit.id === counterSourceId)
          : command.action.type === "attack" ||
              command.action.type === "cast" ||
              command.action.type === "heal"
            ? actor
            : null;
      const owner = damageSource
        ? experienceOwner(content, before, damageSource)
        : null;
      if (!target || !targetEligible(target)) continue;
      if (!owner || !damageSource || allied(damageSource.side, target.side)) {
        delete ledger.lastDamageOwner[target.id];
        continue;
      }
      ledger.lastDamageOwner[target.id] = owner.id;
      causedDamage.add(target.id);
      const previous = ledger.damageAwarded[target.id] ?? 0;
      const amount = Math.min(20 - previous, event.amount * 2);
      ledger.damageAwarded[target.id] = previous + amount;
      credit(owner, "damage", amount);
    } else if (
      event.type === "healed" &&
      event.amount > 0 &&
      (command.action.type === "cast" || command.action.type === "heal")
    ) {
      const target = before.units.find((unit) => unit.id === event.unitId);
      const owner = experienceOwner(content, before, actor);
      const side = target ? originalSide(content, before, target) : null;
      if (
        !target ||
        !owner ||
        !allied(actor.side, target.side) ||
        (side !== "player" && side !== "npc")
      )
        continue;
      const previous = ledger.healingAwarded[owner.id] ?? 0;
      const amount = Math.min(30 - previous, event.amount * 2);
      ledger.healingAwarded[owner.id] = previous + amount;
      credit(owner, "healing", amount);
    }
  }
  const removed = new Map(
    events
      .filter((event) => event.type === "removed")
      .map((event) => [event.unitId, event]),
  );
  for (const [unitId, event] of removed) {
    const target = before.units.find((unit) => unit.id === unitId);
    if (!target || !targetEligible(target) || ledger.defeated.includes(unitId))
      continue;
    ledger.defeated.push(unitId);
    let defeatedId = unitId;
    if (event.reason === "retreated") {
      // Only living mercenaries retreating because of a killed leader receive 5.
      if (
        target.kind !== "mercenary" ||
        !target.commanderId ||
        removed.get(target.commanderId)?.reason !== "defeated"
      )
        continue;
      defeatedId = target.commanderId;
    }
    if (!causedDamage.has(defeatedId)) continue;
    const ownerId = ledger.lastDamageOwner[defeatedId];
    const owner = before.units.find((unit) => unit.id === ownerId);
    if (!owner || !experienceOwner(content, before, owner)) continue;
    if (event.reason === "retreated") credit(owner, "retreats", 5);
    else if (target.kind === "commander") credit(owner, "kills", 60);
    else if (target.kind === "mercenary") credit(owner, "kills", 20);
  }
}

/** Fixed growth is applied to a persistent copy, never the active battle's units. */
export function gainExperience(
  content: Content,
  source: Unit,
  amount: number,
): { unit: Unit; learnedSpellIds: string[]; statGains: StatGains } {
  const unit = structuredClone(source);
  const learnedSpellIds: string[] = [];
  const statGains: StatGains = {};
  const progression = unit.progression;
  if (!progression || !Number.isSafeInteger(amount) || amount < 0)
    return { unit, learnedSpellIds, statGains };
  progression.totalExp += amount;
  let available = progression.exp + amount;
  const growth = content.growthProfiles.find(
    (profile) => profile.id === progression.growthId,
  );
  const classDefinition = content.classes.find(
    (definition) => definition.id === progression.classId,
  );
  while (progression.level < 10 && available >= 100) {
    available -= 100;
    progression.level += 1;
    const gains = growth?.levels.find(
      (entry) => entry.level === progression.level,
    )?.gains;
    for (const [name, value] of Object.entries(gains ?? {}) as [
      keyof StatGains,
      number,
    ][]) {
      unit.stats[name] += value;
      statGains[name] = (statGains[name] ?? 0) + value;
    }
    for (const entry of classDefinition?.learns ?? []) {
      if (entry.level !== progression.level) continue;
      for (const spellId of entry.spellIds) {
        if (progression.learnedSpellIds.includes(spellId)) continue;
        progression.learnedSpellIds.push(spellId);
        learnedSpellIds.push(spellId);
        if (!unit.spellIds.includes(spellId)) unit.spellIds.push(spellId);
      }
    }
  }
  progression.exp = Math.min(progression.level === 10 ? 100 : 99, available);
  return { unit, learnedSpellIds, statGains };
}

/** Invoked exactly once when scenario resolution records an outcome. */
export function settleExperience(
  content: Content,
  state: BattleState,
  events: BattleEvent[],
) {
  if (!state.outcome || state.progression.settlement) return;
  syncRoster(state, state);
  const ledger = state.progression;
  const duplicate = ledger.rewardedScenarioIds.includes(content.scenario.id);
  const rewarded = state.outcome.status === "victory" && !duplicate;
  const entries = ledger.roster.map((record) => {
    const earned = rewarded
      ? {
          ...(ledger.contributions[record.id] ?? emptyContribution()),
          clear: 180,
        }
      : emptyContribution();
    const awardedExp = Object.values(earned).reduce(
      (sum, value) => sum + value,
      0,
    );
    const previousLevel = record.progression?.level ?? 1;
    const previousExp = record.progression?.exp ?? 0;
    const gained = gainExperience(content, record, awardedExp);
    const level = gained.unit.progression?.level ?? previousLevel;
    const exp = gained.unit.progression?.exp ?? previousExp;
    if (rewarded) {
      ledger.contributions[record.id] = earned;
      events.push({
        type: "experienceGained",
        unitId: record.id,
        amount: awardedExp,
      });
      if (level > previousLevel)
        events.push({
          type: "levelUp",
          unitId: record.id,
          from: previousLevel,
          to: level,
        });
      for (const spellId of gained.learnedSpellIds)
        events.push({ type: "spellLearned", unitId: record.id, spellId });
    }
    ledger.roster[ledger.roster.findIndex((unit) => unit.id === record.id)] =
      gained.unit;
    return {
      unitId: record.id,
      earned,
      awardedExp,
      previousLevel,
      level,
      previousExp,
      exp,
      learnedSpellIds: gained.learnedSpellIds,
      statGains: gained.statGains,
    };
  });
  if (rewarded) ledger.rewardedScenarioIds.push(content.scenario.id);
  else ledger.contributions = {};
  ledger.settlement = {
    scenarioId: content.scenario.id,
    outcome: state.outcome.status,
    duplicate,
    entries,
  };
}
