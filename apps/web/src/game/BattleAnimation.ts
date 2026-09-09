import type { BattleState, BattleEvent, Command } from "@orden/core";
export interface BattleAnimation {
  id: number;
  before: BattleState;
  command: Command;
  events: BattleEvent[];
  moveMs: number;
  impactMs: number;
}
