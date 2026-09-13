import type { Content, Position, Unit, StatusEffect } from "@orden/schema";
export type { Content, Position, Unit } from "@orden/schema";

export interface ExperienceContribution {
  damage: number;
  kills: number;
  retreats: number;
  healing: number;
  clear: number;
}
export type StatGains = Partial<
  Pick<Unit["stats"], "at" | "df" | "mag" | "res" | "maxMp">
>;
export interface ExperienceSettlement {
  scenarioId: string;
  outcome: "victory" | "defeat";
  duplicate: boolean;
  entries: {
    unitId: string;
    earned: ExperienceContribution;
    awardedExp: number;
    previousLevel: number;
    level: number;
    previousExp: number;
    exp: number;
    learnedSpellIds: string[];
    statGains: StatGains;
  }[];
}
export interface BattleProgression {
  roster: Unit[];
  contributions: Record<string, ExperienceContribution>;
  damageAwarded: Record<string, number>;
  healingAwarded: Record<string, number>;
  defeated: string[];
  lastDamageOwner: Record<string, string>;
  rewardedScenarioIds: string[];
  battleStartRevision: number;
  settlement: ExperienceSettlement | null;
}
export interface BattleState {
  mode: "practice" | "operation";
  operation: OperationState | null;
  rulesVersion: string;
  revision: number;
  round: number;
  activeSide: Unit["side"];
  units: Unit[];
  commands: Command[];
  statuses: StatusEffect[];
  terrainChanges: Record<string, string>;
  inventory: Record<string, number>;
  rngSeed: number;
  progression: BattleProgression;
  mission: {
    capturedRound: number | null;
    reinforcement: "scheduled" | "deferred" | "spawned" | "cancelled";
  };
  outcome: {
    status: "victory" | "defeat";
    reason: string;
    round: number;
    bonuses: string[];
  } | null;
}
export interface SurvivorContract {
  commanderId: string;
  templateId: string;
  count: number;
}
export interface OperationResources {
  equipmentFunds: number;
  operationBudget: number;
  pendingSupport: number;
  contracts: SurvivorContract[];
  hires: Record<string, string | null>;
}
export interface OperationCheckpoint extends OperationResources {
  roster: Unit[];
  inventory: Record<string, number>;
}
export interface OperationState extends OperationResources {
  phase: "preparation" | "battle";
  checkpoint: OperationCheckpoint;
  settlement: null | {
    firstClear: boolean;
    equipmentFunds: number;
    support: number;
    items: Record<string, number>;
    contracts: SurvivorContract[];
    operationSpent: number;
  };
}
export type Action =
  | { type: "wait" }
  | { type: "attack"; targetId: string }
  | { type: "heal"; targetId: string }
  | { type: "cast"; spellId: string; target: Position; destination?: Position }
  | { type: "treat" };
export interface ActCommand {
  type: "act";
  commandId: string;
  expectedRevision: number;
  unitId: string;
  /** Entered tiles, excluding origin. Empty path means stay in place. */
  path: Position[];
  action: Action;
}
export interface EndPhaseCommand {
  type: "endPhase";
  commandId: string;
  expectedRevision: number;
  side: Unit["side"];
}
export interface EquipCommand {
  type: "equip";
  commandId: string;
  expectedRevision: number;
  unitId: string;
  slot: "weapon" | "armor";
  itemId: string | null;
}
export interface TrainCommand {
  type: "train";
  commandId: string;
  expectedRevision: number;
  unitId: string;
  spellIds: string[];
}
export interface PromoteCommand {
  type: "promote";
  commandId: string;
  expectedRevision: number;
  unitId: string;
  classId: string;
}
export interface ReclassCommand {
  type: "reclass";
  commandId: string;
  expectedRevision: number;
  unitId: string;
}
export interface DeployCommand {
  type: "deploy";
  commandId: string;
  expectedRevision: number;
}
export interface MasteryCommand {
  type: "mastery";
  commandId: string;
  expectedRevision: number;
  unitId: string;
  masteryId: string | null;
}
export interface HireCommand {
  type: "hire";
  commandId: string;
  expectedRevision: number;
  unitId: string;
  templateId: string | null;
}
export type TradeCommand = {
  commandId: string;
  expectedRevision: number;
  itemId: string;
  quantity: number;
} & ({ type: "buy" } | { type: "sell" });
export interface StartBattleCommand {
  type: "startBattle";
  commandId: string;
  expectedRevision: number;
}
export type Command =
  | ActCommand
  | EndPhaseCommand
  | EquipCommand
  | TrainCommand
  | PromoteCommand
  | ReclassCommand
  | DeployCommand
  | MasteryCommand
  | HireCommand
  | TradeCommand
  | StartBattleCommand;
