import type {
  Action,
  ActCommand,
  BattleState,
  Content,
  Command,
  Unit,
} from "./types";
import { allied, distance, key, reachable, terrainAt } from "./movement";
import { commandBonus, damage, inAttackRange } from "./combat";
import { evaluate } from "./commands";
import { enemyIntent, objectiveCosts } from "./aiObjectives";
import { knownSpells, previewSpell, spellTargetTiles } from "./spells";
import { effectiveUnit } from "./effective";
import { hasStatus } from "./statuses";

export function phaseEndCommand(state: BattleState): Command {
  return {
    type: "endPhase",
    side: state.activeSide,
    commandId: `phase-${state.revision + 1}`,
    expectedRevision: state.revision,
  };
}

/** One finite, deterministic action with an optional content-defined squad timetable. */
export function nextEnemyCommand(
  content: Content,
  state: BattleState,
): Command | null {
  return nextAutomaticCommand(content, state, "enemy");
}

/** Charmed allies and their summons act during the NPC phase before it ends. */
export function nextNpcCommand(
  content: Content,
  state: BattleState,
): Command | null {
  return nextAutomaticCommand(content, state, "npc");
}

function nextAutomaticCommand(
  content: Content,
  state: BattleState,
  side: "enemy" | "npc",
): Command | null {
  if (state.activeSide !== side || state.outcome) return null;
  const actor = state.units
    .filter(
      (u) =>
        u.side === side &&
        !u.acted &&
        u.kind !== "escort" &&
        (side === "enemy" || hasStatus(state, u, "charm") || !!u.summon),
    )
    .sort(
      (a, b) =>
        Number(a.kind === "commander") - Number(b.kind === "commander") ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0];
  if (!actor) return phaseEndCommand(state);
  const enemies = state.units.filter((u) => !allied(u.side, actor.side));
  const ownLeader = state.units.find((u) => u.id === actor.commanderId);
  const spells = knownSpells(content, actor);
  const needsMagicRecovery = spells.some(
    (spell) =>
      spell.mpCost > actor.mp &&
      spell.mpCost <= effectiveUnit(content, state, actor).stats.maxMp,
  );
  const intent = enemyIntent(content, state, actor);
  const objective = intent
    ? objectiveCosts(content, state, actor, intent.target)
    : null;
  const followsObjective = objective?.has(key(actor.pos)) ?? false;
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
      if (inAttackRange(moved, target, content, state))
        actions.push({ type: "attack", targetId: target.id });
    if (
      tile.path.length === 0 &&
      actor.kind === "commander" &&
      (actor.hp < 10 || needsMagicRecovery)
    )
      actions.push({ type: "treat" });
    for (const spell of spells) {
      if (actor.mp < spell.mpCost) continue;
      const centers = spellTargetTiles(content, actor, spell, tile.pos);
      if (spell.effect.type === "teleport") {
        // Bound destination search; final placement still goes through the same preview.
        const destinations = [...centers]
          .sort((a, b) => {
            const gap = (pos: typeof a) =>
              enemies.length
                ? Math.min(...enemies.map((enemy) => distance(pos, enemy.pos)))
                : distance(pos, actor.pos);
            return gap(a) - gap(b) || a.y - b.y || a.x - b.x;
          })
          .slice(0, 8);
        for (const center of centers)
          for (const destination of destinations)
            if (
              previewSpell(
                content,
                state,
                actor,
                spell.id,
                center,
                tile.pos,
                destination,
              ).ok
            )
              actions.push({
                type: "cast",
                spellId: spell.id,
                target: center,
                destination,
              });
      } else
        for (const center of centers)
          if (
            previewSpell(content, state, actor, spell.id, center, tile.pos).ok
          )
            actions.push({ type: "cast", spellId: spell.id, target: center });
    }
    for (const action of actions) {
      const command: ActCommand = {
        type: "act",
        commandId: `${side}-${state.revision + 1}`,
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
      const remaining = followsObjective
        ? objective!.get(key(tile.pos))
        : undefined;
      let score = -(remaining ?? nearest) * 5 - tile.cost;
      for (const event of result.events) {
        if (event.type === "damaged")
          score +=
            event.unitId === actor.id ? -event.amount * 18 : event.amount * 16;
        if (event.type === "healed" && event.unitId === actor.id)
          score += event.amount * (actor.hp <= 3 ? 35 : 8);
        else if (event.type === "healed") {
          const healed = state.units.find((unit) => unit.id === event.unitId)!;
          score +=
            event.amount *
            (healed.hp <= 3 ? 32 : 16) *
            (healed.kind === "commander" ? 1.5 : 1);
        }
        if (event.type === "statusApplied" && event.success) score += 26;
        if (event.type === "summoned") score += 80;
        if (event.type === "refreshed") score += 40;
        if (event.type === "removed") {
          const lost = state.units.find((u) => u.id === event.unitId)!;
          score +=
            (allied(lost.side, actor.side) ? -1 : 1) *
            (lost.kind === "commander" ? 160 : 45);
        }
      }
      if (action.type === "cast")
        score -=
          (content.spells.find((spell) => spell.id === action.spellId)
            ?.mpCost ?? 0) * 2;
      const surviving = result.nextState.units.find((u) => u.id === actor.id);
      if (surviving) {
        if (action.type === "treat" && needsMagicRecovery)
          score += (surviving.mp - actor.mp) * 8;
        if (commandBonus(result.nextState, surviving, content).active)
          score += 12;
        if (
          actor.hp <= 5 &&
          ownLeader &&
          distance(tile.pos, ownLeader.pos) === 1
        )
          score += 35;
        if (actor.moveType !== "flying")
          score +=
            (terrainAt(content, tile.pos, result.nextState)?.defense ?? 0) * 3;
        // Immediate opposing ranges only; not a claim to predict a whole player turn.
        for (const threat of result.nextState.units.filter(
          (u) => !allied(u.side, actor.side),
        )) {
          if (inAttackRange(threat, surviving, content, result.nextState))
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
      commandId: `${side}-${state.revision + 1}`,
      expectedRevision: state.revision,
      unitId: actor.id,
      path: [],
      action: { type: "wait" },
    }
  );
}
