import type {
  BattleEvent,
  BattleState,
  Content,
  Evaluation,
  HireCommand,
  OperationCheckpoint,
  StartBattleCommand,
  SurvivorContract,
  TradeCommand,
  Unit,
} from "./types";
import { canPrepare } from "./equipment";
import { canStop } from "./movement";

type Template = Content["mercenaryTemplates"][number];
const moneyLimit = 1_000_000_000;
const inventoryLimit = 9999;

function preparationReason(state: BattleState): string | null {
  if (state.mode !== "operation" || !state.operation)
    return "정식 작전에서만 사용할 수 있습니다.";
  if (!canPrepare(state)) return "작전 준비 중에만 변경할 수 있습니다.";
  return null;
}
function allowedTemplates(
  content: Content,
  state: BattleState,
  commanderId: string,
): string[] {
  const commander =
    state.units.find((unit) => unit.id === commanderId) ??
    state.progression.roster.find((unit) => unit.id === commanderId);
  return (
    content.classes.find(
      (entry) => entry.id === commander?.progression?.classId,
    )?.hireTemplateIds ?? []
  );
}
function hiringQuote(
  content: Content,
  state: BattleState,
  hires = state.operation?.hires ?? {},
) {
  const spentDiscount = new Map<string, number>();
  return (content.scenario.preparation?.slots ?? []).map((slot) => {
    const templateId = hires[slot.unitId] ?? null;
    const template = content.mercenaryTemplates.find(
      (entry) => entry.id === templateId,
    );
    const pair = `${slot.commanderId}/${templateId}`;
    const contract = state.operation?.contracts.find(
      (entry) =>
        entry.commanderId === slot.commanderId &&
        entry.templateId === templateId,
    );
    const used = spentDiscount.get(pair) ?? 0;
    const discounted =
      !!template &&
      allowedTemplates(content, state, slot.commanderId).includes(
        template.id,
      ) &&
      used < (contract?.count ?? 0);
    if (discounted) spentDiscount.set(pair, used + 1);
    const cost = template
      ? discounted
        ? Math.floor((template.cost * 80) / 100)
        : template.cost
      : 0;
    return {
      unitId: slot.unitId,
      commanderId: slot.commanderId,
      name:
        content.scenario.units.find((unit) => unit.id === slot.unitId)?.name ??
        slot.unitId,
      templateId,
      template,
      cost,
      discounted,
    };
  });
}
export function operationSummary(content: Content, state: BattleState) {
  if (!state.operation) return null;
  const slots = hiringQuote(content, state);
  const spent = slots.reduce((sum, slot) => sum + slot.cost, 0);
  let startReason = preparationReason(state);
  if (!startReason && spent > state.operation.operationBudget)
    startReason = "작전비가 부족합니다.";
  if (
    !startReason &&
    slots.some(
      (slot) =>
        slot.templateId &&
        (!slot.template ||
          !allowedTemplates(content, state, slot.commanderId).includes(
            slot.templateId,
          )),
    )
  )
    startReason = "현재 직업에서 고용할 수 없는 용병을 교체하세요.";
  if (
    !startReason &&
    state.units.some((unit) => !canStop(content, state, unit, unit.pos))
  )
    startReason = "출격할 수 없는 배치가 있습니다.";
  return {
    phase: state.operation.phase,
    equipmentFunds: state.operation.equipmentFunds,
    budget: state.operation.operationBudget,
    spent,
    remaining: state.operation.operationBudget - spent,
    pendingSupport: state.operation.pendingSupport,
    contracts: state.operation.contracts,
    slots,
    startReason,
    settlement: state.operation.settlement,
  };
}
export interface HireOption {
  template: Template;
  selected: boolean;
  cost: number;
  totalCost: number;
  remaining: number;
  discounted: boolean;
  reason: string | null;
}
export function hireOptions(
  content: Content,
  state: BattleState,
  unitId: string,
): HireOption[] {
  const slot = content.scenario.preparation?.slots.find(
    (entry) => entry.unitId === unitId,
  );
  if (!slot || !state.operation) return [];
  return content.mercenaryTemplates.map((template) => {
    const hires = { ...state.operation!.hires, [unitId]: template.id };
    const quote = hiringQuote(content, state, hires);
    const cost = quote.find((entry) => entry.unitId === unitId)!;
    const totalCost = quote.reduce((sum, entry) => sum + entry.cost, 0);
    const selected = state.operation!.hires[unitId] === template.id;
    const reason =
      preparationReason(state) ??
      (!allowedTemplates(content, state, slot.commanderId).includes(template.id)
        ? "현재 직업에서 고용할 수 없는 병종입니다."
        : selected
          ? "현재 편성된 용병입니다."
          : totalCost > state.operation!.operationBudget
            ? "작전비가 부족합니다."
            : null);
    return {
      template,
      selected,
      cost: cost.cost,
      discounted: cost.discounted,
      totalCost,
      remaining: state.operation!.operationBudget - totalCost,
      reason,
    };
  });
}
function hiredUnit(
  content: Content,
  unitId: string,
  templateId: string,
): Unit | null {
  const initial = content.scenario.units.find((unit) => unit.id === unitId);
  const template = content.mercenaryTemplates.find(
    (entry) => entry.id === templateId,
  );
  if (!initial || !template) return null;
  return {
    ...structuredClone(initial),
    name:
      initial.unitType === template.unitType
        ? initial.name
        : `${template.name} (${unitId})`,
    unitType: template.unitType,
    moveType: template.moveType,
    stats: structuredClone(template.stats),
    range: [...template.range],
    hp: 10,
    mp: 0,
    acted: false,
    spellIds: [],
    command: null,
  };
}
function committed(
  state: BattleState,
  command: HireCommand | TradeCommand | StartBattleCommand,
  events: BattleEvent[],
): Evaluation {
  state.revision += 1;
  state.commands.push(structuredClone(command));
  return { ok: true, nextState: state, events };
}
export function evaluateHire(
  content: Content,
  state: BattleState,
  command: HireCommand,
): Evaluation {
  const reason = preparationReason(state);
  if (reason) return { ok: false, error: reason };
  const slot = content.scenario.preparation?.slots.find(
    (entry) => entry.unitId === command.unitId,
  );
  if (!slot || !state.operation)
    return { ok: false, error: "고용 슬롯을 확인하세요." };
  if (command.templateId !== null) {
    const option = hireOptions(content, state, command.unitId).find(
      (entry) => entry.template.id === command.templateId,
    );
    if (!option) return { ok: false, error: "알 수 없는 용병입니다." };
    if (option.reason) return { ok: false, error: option.reason };
  } else if (!state.operation.hires[command.unitId])
    return { ok: false, error: "비어 있는 고용 슬롯입니다." };
  const next = structuredClone(state);
  const index = next.units.findIndex((unit) => unit.id === command.unitId);
  const replacement = command.templateId
    ? hiredUnit(content, command.unitId, command.templateId)
    : null;
  if (replacement) {
    if (index >= 0) replacement.pos = { ...next.units[index]!.pos };
    if (!canStop(content, next, replacement, replacement.pos))
      return { ok: false, error: "새 용병이 현재 배치 칸에 설 수 없습니다." };
    if (index >= 0) next.units[index] = replacement;
    else next.units.push(replacement);
  } else if (index >= 0) next.units.splice(index, 1);
  const order = new Map(
    content.scenario.units.map((unit, position) => [unit.id, position]),
  );
  next.units.sort(
    (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999),
  );
  next.operation!.hires[command.unitId] = command.templateId;
  return committed(next, command, [
    { type: "hired", unitId: command.unitId, templateId: command.templateId },
  ]);
}
export function shopOptions(content: Content, state: BattleState) {
  const commonReason = preparationReason(state);
  return (content.scenario.preparation?.shop ?? []).flatMap((offer) => {
    const item = content.items.find((entry) => entry.id === offer.itemId);
    if (!item) return [];
    const owned = state.inventory[item.id] ?? 0;
    const worn = state.progression.roster.reduce(
      (sum, unit) =>
        sum +
        Object.values(unit.equipment ?? {}).filter((id) => id === item.id)
          .length,
      0,
    );
    const available = Math.max(0, owned - worn);
    return [
      {
        item,
        owned,
        available,
        buyPrice: offer.buyPrice,
        sellPrice: offer.sellPrice,
        buyReason:
          commonReason ??
          (owned >= inventoryLimit
            ? "소유 수량 상한입니다."
            : (state.operation?.equipmentFunds ?? 0) < offer.buyPrice
              ? "장비 자금이 부족합니다."
              : null),
        sellReason:
          commonReason ??
          (available < 1
            ? "판매할 미장착 아이템이 없습니다."
            : (state.operation?.equipmentFunds ?? 0) + offer.sellPrice >
                moneyLimit
              ? "장비 자금 상한입니다."
              : null),
      },
    ];
  });
}
export function evaluateTrade(
  content: Content,
  state: BattleState,
  command: TradeCommand,
): Evaluation {
  if (
    !Number.isSafeInteger(command.quantity) ||
    command.quantity < 1 ||
    command.quantity > inventoryLimit
  )
    return { ok: false, error: "구매·판매 수량은 1~9999의 정수여야 합니다." };
  const option = shopOptions(content, state).find(
    (entry) => entry.item.id === command.itemId,
  );
  if (!option)
    return { ok: false, error: "상점에서 거래할 수 없는 아이템입니다." };
  const reason = command.type === "buy" ? option.buyReason : option.sellReason;
  if (reason || !state.operation)
    return { ok: false, error: reason ?? "정식 작전 전용입니다." };
  const total =
    (command.type === "buy" ? option.buyPrice : option.sellPrice) *
    command.quantity;
  if (
    command.type === "buy" &&
    (total > state.operation.equipmentFunds ||
      option.owned + command.quantity > inventoryLimit)
  )
    return { ok: false, error: "장비 자금 또는 소유 수량 한도를 확인하세요." };
  if (
    command.type === "sell" &&
    (command.quantity > option.available ||
      state.operation.equipmentFunds + total > moneyLimit)
  )
    return {
      ok: false,
      error: "판매 가능한 미장착 수량 또는 자금 한도를 확인하세요.",
    };
  const next = structuredClone(state);
  next.operation!.equipmentFunds += command.type === "buy" ? -total : total;
  next.inventory[command.itemId] =
    option.owned +
    (command.type === "buy" ? command.quantity : -command.quantity);
  return committed(next, command, [
    {
      type: "traded",
      itemId: command.itemId,
      quantity: command.quantity,
      total,
      trade: command.type,
    },
  ]);
}
export function evaluateStartBattle(
  content: Content,
  state: BattleState,
  command: StartBattleCommand,
): Evaluation {
  const summary = operationSummary(content, state);
  if (!summary || summary.startReason)
    return {
      ok: false,
      error:
        summary?.startReason ?? "정식 작전에서만 출격을 확정할 수 있습니다.",
    };
  const next = structuredClone(state);
  next.operation!.phase = "battle";
  next.operation!.contracts = next.operation!.contracts.filter((contract) =>
    allowedTemplates(content, state, contract.commanderId).includes(
      contract.templateId,
    ),
  );
  return committed(next, command, [
    { type: "battleStarted", operationSpent: summary.spent },
  ]);
}
export function captureOperationCheckpoint(state: BattleState) {
  const op = state.operation;
  if (!op) return;
  op.checkpoint = {
    equipmentFunds: op.equipmentFunds,
    operationBudget: op.operationBudget,
    pendingSupport: op.pendingSupport,
    contracts: structuredClone(op.contracts),
    hires: { ...op.hires },
    roster: structuredClone(state.progression.roster),
    inventory: structuredClone(state.inventory),
  };
}
/** The checkpoint precedes shopping and recruitment, so a loss refunds the full preparation. */
export function restoreOperationPreparation(
  content: Content,
  before: BattleState,
  next: BattleState,
) {
  const previous = before.operation;
  if (!previous || !next.operation || !content.scenario.preparation) return;
  const checkpoint: OperationCheckpoint =
    before.outcome?.status === "defeat"
      ? previous.checkpoint
      : {
          equipmentFunds: previous.equipmentFunds,
          operationBudget:
            content.scenario.preparation.operationBudget +
            previous.pendingSupport,
          pendingSupport: 0,
          contracts: structuredClone(previous.settlement?.contracts ?? []),
          hires: { ...previous.hires },
          roster: structuredClone(before.progression.roster),
          inventory: structuredClone(before.inventory),
        };
  next.inventory = structuredClone(checkpoint.inventory);
  next.progression.roster = structuredClone(checkpoint.roster);
  const {
    roster: _roster,
    inventory: _inventory,
    ...resources
  } = structuredClone(checkpoint);
  next.operation = {
    ...resources,
    phase: "preparation",
    checkpoint: structuredClone(checkpoint),
    settlement: null,
  };
  for (const slot of content.scenario.preparation.slots)
    if (
      next.operation.hires[slot.unitId] &&
      !allowedTemplates(
        content,
        { ...next, units: next.progression.roster },
        slot.commanderId,
      ).includes(next.operation.hires[slot.unitId]!)
    )
      next.operation.hires[slot.unitId] = null;
}
/** Preserve the scenario's slot IDs and ordering so allegiance, AI and replay remain stable. */
export function materializeOperationHires(
  content: Content,
  state: BattleState,
) {
  if (!state.operation) return;
  const slots = new Set(
    (content.scenario.preparation?.slots ?? []).map((slot) => slot.unitId),
  );
  const commanders = state.units.filter((unit) => !slots.has(unit.id));
  const hired = (content.scenario.preparation?.slots ?? []).flatMap((slot) => {
    const templateId = state.operation!.hires[slot.unitId];
    const unit = templateId
      ? hiredUnit(content, slot.unitId, templateId)
      : null;
    return unit ? [unit] : [];
  });
  const index = new Map(
    content.scenario.units.map((unit, position) => [unit.id, position]),
  );
  state.units = [...commanders, ...hired].sort(
    (a, b) => (index.get(a.id) ?? 999) - (index.get(b.id) ?? 999),
  );
}
/** Called with the EXP settlement's eligibility before its once-per-scenario ledger is committed. */
export function settleOperation(
  content: Content,
  state: BattleState,
  events: BattleEvent[],
  firstClear: boolean,
) {
  const op = state.operation;
  const preparation = content.scenario.preparation;
  if (!op || !preparation || !state.outcome || op.settlement) return;
  firstClear = firstClear && state.outcome.status === "victory";
  const contracts: SurvivorContract[] = [];
  if (state.outcome.status === "victory") {
    for (const slot of preparation.slots) {
      const templateId = op.hires[slot.unitId];
      const survivor = state.units.find(
        (unit) =>
          unit.id === slot.unitId &&
          unit.hp > 0 &&
          unit.kind === "mercenary" &&
          unit.commanderId === slot.commanderId,
      );
      if (!templateId || !survivor) continue;
      const contract = contracts.find(
        (entry) =>
          entry.commanderId === slot.commanderId &&
          entry.templateId === templateId,
      );
      if (contract) contract.count += 1;
      else
        contracts.push({ commanderId: slot.commanderId, templateId, count: 1 });
    }
  }
  const equipmentFunds = firstClear
    ? Math.min(
        preparation.rewards.equipmentFunds,
        moneyLimit - op.equipmentFunds,
      )
    : 0;
  const support = firstClear
    ? Math.min(
        200,
        preparation.rewards.bonusSupport * state.outcome.bonuses.length,
      )
    : 0;
  const items: Record<string, number> = {};
  if (firstClear)
    for (const [id, amount] of Object.entries(preparation.rewards.items)) {
      const granted = Math.min(
        amount,
        inventoryLimit - (state.inventory[id] ?? 0),
      );
      if (granted > 0) {
        items[id] = granted;
        state.inventory[id] = (state.inventory[id] ?? 0) + granted;
      }
    }
  op.equipmentFunds += equipmentFunds;
  op.pendingSupport = support;
  op.settlement = {
    firstClear,
    equipmentFunds,
    support,
    items,
    contracts,
    operationSpent: hiringQuote(content, state).reduce(
      (sum, entry) => sum + entry.cost,
      0,
    ),
  };
  if (firstClear)
    events.push({ type: "operationRewarded", equipmentFunds, support, items });
}
