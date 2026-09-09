import type { BattleState, Content, ActCommand, Action } from "./types";
import { distance, reachable } from "./movement";
import { evaluate } from "./commands";
import { inAttackRange } from "./combat";

/** Unacted player mercenaries follow their own leader; manual wait is an explicit hold order. */
export function nextFollowerCommand(
  content: Content,
  state: BattleState,
): ActCommand | null {
  if (state.activeSide !== "player" || state.outcome) return null;
  const unit = state.units
    .filter((u) => u.side === "player" && u.kind === "mercenary" && !u.acted)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (!unit) return null;
  const leader = state.units.find(
    (u) =>
      u.id === unit.commanderId &&
      u.side === unit.side &&
      u.kind === "commander" &&
      u.hp > 0,
  );
  const base = {
    type: "act" as const,
    unitId: unit.id,
    commandId: `follow-${state.revision + 1}`,
    expectedRevision: state.revision,
  };
  if (!leader) return { ...base, path: [], action: { type: "wait" } };
  const tiles = reachable(content, state, unit).sort(
    (a, b) => a.cost - b.cost || a.pos.y - b.pos.y || a.pos.x - b.pos.x,
  );
  const nearest = Math.min(...tiles.map((t) => distance(t.pos, leader.pos)));
  const radius = leader.command?.radius ?? 0;
  const enemies = state.units
    .filter((u) => u.side === "enemy")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let best: { score: number; command: ActCommand } | null = null;
  for (const tile of tiles) {
    const gap = distance(tile.pos, leader.pos);
    // Never chase beyond command range; when separated, close the gap first.
    if (gap > Math.max(radius, nearest)) continue;
    const actions: Action[] = [{ type: "wait" }];
    if (gap <= radius)
      for (const target of enemies)
        if (inAttackRange({ ...unit, pos: tile.pos }, target))
          actions.push({ type: "attack", targetId: target.id });
    for (const action of actions) {
      const command: ActCommand = { ...base, path: tile.path, action };
      const result = evaluate(content, state, command);
      if (!result.ok) continue;
      let score = -gap * 8 - tile.cost;
      for (const event of result.events) {
        if (event.type === "damaged")
          score +=
            event.unitId === unit.id ? -event.amount * 20 : event.amount * 24;
        if (event.type === "removed")
          score += event.unitId === unit.id ? -200 : 90;
      }
      if (unit.hp <= 4 && gap === 1) score += 50;
      // Follow without stopping on the escort's next route segment when another tile works.
      const mission = content.scenario.mission;
      const escort = state.units.find((u) => u.id === mission?.escortId);
      if (mission && escort) {
        const index = mission.route.findIndex(
          (p) => p.x === escort.pos.x && p.y === escort.pos.y,
        );
        if (
          mission.route
            .slice(index + 1, index + 1 + escort.stats.move)
            .some((p) => p.x === tile.pos.x && p.y === tile.pos.y)
        )
          score -= 60;
      }
      if (!best || score > best.score) best = { score, command };
    }
  }
  return best?.command ?? { ...base, path: [], action: { type: "wait" } };
}
