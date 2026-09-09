import { content } from "@orden/content";
import { escortForecast, type BattleState } from "@orden/core";

export function MissionPanel({ state }: { state: BattleState }) {
  const mission = content.scenario.mission;
  if (!mission) return null;
  const escort = state.units.find((u) => u.id === mission.escortId);
  const forecast = escortForecast(content, state);
  const wave = state.mission.reinforcement;
  const reinforcement =
    wave === "cancelled"
      ? "봉화 차단 · 증원 취소"
      : wave === "spawned"
        ? "비병 증원 등장"
        : wave === "deferred"
          ? "증원 보류 · 다음 라운드 종료 재시도"
          : `${content.scenario.reinforcement.round}라운드 종료 비병 증원 예정`;
  return (
    <aside className="mission-panel classic-window" aria-label="작전 목표">
      <strong>{mission.maxRounds}라운드 내 호송대 탈출 · 카이엘 생존</strong>
      <p data-testid="escort-status">
        호송 HP {escort?.hp ?? 0} · 현재 ({escort?.pos.x ?? "—"},{" "}
        {escort?.pos.y ?? "—"})
        {!state.outcome && forecast
          ? ` → 다음 (${forecast.to.x}, ${forecast.to.y})`
          : ""}
      </p>
      {!state.outcome && forecast?.reason && (
        <p className="blocked-route">{forecast.reason}</p>
      )}
      <p data-testid="reinforcement-status">
        {reinforcement} ·{" "}
        {state.mission.capturedRound === null
          ? `봉화 보너스 ${mission.bonusDeadline}라운드까지`
          : `봉화 ${state.mission.capturedRound}라운드 점령`}
      </p>
      {state.round >= 8 && !state.outcome && (
        <p className="blocked-route">
          남은 라운드 {mission.maxRounds - state.round + 1} · 호송로를
          비우십시오.
        </p>
      )}
    </aside>
  );
}

export function BattleResult({
  state,
  restart,
}: {
  state: BattleState;
  restart: () => void;
}) {
  const result = state.outcome;
  if (!result) return null;
  return (
    <div className="modal-scrim">
      <section
        className="classic-window confirm-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-title"
      >
        <h2 id="result-title">
          {result.status === "victory" ? "작전 성공" : "작전 실패"}
        </h2>
        <p>{result.reason}</p>
        <p>
          {result.round}라운드 · 생존 아군{" "}
          {state.units.filter((u) => u.side === "player").length}기
        </p>
        {result.status === "victory" && (
          <p>
            보너스:{" "}
            {result.bonuses.length ? result.bonuses.join(" · ") : "없음"}
            <br />
            이번 검증판에서는 달성 기록만 표시합니다.
          </p>
        )}
        <div>
          <button autoFocus onClick={restart}>
            다시 도전
          </button>
        </div>
      </section>
    </div>
  );
}
