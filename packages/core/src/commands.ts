import type {
  Command,
  BattleEvent,
  BattleState,
  Content,
  Evaluation,
} from "./types";
import { allied, canStop, distance, samePosition, stepCost } from "./movement";
import { damage, inAttackRange } from "./combat";
import { endPhase } from "./phases";

/** Pure preview and reducer share one path. On rejection, no state or log is mutated. */
export function evaluate(
  content: Content,
  state: BattleState,
  command: Command,
): Evaluation {
  const reject = (error: string): Evaluation => ({ ok: false, error });
  if (state.rulesVersion !== content.rulesVersion)
    return reject("규칙 버전이 일치하지 않습니다.");
  if (
    !command.commandId ||
    command.expectedRevision !== state.revision ||
    state.commands.some((c) => c.commandId === command.commandId)
  )
    return reject("이미 처리했거나 오래된 명령입니다.");
  if (command.type === "endPhase") return endPhase(content, state, command);
  const unit = state.units.find((u) => u.id === command.unitId);
  if (!unit || unit.hp <= 0 || unit.side !== state.activeSide || unit.acted)
    return reject("행동할 수 없는 유닛입니다.");
  let from = unit.pos;
  let cost = 0;
  for (const pos of command.path) {
    if (distance(from, pos) !== 1)
      return reject("이동 경로는 상하좌우로 연결되어야 합니다.");
    const step = stepCost(content, state, unit, pos);
    if (step === null) return reject("통과할 수 없는 경로입니다.");
    cost += step;
    from = pos;
  }
  if (cost > unit.stats.move || !canStop(content, state, unit, from))
    return reject("이동력이 부족하거나 목적지가 점유되었습니다.");
  if (
    command.action.type === "treat" &&
    (command.path.length > 0 || unit.kind !== "commander")
  )
    return reject("정비는 지휘관이 제자리에서만 할 수 있습니다.");
  const nextState = structuredClone(state);
  const actor = nextState.units.find((u) => u.id === unit.id)!;
  actor.pos = { ...from };
  const events: BattleEvent[] = [];
  if (!samePosition(unit.pos, from))
    events.push({ type: "moved", unitId: unit.id, to: { ...from } });
  const action = command.action;
  if (action.type === "attack" || action.type === "heal") {
    const target = nextState.units.find((u) => u.id === action.targetId);
    if (!target || target.hp <= 0) return reject("대상이 없습니다.");
    if (action.type === "attack") {
      if (allied(actor.side, target.side) || !inAttackRange(actor, target))
        return reject("공격할 수 없는 대상 또는 사거리입니다.");
      const dealt = Math.min(
        target.hp,
        damage(content, nextState, actor, target),
      );
      const returned = inAttackRange(target, actor)
        ? Math.min(actor.hp, damage(content, nextState, target, actor))
        : 0;
      target.hp -= dealt;
      actor.hp -= returned;
      events.push(
        { type: "damaged", unitId: target.id, amount: dealt },
        { type: "damaged", unitId: actor.id, amount: returned },
      );
    } else {
      if (
        !actor.canHeal ||
        actor.kind !== "commander" ||
        actor.mp < 3 ||
        !allied(actor.side, target.side) ||
        distance(actor.pos, target.pos) > 3 ||
        target.hp === 10
      )
        return reject("회복 대상·사거리·MP를 확인하세요.");
      const amount = Math.min(3, 10 - target.hp);
      actor.mp -= 3;
      target.hp += amount;
      events.push({ type: "healed", unitId: target.id, amount });
    }
  } else if (action.type === "treat") {
    const amount = Math.min(3, 10 - actor.hp);
    actor.hp += amount;
    actor.mp = Math.min(actor.stats.maxMp, actor.mp + 2);
    events.push({ type: "healed", unitId: actor.id, amount });
  }
  const fallenCommanders = new Set(
    nextState.units
      .filter((u) => u.hp === 0 && u.kind === "commander")
      .map((u) => u.id),
  );
  nextState.units = nextState.units.filter((u) => {
    const reason =
      u.hp === 0
        ? "defeated"
        : u.commanderId && fallenCommanders.has(u.commanderId)
          ? "retreated"
          : null;
    if (reason) events.push({ type: "removed", unitId: u.id, reason });
    return reason === null;
  });
  actor.acted = true;
  events.push({ type: "acted", unitId: actor.id });
  nextState.revision += 1;
  nextState.commands.push(structuredClone(command));
  return { ok: true, nextState, events };
}

export function apply(
  content: Content,
  state: BattleState,
  command: Command,
): Evaluation {
  return evaluate(content, state, command);
}
