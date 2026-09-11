import type {
  BattleEvent,
  BattleState,
  Content,
  Evaluation,
  PromoteCommand,
  ReclassCommand,
  Unit,
} from "./types";
import { canPrepare } from "./equipment";
import { effectiveMaxMp, effectiveUnit } from "./effective";
import { gainExperience } from "./experience";
import { canStop } from "./movement";

type ClassDefinition = Content["classes"][number];

/** Completed battle snapshots stay immutable; their continuing roster advances. */
export function canAdvance(state: BattleState): boolean {
  return (
    canPrepare(state) ||
    (state.outcome?.status === "victory" &&
      state.progression.settlement?.outcome === "victory")
  );
}

export function advancementUnit(
  state: BattleState,
  unitId: string,
): Unit | undefined {
  const rosterUnit = state.progression.roster.find(
    (unit) => unit.id === unitId,
  );
  if (!rosterUnit?.progression) return undefined;
  return state.progression.settlement
    ? rosterUnit
    : (state.units.find((unit) => unit.id === unitId) ?? rosterUnit);
}

function unitReason(state: BattleState, unit: Unit | undefined): string | null {
  if (
    !unit?.progression ||
    unit.kind !== "commander" ||
    unit.summon ||
    unit.side !== "player"
  )
    return "성장 기록이 있는 아군 지휘관을 선택하세요.";
  if (!canAdvance(state))
    return "전직은 전투 시작 전 또는 승리 정산 뒤에 가능합니다.";
  if (
    !state.progression.settlement &&
    !state.units.some((entry) => entry.id === unit.id && entry.hp > 0)
  )
    return "준비 중에는 출격한 지휘관만 전직할 수 있습니다.";
  return null;
}

/** Show lasting stats, independent of the finished battle's temporary effects. */
function preparationView(
  content: Content,
  state: BattleState,
  unit: Unit,
): Unit {
  return effectiveUnit(
    content,
    { ...state, statuses: [], units: [unit] },
    unit,
  );
}

export interface ClassChangeOption {
  definition: ClassDefinition;
  reset: boolean;
  before: Unit;
  after: Unit;
  nextUnit: Unit;
  learnedSpellIds: string[];
  unequippedItemIds: string[];
  consumedItemId: string | null;
  reason: string | null;
}

function changeOption(
  content: Content,
  state: BattleState,
  before: Unit,
  definition: ClassDefinition,
  reset: boolean,
): ClassChangeOption {
  const next = structuredClone(before);
  const previous = before.progression!;
  next.unitType = definition.unitType;
  next.moveType = definition.moveType;
  next.stats.move = definition.move;
  next.range = [...definition.range];
  next.command = { ...definition.command };
  if (!reset)
    for (const stat of ["at", "df", "mag", "res"] as const)
      next.stats[stat] += definition.statBonus[stat] ?? 0;
  next.progression = {
    ...structuredClone(previous),
    classId: definition.id,
    level: 1,
    exp: 0,
    classHistory: [...previous.classHistory, definition.id],
  };
  const firstSpells = definition.learns
    .filter((entry) => entry.level <= 1)
    .flatMap((entry) => entry.spellIds);
  const newFirstSpells = firstSpells.filter(
    (id) => !previous.learnedSpellIds.includes(id),
  );
  next.progression.learnedSpellIds = [
    ...new Set([...previous.learnedSpellIds, ...firstSpells]),
  ];
  next.spellIds = [...new Set([...next.spellIds, ...newFirstSpells])];
  const grown = gainExperience(
    content,
    next,
    reset ? 0 : Math.min(100, previous.exp),
  );
  const result = grown.unit;
  // Banked EXP was already earned during settlement. Applying it again must not
  // inflate the lifetime counter that describes actual battle rewards.
  result.progression!.totalExp = previous.totalExp;
  const unequippedItemIds: string[] = [];
  for (const slot of ["weapon", "armor"] as const) {
    const itemId = result.equipment?.[slot];
    if (!itemId) continue;
    const item = content.items.find((entry) => entry.id === itemId);
    if (
      !item ||
      item.useEffect ||
      item.unavailableReason ||
      (item.allowedUnitTypes &&
        !item.allowedUnitTypes.includes(result.unitType))
    ) {
      result.equipment![slot] = null;
      unequippedItemIds.push(itemId);
    }
  }
  const cleanState = { ...state, statuses: [] };
  const oldMaxMp = effectiveMaxMp(content, cleanState, before);
  const newMaxMp = effectiveMaxMp(content, cleanState, result);
  result.mp =
    oldMaxMp > 0
      ? Math.min(newMaxMp, Math.floor((before.mp * newMaxMp) / oldMaxMp))
      : 0;
  const currentClass = content.classes.find(
    (entry) => entry.id === previous.classId,
  );
  const rune = content.items.find((item) => item.useEffect === "class-reset");
  let reason = unitReason(state, before);
  if (!reason && previous.level !== 10)
    reason = "직업 Lv10에서 전직할 수 있습니다.";
  if (!reason && reset && (currentClass?.tier !== 2 || definition.tier !== 1))
    reason = "룬스톤은 2차 직업 Lv10에서 사용할 수 있습니다.";
  if (!reason && reset && (!rune || (state.inventory[rune.id] ?? 0) < 1))
    reason = "소유한 룬스톤이 없습니다.";
  if (!reason && !reset && !currentClass?.promotions.includes(definition.id))
    reason = "현재 직업에서 선택할 수 없는 전직입니다.";
  if (
    !reason &&
    !state.progression.settlement &&
    !canStop(content, state, result, result.pos)
  )
    reason =
      "새 이동 방식으로 현재 칸에 설 수 없습니다. 승리 정산 뒤 전직하세요.";
  return {
    definition,
    reset,
    before: preparationView(content, state, before),
    after: preparationView(content, state, result),
    nextUnit: result,
    learnedSpellIds: [
      ...new Set([...newFirstSpells, ...grown.learnedSpellIds]),
    ],
    unequippedItemIds,
    consumedItemId: reset ? (rune?.id ?? null) : null,
    reason,
  };
}

