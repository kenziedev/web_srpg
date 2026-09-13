import type { BattleState, Content, Evaluation, TrainCommand } from "./types";
import { canPrepare } from "./equipment";
import type { Unit } from "./types";

export function learnableSpells(
  content: Content,
  state: BattleState,
  unit: Unit,
) {
  return content.spells.filter(
    (spell) =>
      spell.learnable !== false &&
      (state.mode === "practice" ||
        unit.progression?.learnedSpellIds.includes(spell.id)),
  );
}

/** The practice battle's spell loadout, before the first tactical command. */
export function evaluateTrain(
  content: Content,
  state: BattleState,
  command: TrainCommand,
): Evaluation {
  if (!canPrepare(state))
    return {
      ok: false,
      error: "마법 편성은 전투 시작 전에만 변경할 수 있습니다.",
    };
  const unit = state.units.find((entry) => entry.id === command.unitId);
  if (
    !unit ||
    unit.side !== "player" ||
    unit.kind !== "commander" ||
    unit.summon ||
    unit.stats.maxMp === 0
  )
    return { ok: false, error: "마법을 편성할 지휘관을 확인하세요." };
  if (
    new Set(command.spellIds).size !== command.spellIds.length ||
    command.spellIds.some(
      (id) =>
        !learnableSpells(content, state, unit).some((spell) => spell.id === id),
    )
  )
    return { ok: false, error: "편성할 수 없는 마법이 포함되어 있습니다." };
  if (JSON.stringify(unit.spellIds) === JSON.stringify(command.spellIds))
    return { ok: false, error: "현재 마법 편성과 같습니다." };
  const nextState = structuredClone(state);
  nextState.units.find((entry) => entry.id === unit.id)!.spellIds = [
    ...command.spellIds,
  ];
  nextState.revision += 1;
  nextState.commands.push(structuredClone(command));
  return {
    ok: true,
    nextState,
    events: [
      { type: "scenario", message: `${unit.name}의 마법 편성을 변경했습니다.` },
    ],
  };
}
