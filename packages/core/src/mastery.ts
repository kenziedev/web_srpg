import type {
  BattleState,
  Content,
  Evaluation,
  MasteryCommand,
  Unit,
} from "./types";
import { canPrepare } from "./equipment";
import { effectiveMaxMp } from "./effective";

export function masteryOptions(
  content: Content,
  state: BattleState,
  unit: Unit,
) {
  return (content.masteries ?? []).map((definition) => {
    const unlocked =
      unit.progression?.unlockedMasteryIds?.includes(definition.id) ?? false;
    const equipped = unit.progression?.equippedMasteryId === definition.id;
    const source = content.classes.find(
      (entry) => entry.id === definition.sourceClassId,
    );
    return {
      definition,
      unlocked,
      equipped,
      reason: !canPrepare(state)
        ? "출격 준비 중에만 마스터리를 바꿀 수 있습니다."
        : !unlocked
          ? `${source?.name ?? definition.sourceClassId} Lv10에서 해금됩니다.`
          : equipped
            ? "이미 장착한 마스터리입니다."
            : null,
    };
  });
}

export function evaluateMastery(
  content: Content,
  state: BattleState,
  command: MasteryCommand,
): Evaluation {
  if (!canPrepare(state))
    return {
      ok: false,
      error: "출격 준비 중에만 마스터리를 바꿀 수 있습니다.",
    };
  const unit = state.units.find((entry) => entry.id === command.unitId);
  if (
    !unit?.progression ||
    unit.kind !== "commander" ||
    unit.side !== "player" ||
    unit.hp <= 0 ||
    unit.summon
  )
    return {
      ok: false,
      error: "성장 기록이 있는 생존 아군 지휘관을 선택하세요.",
    };
  if (command.masteryId !== null) {
    const option = masteryOptions(content, state, unit).find(
      (entry) => entry.definition.id === command.masteryId,
    );
    if (!option) return { ok: false, error: "정의되지 않은 마스터리입니다." };
    if (option.reason) return { ok: false, error: option.reason };
  } else if (!unit.progression.equippedMasteryId)
    return { ok: false, error: "해제할 마스터리가 없습니다." };
  const nextState = structuredClone(state);
  const next = nextState.units.find((entry) => entry.id === unit.id)!;
  const oldMax = effectiveMaxMp(content, state, unit);
  next.progression!.equippedMasteryId = command.masteryId;
  const newMax = effectiveMaxMp(content, nextState, next);
  next.mp =
    oldMax > 0 ? Math.min(newMax, Math.floor((unit.mp * newMax) / oldMax)) : 0;
  nextState.revision += 1;
  nextState.commands.push(structuredClone(command));
  return {
    ok: true,
    nextState,
    events: [
      { type: "masteryChanged", unitId: unit.id, masteryId: command.masteryId },
    ],
  };
}