/** Complete comparison remains available below Lv10; reasons control commit. */
export function classChangeOptions(
  content: Content,
  state: BattleState,
  unitId: string,
): ClassChangeOption[] {
  const unit = advancementUnit(state, unitId);
  if (!unit?.progression) return [];
  const current = content.classes.find(
    (entry) => entry.id === unit.progression!.classId,
  );
  if (!current) return [];
  return current.promotions.flatMap((classId) => {
    const definition = content.classes.find((entry) => entry.id === classId);
    return definition
      ? [changeOption(content, state, unit, definition, false)]
      : [];
  });
}

export function classResetOption(
  content: Content,
  state: BattleState,
  unitId: string,
): ClassChangeOption | null {
  const unit = advancementUnit(state, unitId);
  if (!unit?.progression) return null;
  const current = content.classes.find(
    (entry) => entry.id === unit.progression!.classId,
  );
  const base = content.classes.find(
    (entry) => entry.id === unit.progression!.baseClassId,
  );
  return current?.tier === 2 && base?.tier === 1
    ? changeOption(content, state, unit, base, true)
    : null;
}

function commitChange(
  state: BattleState,
  command: PromoteCommand | ReclassCommand,
  option: ClassChangeOption,
): Evaluation {
  if (option.reason) return { ok: false, error: option.reason };
  const nextState = structuredClone(state);
  const index = nextState.progression.roster.findIndex(
    (unit) => unit.id === command.unitId,
  );
  if (index < 0) return { ok: false, error: "성장 기록을 찾을 수 없습니다." };
  nextState.progression.roster[index] = structuredClone(option.nextUnit);
  if (!state.progression.settlement) {
    const unitIndex = nextState.units.findIndex(
      (unit) => unit.id === command.unitId,
    );
    if (unitIndex >= 0)
      nextState.units[unitIndex] = structuredClone(option.nextUnit);
  }
  if (option.consumedItemId)
    nextState.inventory[option.consumedItemId] =
      (nextState.inventory[option.consumedItemId] ?? 0) - 1;
  nextState.revision += 1;
  nextState.commands.push(structuredClone(command));
  const events: BattleEvent[] = [
    {
      type: "classChanged",
      unitId: command.unitId,
      from: option.before.progression!.classId,
      to: option.definition.id,
      reset: option.reset,
    },
  ];
  for (const slot of ["weapon", "armor"] as const)
    if (option.before.equipment?.[slot] && !option.nextUnit.equipment?.[slot])
      events.push({
        type: "equipmentChanged",
        unitId: command.unitId,
        slot,
        itemId: null,
      });
  if (option.nextUnit.progression!.level > 1)
    events.push({
      type: "levelUp",
      unitId: command.unitId,
      from: 1,
      to: option.nextUnit.progression!.level,
    });
  for (const spellId of option.learnedSpellIds)
    events.push({ type: "spellLearned", unitId: command.unitId, spellId });
  return { ok: true, nextState, events };
}

export function evaluatePromotion(
  content: Content,
  state: BattleState,
  command: PromoteCommand,
): Evaluation {
  const option = classChangeOptions(content, state, command.unitId).find(
    (candidate) => candidate.definition.id === command.classId,
  );
  return option
    ? commitChange(state, command, option)
    : { ok: false, error: "현재 직업에서 선택할 수 없는 전직입니다." };
}

export function evaluateReclass(
  content: Content,
  state: BattleState,
  command: ReclassCommand,
): Evaluation {
  const option = classResetOption(content, state, command.unitId);
  return option
    ? commitChange(state, command, option)
    : { ok: false, error: "룬스톤은 2차 직업 Lv10에서 사용할 수 있습니다." };
}

export function commanderGrowth(
  content: Content,
  state: BattleState,
  unitId: string,
) {
  const unit = advancementUnit(state, unitId);
  if (!unit?.progression) return null;
  const contribution = state.progression.contributions[unitId];
  return {
    unit,
    definition: content.classes.find(
      (entry) => entry.id === unit.progression!.classId,
    ),
    pendingExp: contribution
      ? contribution.damage +
        contribution.kills +
        contribution.retreats +
        contribution.healing +
        contribution.clear
      : 0,
    remainingExp:
      unit.progression.level === 10 ? 0 : 100 - unit.progression.exp,
    settlement: state.progression.settlement?.entries.find(
      (entry) => entry.unitId === unitId,
    ),
    options: classChangeOptions(content, state, unitId),
    reset: classResetOption(content, state, unitId),
  };
}
