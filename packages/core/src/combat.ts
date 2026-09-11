import type { BattleState, Content, Unit } from "./types";
import { distance, terrainAt } from "./movement";
import { effectiveUnit } from "./effective";
import { hasStatus } from "./statuses";

export function commandBonus(
  state: BattleState,
  unit: Unit,
  content?: Content,
) {
  const baseLeader = state.units.find(
    (u) =>
      u.id === unit.commanderId &&
      u.side === unit.side &&
      u.kind === "commander" &&
      u.hp > 0,
  );
  const leader =
    baseLeader && content
      ? effectiveUnit(content, state, baseLeader)
      : baseLeader;
  if (
    unit.kind !== "mercenary" ||
    !leader?.command ||
    distance(leader.pos, unit.pos) > leader.command.radius
  )
    return { at: 0, df: 0, active: false };
  return { at: leader.command.at, df: leader.command.df, active: true };
}
export function inAttackRange(
  unit: Unit,
  target: Unit,
  content?: Content,
  state?: BattleState,
) {
  const source = content && state ? effectiveUnit(content, state, unit) : unit;
  return (
    source.kind !== "escort" &&
    distance(source.pos, target.pos) >= source.range[0] &&
    distance(source.pos, target.pos) <= source.range[1]
  );
}

/** Counter eligibility is shared by the reducer and physical-combat presentation. */
export function canCounter(
  content: Content,
  state: BattleState,
  defender: Unit,
  attacker: Unit,
): boolean {
  return (
    defender.hp > 0 &&
    !hasStatus(state, defender, "sleep") &&
    inAttackRange(defender, attacker, content, state)
  );
}

export function damage(
  content: Content,
  state: BattleState,
  attacker: Unit,
  defender: Unit,
) {
  attacker = effectiveUnit(content, state, attacker);
  defender = effectiveUnit(content, state, defender);
  const ac = commandBonus(state, attacker, content);
  const dc = commandBonus(state, defender, content);
  const atTerrain = terrainAt(content, attacker.pos, state);
  const dfTerrain = terrainAt(content, defender.pos, state);
  const waterAtk = attacker.unitType === "sailor" && atTerrain?.water ? 2 : 0;
  const waterDef = defender.unitType === "sailor" && dfTerrain?.water ? 2 : 0;
  const a = Math.max(0, attacker.stats.at + ac.at + waterAtk);
  const d = Math.max(
    0,
    defender.stats.df +
      dc.df +
      waterDef +
      (defender.moveType === "flying" ? 0 : (dfTerrain?.defense ?? 0)),
  );
  const affinity =
    content.affinities.find(
      (c) => c.from === attacker.unitType && c.to === defender.unitType,
    )?.percent ?? 100;
  // Fixed denominator: (A*C/100 - D) * (10+HP)/20. Round only once.
  return Math.min(
    10,
    Math.floor(
      (Math.max(0, a * affinity - d * 100) * (10 + attacker.hp) + 1000) / 2000,
    ),
  );
}