export type BattleEvent =
  | { type: "moved"; unitId: string; to: Position }
  | { type: "damaged"; unitId: string; amount: number }
  | { type: "healed"; unitId: string; amount: number }
  | {
      type: "spellCast";
      unitId: string;
      spellId: string;
      center: Position;
      affectedIds: string[];
    }
  | { type: "removed"; unitId: string; reason: "defeated" | "retreated" }
  | { type: "acted"; unitId: string }
  | { type: "phaseStarted"; side: Unit["side"]; round: number }
  | {
      type: "statusApplied";
      unitId: string;
      status: StatusEffect["status"];
      power: number;
      success: boolean;
      chance: number;
    }
  | { type: "statusExpired"; unitId: string; status: StatusEffect["status"] }
  | { type: "teleported"; unitId: string; from: Position; to: Position }
  | { type: "summoned"; unitId: string; ownerId: string; templateId: string }
  | { type: "refreshed"; unitId: string }
  | { type: "terrainChanged"; pos: Position; terrainId: string }
  | {
      type: "equipmentChanged";
      unitId: string;
      slot: "weapon" | "armor";
      itemId: string | null;
    }
  | { type: "experienceGained"; unitId: string; amount: number }
  | { type: "levelUp"; unitId: string; from: number; to: number }
  | { type: "spellLearned"; unitId: string; spellId: string }
  | {
      type: "classChanged";
      unitId: string;
      from: string;
      to: string;
      reset: boolean;
    }
  | { type: "battleDeployed"; scenarioId: string }
  | { type: "masteryChanged"; unitId: string; masteryId: string | null }
  | { type: "hired"; unitId: string; templateId: string | null }
  | {
      type: "traded";
      itemId: string;
      quantity: number;
      total: number;
      trade: "buy" | "sell";
    }
  | { type: "battleStarted"; operationSpent: number }
  | {
      type: "operationRewarded";
      equipmentFunds: number;
      support: number;
      items: Record<string, number>;
    }
  | { type: "scenario"; message: string };
export type Evaluation =
  | { ok: false; error: string }
  | { ok: true; nextState: BattleState; events: BattleEvent[] };

export function createBattle(
  content: Content,
  mode: BattleState["mode"] = "practice",
): BattleState {
  const preparation = content.scenario.preparation;
  if (mode === "operation" && !preparation)
    throw new Error("이 시나리오는 정식 작전 준비를 제공하지 않습니다.");
  const state: BattleState = {
    mode,
    operation: null,
    rulesVersion: content.rulesVersion,
    revision: 0,
    round: 1,
    activeSide: "player",
    units: structuredClone(content.scenario.units),
    commands: [],
    statuses: [],
    terrainChanges: {},
    inventory: structuredClone(content.scenario.inventory ?? {}),
    rngSeed: content.scenario.seed ?? 1,
    progression: {
      roster: structuredClone(
        content.scenario.units.filter(
          (unit) =>
            unit.side === "player" && unit.kind === "commander" && !unit.summon,
        ),
      ),
      contributions: {},
      damageAwarded: {},
      healingAwarded: {},
      defeated: [],
      lastDamageOwner: {},
      rewardedScenarioIds: [],
      battleStartRevision: 0,
      settlement: null,
    },
    mission: { capturedRound: null, reinforcement: "scheduled" },
    outcome: null,
  };
  if (mode === "operation" && preparation) {
    state.inventory = structuredClone(preparation.inventory);
    const resources: OperationResources = {
      equipmentFunds: preparation.equipmentFunds,
      operationBudget: preparation.operationBudget,
      pendingSupport: 0,
      contracts: [],
      hires: Object.fromEntries(
        preparation.slots.map((slot) => [slot.unitId, slot.templateId]),
      ),
    };
    state.operation = {
      ...resources,
      phase: "preparation",
      settlement: null,
      checkpoint: {
        ...structuredClone(resources),
        roster: structuredClone(state.progression.roster),
        inventory: structuredClone(state.inventory),
      },
    };
  }
  return state;
}
