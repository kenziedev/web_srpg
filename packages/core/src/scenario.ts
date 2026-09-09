import type {
  BattleState,
  BattleEvent,
  Content,
  Position,
  Unit,
} from "./types";
import { allied, samePosition, stepCost, canStop } from "./movement";

/** Shared by NPC execution and UI forecast; fixed route, no tactical rerouting. */
export function escortForecast(
  content: Content,
  state: BattleState,
): {
  to: Position;
  path: Position[];
  blockedBy: string | null;
  reason: string | null;
} | null {
  const mission = content.scenario.mission;
  const escort = state.units.find((u) => u.id === mission?.escortId);
  if (!mission || !escort) return null;
  const start = mission.route.findIndex((p) => samePosition(p, escort.pos));
  const result = {
    to: { ...escort.pos },
    path: [] as Position[],
    blockedBy: null as string | null,
    reason: null as string | null,
  };
  if (start < 0) return { ...result, reason: "호송 경로를 벗어났습니다." };
  let cost = 0;
  const traversed: Position[] = [];
  for (const pos of mission.route.slice(start + 1)) {
    const occupant = state.units.find(
      (u) => u.id !== escort.id && samePosition(u.pos, pos),
    );
    if (occupant && !allied(escort.side, occupant.side)) {
      result.blockedBy = occupant.id;
      result.reason = `적 ${occupant.name}(${occupant.id})이 진로를 막고 있습니다.`;
      break;
    }
    const step = stepCost(content, state, escort, pos);
    if (step === null) {
      result.reason = "통행할 수 없는 지형입니다.";
      break;
    }
    if (cost + step > escort.stats.move) break;
    cost += step;
    traversed.push(pos);
    if (canStop(content, state, escort, pos)) {
      result.to = { ...pos };
      result.path = traversed.map((p) => ({ ...p }));
      result.blockedBy = null;
      result.reason = null;
    } else if (occupant) {
      result.blockedBy = occupant.id;
      result.reason = `${occupant.name}(${occupant.id})이 도착 칸을 점유하고 있습니다.`;
    }
  }
  return result;
}

/** Mutates only a reducer-owned clone; immediate defeat always precedes escape. */
export function resolveOutcome(
  content: Content,
  state: BattleState,
  events: BattleEvent[],
  roundEnd = false,
) {
  const m = content.scenario.mission;
  if (!m || state.outcome) return;
  const missing = m.protectedIds.find(
    (id) => !state.units.some((u) => u.id === id && u.hp > 0),
  );
  const escort = state.units.find((u) => u.id === m.escortId);
  let status: "victory" | "defeat" | null = null;
  let reason = "";
  if (missing) {
    status = "defeat";
    reason = `${content.scenario.units.find((u) => u.id === missing)?.name ?? missing} 전투불능`;
  } else if (escort && samePosition(escort.pos, m.route[m.route.length - 1]!)) {
    status = "victory";
    reason = "호송대가 탈출했습니다.";
  } else if (roundEnd && state.round >= m.maxRounds) {
    status = "defeat";
    reason = `${m.maxRounds}라운드 내 호송 실패`;
  }
  if (status) {
    const bonuses: string[] = [];
    if (status === "victory") {
      if (
        state.mission.capturedRound !== null &&
        state.mission.capturedRound <= m.bonusDeadline
      )
        bonuses.push("봉화 조기 점령");
      if (escort && escort.hp >= m.healthyEscapeHp)
        bonuses.push("호송대 안전 탈출");
    }
    state.outcome = { status, reason, round: state.round, bonuses };
    events.push({
      type: "scenario",
      message: `${status === "victory" ? "승리" : "패배"}: ${reason}`,
    });
  }
}

export function moveEscort(
  content: Content,
  state: BattleState,
  events: BattleEvent[],
) {
  if (state.outcome) return;
  const forecast = escortForecast(content, state);
  const escort = state.units.find(
    (u) => u.id === content.scenario.mission?.escortId,
  );
  if (!forecast || !escort) return;
  if (!samePosition(escort.pos, forecast.to)) {
    escort.pos = forecast.to;
    events.push({ type: "moved", unitId: escort.id, to: forecast.to });
  }
  escort.acted = true;
  events.push({
    type: "scenario",
    message: `${escort.name} → (${escort.pos.x}, ${escort.pos.y})${forecast.reason ? ` · ${forecast.reason}` : ""}`,
  });
  resolveOutcome(content, state, events);
}

export function finishRound(
  content: Content,
  state: BattleState,
  events: BattleEvent[],
) {
  const m = content.scenario.mission;
  if (!m || state.outcome) return;
  if (
    state.mission.capturedRound === null &&
    state.units.some(
      (u) =>
        u.side === "player" &&
        u.kind === "commander" &&
        u.hp > 0 &&
        samePosition(u.pos, m.beacon),
    )
  ) {
    state.mission.capturedRound = state.round;
    events.push({ type: "scenario", message: "북쪽 봉화를 점령했습니다." });
  }
  resolveOutcome(content, state, events, true);
  if (state.outcome) return;
  if (
    state.mission.reinforcement === "spawned" ||
    state.mission.reinforcement === "cancelled"
  )
    return;
  if (state.mission.capturedRound !== null) {
    state.mission.reinforcement = "cancelled";
    events.push({
      type: "scenario",
      message: "봉화 차단으로 비병 증원이 취소되었습니다.",
    });
    return;
  }
  const wave = content.scenario.reinforcement;
  if (state.round < wave.round) return;
  const placements: Unit[] = [];
  // Backtracking avoids a greedy primary slot preventing a valid full-squad placement.
  const place = (index: number): boolean => {
    if (index === wave.units.length) return true;
    const unit = wave.units[index]!;
    for (const pos of [unit.pos, ...(wave.reserves[unit.id] ?? [])]) {
      if (
        !canStop(
          content,
          { ...state, units: [...state.units, ...placements] },
          unit,
          pos,
        ) ||
        stepCost(content, state, unit, pos) === null
      )
        continue;
      placements.push({
        ...structuredClone(unit),
        pos: { ...pos },
        acted: true,
      });
      if (place(index + 1)) return true;
      placements.pop();
    }
    return false;
  };
  if (state.units.length + wave.units.length > m.unitLimit || !place(0)) {
    state.mission.reinforcement = "deferred";
    events.push({
      type: "scenario",
      message: "비병 증원 배치 공간 부족: 다음 라운드 종료로 보류",
    });
    return;
  }
  state.units.push(...placements);
  state.mission.reinforcement = "spawned";
  events.push({
    type: "scenario",
    message: "비병 증원 등장: 다음 적군 턴부터 행동합니다.",
  });
}
