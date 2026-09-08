import type { BattleState, Content, Position, Unit } from "./types";

export const distance = (a: Position, b: Position) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const samePosition = (a: Position, b: Position) =>
  a.x === b.x && a.y === b.y;
export const key = (p: Position) => `${p.x},${p.y}`;
export const allied = (a: Unit["side"], b: Unit["side"]) =>
  (a === "enemy") === (b === "enemy");
export function terrainAt(content: Content, p: Position) {
  const s = content.scenario;
  if (
    !Number.isInteger(p.x) ||
    !Number.isInteger(p.y) ||
    p.x < 0 ||
    p.y < 0 ||
    p.x >= s.width ||
    p.y >= s.height
  )
    return undefined;
  return content.terrains.find((t) => t.id === s.tiles[p.y * s.width + p.x]);
}
export function stepCost(
  content: Content,
  state: BattleState,
  unit: Unit,
  p: Position,
): number | null {
  const terrain = terrainAt(content, p);
  if (!terrain) return null;
  if (
    unit.moveType !== "flying" &&
    state.units.some(
      (other) => !allied(other.side, unit.side) && samePosition(other.pos, p),
    )
  )
    return null;
  return terrain.costs[unit.moveType];
}
export function canStop(
  content: Content,
  state: BattleState,
  unit: Unit,
  p: Position,
) {
  return (
    !!terrainAt(content, p) &&
    !terrainAt(content, p)!.noLanding &&
    !state.units.some(
      (other) => other.id !== unit.id && samePosition(other.pos, p),
    )
  );
}
export interface ReachableTile {
  pos: Position;
  cost: number;
  path: Position[];
}
/** Dijkstra with stable cost/y/x order; allies are traversable, occupied endpoints are excluded. */
export function reachable(
  content: Content,
  state: BattleState,
  unit: Unit,
): ReachableTile[] {
  const frontier: ReachableTile[] = [{ pos: unit.pos, cost: 0, path: [] }];
  const best = new Map<string, number>([[key(unit.pos), 0]]);
  const result: ReachableTile[] = [];
  while (frontier.length) {
    frontier.sort(
      (a, b) => a.cost - b.cost || a.pos.y - b.pos.y || a.pos.x - b.pos.x,
    );
    const current = frontier.shift()!;
    if (current.cost !== best.get(key(current.pos))) continue;
    if (canStop(content, state, unit, current.pos)) result.push(current);
    const { x, y } = current.pos;
    for (const pos of [
      { x, y: y - 1 },
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y + 1 },
    ]) {
      const cost = stepCost(content, state, unit, pos);
      if (cost === null) continue;
      const next = current.cost + cost;
      if (next > unit.stats.move || next >= (best.get(key(pos)) ?? Infinity))
        continue;
      best.set(key(pos), next);
      frontier.push({ pos, cost: next, path: [...current.path, pos] });
    }
  }
  return result;
}
