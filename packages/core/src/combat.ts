import type { BattleState, Content, Unit } from "./types";
import { distance, terrainAt } from "./movement";

export function commandBonus(state: BattleState, unit: Unit) {
  const leader = state.units.find(
    (u) =>
      u.id === unit.commanderId &&
      u.side === unit.side &&
      u.kind === "commander" &&
      u.hp > 0,
  );
  if (
    unit.kind !== "mercenary" ||
    !leader?.command ||
    distance(leader.pos, unit.pos) > leader.command.radius
  )
    return { at: 0, df: 0, active: false };
  return { at: leader.command.at, df: leader.command.df, active: true };
}
export const inAttackRange = (unit: Unit, target: Unit) =>
  unit.kind !== "escort" &&
  distance(unit.pos, target.pos) >= unit.range[0] &&
  distance(unit.pos, target.pos) <= unit.range[1];

export function damage(
  content: Content,
  state: BattleState,
  attacker: Unit,
  defender: Unit,
) {
  const ac = commandBonus(state, attacker);
  const dc = commandBonus(state, defender);
  const atTerrain = terrainAt(content, attacker.pos);
  const dfTerrain = terrainAt(content, defender.pos);
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
