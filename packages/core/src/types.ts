import type { Content, Position, Unit } from "@orden/schema";
export type { Content, Position, Unit } from "@orden/schema";

export interface BattleState {
  rulesVersion: string;
  revision: number;
  activeSide: "player" | "enemy";
  units: Unit[];
  commands: ActCommand[];
}
export type Action =
  | { type: "wait" }
  | { type: "attack"; targetId: string }
  | { type: "heal"; targetId: string }
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
export type BattleEvent =
  | { type: "moved"; unitId: string; to: Position }
  | { type: "damaged"; unitId: string; amount: number }
  | { type: "healed"; unitId: string; amount: number }
  | { type: "removed"; unitId: string; reason: "defeated" | "retreated" }
  | { type: "acted"; unitId: string };
export type Evaluation =
  | { ok: false; error: string }
  | { ok: true; nextState: BattleState; events: BattleEvent[] };

export function createBattle(content: Content): BattleState {
  return {
    rulesVersion: content.rulesVersion,
    revision: 0,
    activeSide: "player",
    units: structuredClone(content.scenario.units),
    commands: [],
  };
}
