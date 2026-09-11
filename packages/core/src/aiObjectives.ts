import type { BattleState, Content, Position, Unit } from "./types";
import { distance, key, stepCost, terrainAt } from "./movement";

export interface EnemyIntent {
  commanderId: string;
  label: string;
  fromRound: number;
  target: Position;
  next: { fromRound: number; label: string; target: Position } | null;
}

/** Shared by the planner and UI; the timetable is content, not remembered AI state. */
export function enemyIntent(
  content: Content,
  state: BattleState,
  unit: Unit,
): EnemyIntent | null {
  if (unit.side !== "enemy" || state.outcome) return null;
  const commanderId = unit.kind === "commander" ? unit.id : unit.commanderId;
  if (
    !commanderId ||
    !state.units.some((u) => u.id === commanderId && u.hp > 0)
  )
    return null;
  const plan = content.scenario.enemyPlans?.find(
    (p) => p.commanderId === commanderId,
  );
  if (!plan) return null;
  const upcoming = plan.stages.findIndex((s) => s.fromRound > state.round);
  const index = (upcoming < 0 ? plan.stages.length : upcoming) - 1;
  const stage = plan.stages[index];
  if (!stage) return null;
  const next = plan.stages[index + 1];
  return {
    commanderId,
    label: stage.label,
    fromRound: stage.fromRound,
    target: { ...stage.target },
    next: next ? { ...next, target: { ...next.target } } : null,
  };
}

/**
 * Reverse Dijkstra over the finite map. Edges reuse core stepCost, including
 * terrain and hostile blockers. Each reversed edge pays the forward entry cost.
 * The timetable is a direction to approach, so an occupied target can be guarded
 * from adjacent passable tiles. Only reachable/evaluate can authorize this turn.
 */
export function objectiveCosts(
  content: Content,
  state: BattleState,
  unit: Unit,
  target: Position,
): Map<string, number> {
  const costs = new Map<string, number>();
  const frontier: { pos: Position; cost: number }[] = [];
  const candidates: Position[] = [];
  let closest = Infinity;
  for (let y = 0; y < content.scenario.height; y++) {
    for (let x = 0; x < content.scenario.width; x++) {
      const pos = { x, y };
      if (
        stepCost(content, state, unit, pos) === null ||
        terrainAt(content, pos, state)?.noLanding
      )
        continue;
      const gap = distance(pos, target);
      if (gap < closest) {
        closest = gap;
        candidates.length = 0;
      }
      if (gap === closest) candidates.push(pos);
    }
  }
  for (const pos of candidates) {
    costs.set(key(pos), 0);
    frontier.push({ pos, cost: 0 });
  }
  while (frontier.length) {
    frontier.sort(
      (a, b) => a.cost - b.cost || a.pos.y - b.pos.y || a.pos.x - b.pos.x,
    );
    const current = frontier.shift()!;
    if (costs.get(key(current.pos)) !== current.cost) continue;
    const entryCost = stepCost(content, state, unit, current.pos);
    if (entryCost === null) continue;
    const { x, y } = current.pos;
    for (const previous of [
      { x, y: y - 1 },
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y + 1 },
    ]) {
      if (stepCost(content, state, unit, previous) === null) continue;
      const nextCost = current.cost + entryCost;
      if (nextCost >= (costs.get(key(previous)) ?? Infinity)) continue;
      costs.set(key(previous), nextCost);
      frontier.push({ pos: previous, cost: nextCost });
    }
  }
  return costs;
}
