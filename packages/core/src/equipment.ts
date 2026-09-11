import type { Item } from "@orden/schema";
import type {
  BattleState,
  Content,
  EquipCommand,
  Evaluation,
  Unit,
} from "./types";
import { effectiveMaxMp } from "./effective";

export type EquipmentSlot = Item["slot"];

/** Preparation closes permanently when the first tactical action/phase is logged. */
export function canPrepare(state: BattleState): boolean {
  return (
    !state.outcome &&
    state.round === 1 &&
    state.activeSide === "player" &&
    !state.commands.slice(state.progression.battleStartRevision).some(
      (command) => command.type === "act" || command.type === "endPhase",
    )
  );
}

export interface EquipmentOption {
  item: Item;
  owned: number;
  available: number;
  equipped: boolean;
  reason: string | null;
}

export function equipmentOptions(
  content: Content,
  state: BattleState,
  unit: Unit,
  slot: EquipmentSlot,
): EquipmentOption[] {
  return content.items
    .filter((item) => item.slot === slot)
    .map((item) => {
      const owned = state.inventory[item.id] ?? 0;
      const used = state.units.reduce(
        (count, candidate) =>
          count +
          Number(candidate.equipment?.weapon === item.id) +
          Number(candidate.equipment?.armor === item.id),
        0,
      );
      const available = Math.max(0, owned - used);
      const equipped = unit.equipment?.[slot] === item.id;
      const reason = !canPrepare(state)
        ? "첫 전투 행동 이후에는 장비를 바꿀 수 없습니다."
        : unit.kind !== "commander" || unit.side !== "player" || unit.hp <= 0
          ? "생존한 아군 지휘관만 장착할 수 있습니다."
          : (item.useEffect === "class-reset" ? "룬스톤은 성장·전직 화면에서 사용합니다." : item.unavailableReason ??
            (item.allowedUnitTypes &&
            !item.allowedUnitTypes.includes(unit.unitType)
              ? "이 병종의 지휘관은 장착할 수 없습니다."
              : equipped
                ? "이미 장착한 장비입니다."
                : available < 1
                  ? "남는 소유 장비가 없습니다."
                  : null));
      return { item, owned, available, equipped, reason };
    });
}

/** Main evaluate validates command identity/version before routing here. */
export function evaluateEquip(
  content: Content,
  state: BattleState,
  command: EquipCommand,
): Evaluation {
  const reject = (error: string): Evaluation => ({ ok: false, error });
  if (!canPrepare(state))
    return reject("장비 변경은 첫 전투 행동 전 준비 중에만 가능합니다.");
  const unit = state.units.find((candidate) => candidate.id === command.unitId);
  if (
    !unit ||
    unit.hp <= 0 ||
    unit.kind !== "commander" ||
    unit.side !== "player"
  )
    return reject("생존한 아군 지휘관만 장비를 바꿀 수 있습니다.");
  if (command.slot !== "weapon" && command.slot !== "armor")
    return reject("올바른 장비 슬롯을 선택하세요.");
  if (command.itemId !== null) {
    const option = equipmentOptions(content, state, unit, command.slot).find(
      (value) => value.item.id === command.itemId,
    );
    if (!option) return reject("해당 슬롯에 장착할 수 없는 아이템입니다.");
    if (option.reason) return reject(option.reason);
  } else if (!unit.equipment?.[command.slot])
    return reject("해제할 장비가 없습니다.");
  const nextState = structuredClone(state);
  const actor = nextState.units.find((candidate) => candidate.id === unit.id)!;
  const previousMaxMp = effectiveMaxMp(content, state, unit);
  actor.equipment = {
    weapon: null,
    armor: null,
    ...actor.equipment,
    [command.slot]: command.itemId,
  };
  const nextMaxMp = effectiveMaxMp(content, nextState, actor);
  // Preserve the filled proportion, rounding down. Repeated swaps never refill MP.
  actor.mp =
    previousMaxMp > 0
      ? Math.min(nextMaxMp, Math.floor((actor.mp * nextMaxMp) / previousMaxMp))
      : 0;
  nextState.revision += 1;
  nextState.commands.push(structuredClone(command));
  return {
    ok: true,
    nextState,
    events: [
      {
        type: "equipmentChanged",
        unitId: actor.id,
        slot: command.slot,
        itemId: command.itemId,
      },
    ],
  };
}
