import type { BattleState, Content, Position, Unit } from "./types";
import { canStop, distance, key, samePosition, stepCost } from "./movement";

export function squadMembers(state: BattleState, anchor: Unit): Unit[] {
  // Unaffiliated escorts remain individual; charmed commanders retain their squad.
  const leaderId =
    anchor.kind === "escort"
      ? null
      : anchor.kind === "commander"
        ? anchor.id
        : anchor.commanderId;
  return state.units.filter(
    (target) =>
      target.hp > 0 &&
      target.side === anchor.side &&
      (target.id === anchor.id ||
        (leaderId !== null &&
          (target.id === leaderId || target.commanderId === leaderId))),
  );
}

/** Finite bipartite matching, not greedy placement or exponential backtracking. */
export function teleportPlacements(
  content: Content,
  state: BattleState,
  group: Unit[],
  anchor: Unit,
  destination: Position,
): { unitId: string; pos: Position }[] | null {
  if (group.some((unit) => unit.kind === "escort")) return null;
  const members = new Set(group.map((unit) => unit.id));
  const cleared = {
    ...state,
    units: state.units.filter((unit) => !members.has(unit.id)),
  };
  const legal = (unit: Unit, pos: Position) =>
    canStop(content, cleared, unit, pos) &&
    stepCost(content, cleared, unit, pos) !== null;
  if (!legal(anchor, destination)) return null;
  const rest = group
    .filter((unit) => unit.id !== anchor.id)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const candidates = new Map<string, Position[]>();
  for (const unit of rest) {
    const preferred = {
      x: destination.x + unit.pos.x - anchor.pos.x,
      y: destination.y + unit.pos.y - anchor.pos.y,
    };
    const slots: Position[] = [];
    for (
      let y = Math.max(0, destination.y - 3);
      y <= Math.min(content.scenario.height - 1, destination.y + 3);
      y += 1
    )
      for (
        let x = Math.max(0, destination.x - 3);
        x <= Math.min(content.scenario.width - 1, destination.x + 3);
        x += 1
      ) {
        const pos = { x, y };
        if (
          distance(destination, pos) <= 3 &&
          !samePosition(destination, pos) &&
          legal(unit, pos)
        )
          slots.push(pos);
      }
    slots.sort(
      (a, b) =>
        distance(a, preferred) - distance(b, preferred) ||
        distance(a, destination) - distance(b, destination) ||
        a.y - b.y ||
        a.x - b.x,
    );
    candidates.set(unit.id, slots);
  }
  const occupied = new Map<string, string>();
  const placement = new Map<string, Position>();
  const assign = (unitId: string, visited: Set<string>): boolean => {
    for (const pos of candidates.get(unitId) ?? []) {
      const tileKey = key(pos);
      if (visited.has(tileKey)) continue;
      visited.add(tileKey);
      const other = occupied.get(tileKey);
      if (!other || assign(other, visited)) {
        occupied.set(tileKey, unitId);
        placement.set(unitId, pos);
        return true;
      }
    }
    return false;
  };
  for (const unit of rest) if (!assign(unit.id, new Set())) return null;
  return [
    { unitId: anchor.id, pos: { ...destination } },
    ...rest.map((unit) => ({
      unitId: unit.id,
      pos: { ...placement.get(unit.id)! },
    })),
  ];
}
