import type {
  Action,
  ActCommand,
  BattleState,
  Content,
  Command,
  Unit,
} from "./types";
import { allied, distance, reachable, terrainAt } from "./movement";
import { commandBonus, damage, inAttackRange } from "./combat";
import { evaluate } from "./commands";

export function phaseEndCommand(state: BattleState): Command {
  return {
    type: "endPhase",
    side: state.activeSide,
    commandId: `phase-${state.revision + 1}`,
    expectedRevision: state.revision,
  };
}

/** One finite, deterministic action. Cooperative objective planning remains a later milestone. */
export function nextEnemyCommand(
  content: Content,
  state: BattleState,
): Command | null {
  if (state.activeSide !== "enemy") return null;
  const actor = state.units
    .filter((u) => u.side === "enemy" && !u.acted)
    .sort(
      (a, b) =>
        Number(a.kind === "commander") - Number(b.kind === "commander") ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0];
  if (!actor) return phaseEndCommand(state);
  const enemies = state.units.filter((u) => !allied(u.side, actor.side));
  const ownLeader = state.units.find((u) => u.id === actor.commanderId);
  let best: { score: number; command: ActCommand } | null = null;
  const tiles = reachable(content, state, actor).sort(
    (a, b) => a.cost - b.cost || a.pos.y - b.pos.y || a.pos.x - b.pos.x,
  );
  const orderedEnemies = [...enemies].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const tile of tiles) {
    const moved: Unit = { ...actor, pos: tile.pos };
    const actions: Action[] = [{ type: "wait" }];
    for (const target of orderedEnemies)
      if (inAttackRange(moved, target))
        actions.push({ type: "attack", targetId: target.id });
    if (tile.path.length === 0 && actor.kind === "commander" && actor.hp < 10)
      actions.push({ type: "treat" });
    for (const action of actions) {
      const command: ActCommand = {
        type: "act",
        commandId: `enemy-${state.revision + 1}`,
        expectedRevision: state.revision,
        unitId: actor.id,
        path: tile.path,
        action,
      };
      const result = evaluate(content, state, command);
      if (!result.ok) continue;
      const nearest = enemies.length
        ? Math.min(...enemies.map((u) => distance(tile.pos, u.pos)))
        : 0;
      let score = -nearest * 5 - tile.cost;
      for (const event of result.events) {
        if (event.type === "damaged")
          score +=
            event.unitId === actor.id ? -event.amount * 18 : event.amount * 16;
        if (event.type === "healed" && event.unitId === actor.id)
          score += event.amount * (actor.hp <= 3 ? 35 : 8);
        if (event.type === "removed") {
          const lost = state.units.find((u) => u.id === event.unitId)!;
          score +=
            (allied(lost.side, actor.side) ? -1 : 1) *
            (lost.kind === "commander" ? 160 : 45);
        }
      }
      const surviving = result.nextState.units.find((u) => u.id === actor.id);
      if (surviving) {
        if (commandBonus(result.nextState, surviving).active) score += 12;
        if (
          actor.hp <= 5 &&
          ownLeader &&
          distance(tile.pos, ownLeader.pos) === 1
        )
          score += 35;
        if (actor.moveType !== "flying")
          score += (terrainAt(content, tile.pos)?.defense ?? 0) * 3;
        // Immediate opposing ranges only; not a claim to predict a whole player turn.
        for (const threat of result.nextState.units.filter(
          (u) => !allied(u.side, actor.side),
        )) {
          if (inAttackRange(threat, surviving))
            score -=
              damage(content, result.nextState, threat, surviving) *
              (actor.kind === "commander" ? 8 : 3);
        }
      }
      if (!best || score > best.score) best = { score, command };
    }
  }
  return (
    best?.command ?? {
      type: "act",
      commandId: `enemy-${state.revision + 1}`,
      expectedRevision: state.revision,
      unitId: actor.id,
      path: [],
      action: { type: "wait" },
    }
  );
}
