import type {
  BattleState,
  Content,
  EndPhaseCommand,
  Evaluation,
  BattleEvent,
} from "./types";
import { distance, terrainAt } from "./movement";
import { finishRound, moveEscort, resolveOutcome } from "./scenario";
import { expireStatuses, hasStatus } from "./statuses";

/** Called only after shared command/version validation. No wall-clock or UI dependencies. */
export function endPhase(
  content: Content,
  state: BattleState,
  command: EndPhaseCommand,
): Evaluation {
  if (command.side !== state.activeSide)
    return { ok: false, error: "현재 진영의 턴만 종료할 수 있습니다." };
  const nextState = structuredClone(state);
  const events: BattleEvent[] = [];
  resolveOutcome(content, nextState, events);
  if (state.activeSide === "npc") finishRound(content, nextState, events);
  if (nextState.outcome) {
    nextState.revision += 1;
    nextState.commands.push(structuredClone(command));
    return { ok: true, nextState, events };
  }
  for (const unit of nextState.units)
    if (unit.side === state.activeSide) unit.acted = true;
  nextState.activeSide =
    state.activeSide === "player"
      ? "enemy"
      : state.activeSide === "enemy"
        ? "npc"
        : "player";
  if (nextState.activeSide === "player") nextState.round += 1;
  events.push({
    type: "phaseStarted",
    side: nextState.activeSide,
    round: nextState.round,
  });
  expireStatuses(nextState, events);
  // Status expiration precedes action reset and recovery. Never restore removed units.
  for (const unit of nextState.units) {
    if (unit.side !== nextState.activeSide || unit.hp <= 0) continue;
    unit.acted = hasStatus(nextState, unit, "sleep");
    const leader = nextState.units.find(
      (other) =>
        other.id === unit.commanderId &&
        other.side === unit.side &&
        other.kind === "commander" &&
        other.hp > 0,
    );
    const adjacent =
      unit.kind === "mercenary" &&
      leader &&
      distance(unit.pos, leader.pos) === 1
        ? 3
        : 0;
    const terrain =
      unit.moveType === "flying"
        ? 0
        : (terrainAt(content, unit.pos, nextState)?.recovery ?? 0);
    const amount = Math.min(10 - unit.hp, Math.max(adjacent, terrain));
    if (amount > 0) {
      unit.hp += amount;
      events.push({ type: "healed", unitId: unit.id, amount });
    }
  }
  if (nextState.activeSide === "npc") moveEscort(content, nextState, events);
  nextState.revision += 1;
  nextState.commands.push(structuredClone(command));
  return { ok: true, nextState, events };
}
