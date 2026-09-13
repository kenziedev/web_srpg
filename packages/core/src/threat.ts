import { commandBonus } from "./combat";
import { effectiveUnit } from "./effective";
import { distance, key, reachable, terrainAt } from "./movement";
import { hasStatus } from "./statuses";
import type { BattleState, Content, Position } from "./types";

export interface PhysicalThreatTile {
  pos: Position;
  enemyIds: string[];
}

/**
 * Physical attack coverage from current legal movement endpoints. Spent units
 * are included; current sleep, terrain and occupancy still apply. This does not
 * simulate a future phase, spell, reinforcement, target defense or damage.
 */
export function enemyPhysicalThreat(
  content: Content,
  state: BattleState,
): PhysicalThreatTile[] {
  const covered = new Map<string, PhysicalThreatTile>();
  const enemies = state.units
    .filter(
      (unit) =>
        unit.side === "enemy" &&
        unit.hp > 0 &&
        unit.kind !== "escort" &&
        !hasStatus(state, unit, "sleep"),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const unit of enemies) {
    const [minimum, maximum] = effectiveUnit(content, state, unit).range;
    const ownCoverage = new Map<string, Position>();
    for (const { pos: origin } of reachable(content, state, unit)) {
      for (let dy = -maximum; dy <= maximum; dy++) {
        for (
          let dx = -maximum + Math.abs(dy);
          dx <= maximum - Math.abs(dy);
          dx++
        ) {
          if (Math.abs(dx) + Math.abs(dy) < minimum) continue;
          const pos = { x: origin.x + dx, y: origin.y + dy };
          if (terrainAt(content, pos, state)) ownCoverage.set(key(pos), pos);
        }
      }
    }
    for (const [cell, pos] of ownCoverage) {
      const previous = covered.get(cell);
      if (previous) previous.enemyIds.push(unit.id);
      else covered.set(cell, { pos, enemyIds: [unit.id] });
    }
  }
  return [...covered.values()].sort(
    (a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x,
  );
}

export interface CommandRangePreview {
  leaderId: string;
  origin: Position;
  radius: number;
  tiles: Position[];
  bonuses: {
    unitId: string;
    before: ReturnType<typeof commandBonus>;
    after: ReturnType<typeof commandBonus>;
  }[];
}

/** Preview a position already chosen from reachable; never move the stored unit. */
export function previewCommandRange(
  content: Content,
  state: BattleState,
  selectedId: string,
  destination?: Position | null,
): CommandRangePreview | null {
  const selected = state.units.find(
    (unit) => unit.id === selectedId && unit.hp > 0,
  );
  if (!selected || (destination && !terrainAt(content, destination, state)))
    return null;
  const preview = destination
    ? {
        ...state,
        units: state.units.map((unit) =>
          unit.id === selectedId ? { ...unit, pos: { ...destination } } : unit,
        ),
      }
    : state;
  const baseLeader = preview.units.find(
    (unit) =>
      unit.id ===
        (selected.kind === "commander" ? selected.id : selected.commanderId) &&
      unit.kind === "commander" &&
      unit.side === selected.side &&
      unit.hp > 0,
  );
  if (!baseLeader) return null;
  const leader = effectiveUnit(content, preview, baseLeader);
  if (!leader.command) return null;
  const tiles: Position[] = [];
  for (let y = 0; y < content.scenario.height; y++)
    for (let x = 0; x < content.scenario.width; x++) {
      const pos = { x, y };
      if (distance(pos, leader.pos) <= leader.command.radius) tiles.push(pos);
    }
  return {
    leaderId: leader.id,
    origin: { ...leader.pos },
    radius: leader.command.radius,
    tiles,
    bonuses: preview.units
      .filter(
        (unit) =>
          unit.kind === "mercenary" &&
          unit.commanderId === leader.id &&
          unit.side === leader.side &&
          unit.hp > 0,
      )
      .map((unit) => ({
        unitId: unit.id,
        before: commandBonus(
          state,
          state.units.find((stored) => stored.id === unit.id)!,
          content,
        ),
        after: commandBonus(preview, unit, content),
      })),
  };
}
