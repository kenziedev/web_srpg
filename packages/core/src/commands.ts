import type {
  Command,
  BattleEvent,
  BattleState,
  Content,
  Evaluation,
} from "./types";
import { allied, canStop, distance, samePosition, stepCost } from "./movement";
import { canCounter, damage, inAttackRange } from "./combat";
import { endPhase } from "./phases";
import { resolveOutcome } from "./scenario";
import { knownSpells, previewSpell } from "./spells";
import { effectiveUnit, effectiveMaxMp } from "./effective";
import { hasStatus, removeDefeated } from "./statuses";
import { executeSpell } from "./spellExecution";
import { evaluateEquip } from "./equipment";
import { evaluateTrain } from "./preparation";
import { evaluatePromotion, evaluateReclass } from "./advancement";
import { evaluateDeploy } from "./deployment";
import { recordContribution, syncRoster } from "./experience";
import { MAX_SAVE_COMMANDS } from "@orden/schema";
import { evaluateMastery } from "./mastery";
import { evaluateHire, evaluateTrade, evaluateStartBattle } from "./operation";

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
  if (state.commands.length >= MAX_SAVE_COMMANDS)
    return reject(
      "저장 가능한 명령 수에 도달했습니다. 진행을 백업한 뒤 ‘연습 초기화’로 시작할 수 있습니다. 초기화하면 성장도 처음으로 돌아갑니다.",
    );
  const prepared = (result: Evaluation) => {
    if (result.ok) syncRoster(state, result.nextState);
    return result;
  };
  if (command.type === "mastery")
    return prepared(evaluateMastery(content, state, command));
  if (command.type === "hire")
    return prepared(evaluateHire(content, state, command));
  if (command.type === "buy" || command.type === "sell")
    return prepared(evaluateTrade(content, state, command));
  if (command.type === "startBattle")
    return prepared(evaluateStartBattle(content, state, command));
  if (command.type === "promote")
    return prepared(evaluatePromotion(content, state, command));
  if (command.type === "reclass")
    return prepared(evaluateReclass(content, state, command));
  if (command.type === "deploy") return evaluateDeploy(content, state, command);
  if (state.outcome) return reject("이미 종료된 전투입니다.");
  if (
    (command.type === "act" || command.type === "endPhase") &&
    state.mode === "operation" &&
    state.operation?.phase !== "battle"
  )
    return reject("작전 준비를 마치고 출격을 확정하세요.");
  if (command.type === "endPhase")
    return prepared(endPhase(content, state, command));
  if (command.type === "equip")
    return prepared(evaluateEquip(content, state, command));
  if (command.type === "train")
    return prepared(evaluateTrain(content, state, command));
  const unit = state.units.find((u) => u.id === command.unitId);
  if (!unit || unit.hp <= 0 || unit.side !== state.activeSide || unit.acted)
    return reject("행동할 수 없는 유닛입니다.");
  if (unit.kind === "escort")
    return reject("호송대는 NPC 페이즈에 경로를 따라 자동 이동합니다.");
  if (
    hasStatus(state, unit, "sleep") &&
    (command.path.length > 0 || command.action.type !== "wait")
  )
    return reject("슬립 상태에서는 제자리 대기만 가능합니다.");
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
  if (
    cost > effectiveUnit(content, state, unit).stats.move ||
    !canStop(content, state, unit, from)
  )
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
  if (action.type === "attack") {
    const target = nextState.units.find((u) => u.id === action.targetId);
    if (!target || target.hp <= 0) return reject("대상이 없습니다.");
    if (
      allied(actor.side, target.side) ||
      !inAttackRange(actor, target, content, nextState)
    )
      return reject("공격할 수 없는 대상 또는 사거리입니다.");
    const dealt = Math.min(
      target.hp,
      damage(content, nextState, actor, target, command.path),
    );
    const returned = canCounter(content, nextState, target, actor)
      ? Math.min(actor.hp, damage(content, nextState, target, actor))
      : 0;
    target.hp -= dealt;
    actor.hp -= returned;
    events.push(
      { type: "damaged", unitId: target.id, amount: dealt },
      { type: "damaged", unitId: actor.id, amount: returned },
    );
  } else if (action.type === "cast" || action.type === "heal") {
    const legacyTarget =
      action.type === "heal"
        ? nextState.units.find((target) => target.id === action.targetId)
        : undefined;
    if (
      action.type === "heal" &&
      (!legacyTarget ||
        legacyTarget.hp <= 0 ||
        !allied(actor.side, legacyTarget.side))
    )
      return reject("회복할 아군 대상을 확인하세요.");
    const spellId =
      action.type === "cast"
        ? action.spellId
        : knownSpells(content, actor).find(
            (spell) => spell.effect.type === "heal",
          )?.id;
    const center = action.type === "cast" ? action.target : legacyTarget?.pos;
    if (!spellId || !center) return reject("사용할 마법 또는 대상이 없습니다.");
    const preview = previewSpell(
      content,
      nextState,
      actor,
      spellId,
      center,
      actor.pos,
      action.type === "cast" ? action.destination : undefined,
    );
    if (!preview.ok) return reject(preview.error);
    events.push({
      type: "spellCast",
      unitId: actor.id,
      spellId: preview.spell.id,
      center: { ...center },
      affectedIds: preview.targets.map((target) => target.unitId),
    });
    executeSpell(nextState, actor, preview, events);
  } else if (action.type === "treat") {
    const amount = Math.min(3, 10 - actor.hp);
    actor.hp += amount;
    actor.mp = Math.min(
      effectiveMaxMp(content, nextState, actor),
      actor.mp + 2,
    );
    events.push({ type: "healed", unitId: actor.id, amount });
  }
  removeDefeated(nextState, events);
  actor.acted = true;
  events.push({ type: "acted", unitId: actor.id });
  recordContribution(content, state, nextState, command, events);
  syncRoster(state, nextState);
  resolveOutcome(content, nextState, events);
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
