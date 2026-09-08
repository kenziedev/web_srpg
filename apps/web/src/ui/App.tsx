import { useEffect, useState } from "react";
import { content } from "@orden/content";
import { commandBonus, terrainAt } from "@orden/core";
import { BattleMap } from "../game/BattleMap";
import { useBattle } from "./useBattle";

const names: Record<string, string> = {
  infantry: "보병",
  pike: "창병",
  cavalry: "기병",
  archer: "궁병",
  flier: "비병",
  neutral: "호송대",
};

export function App() {
  const battle = useBattle();
  const { state, unit, busy, canAct, destination, preview } = battle;
  const [showCommand, setShowCommand] = useState(true);
  const [showRoster, setShowRoster] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const bonus = unit ? commandBonus(state, unit) : null;
  const terrain = unit ? terrainAt(content, destination ?? unit.pos) : null;
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest("input, textarea, select"))
        return;
      if (event.key === "Escape") {
        battle.cancel();
        battle.setConfirmEnd(false);
        setShowRoster(false);
        setShowInfo(false);
      }
      if (battle.confirmEnd || showInfo || showRoster) return;
      if (event.key.toLowerCase() === "c") setShowCommand((v) => !v);
      if (event.key.toLowerCase() === "e" && !showInfo && !showRoster)
        battle.requestEnd();
      if (event.key.toLowerCase() === "n") battle.nextUnit();
      if (
        event.key === "Enter" &&
        !(event.target as HTMLElement).closest("button") &&
        !battle.confirmEnd &&
        !showInfo &&
        !showRoster
      )
        battle.commit();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  return (
    <main className="game-shell">
      <header className="system-bar">
        <h1>
          오르덴 연대기 <span>― 두 개의 건널목 ―</span>
        </h1>
        <nav>
          <button onClick={() => setShowInfo(true)}>안내</button>
          <button
            onClick={() => {
              setShowRoster((v) => !v);
              battle.cancel();
            }}
            disabled={busy}
          >
            부대 목록
          </button>
          <button onClick={battle.reset}>연습 초기화</button>
        </nav>
      </header>
      <section
        className="battlefield"
        aria-label="전술 지도와 명령"
        onContextMenu={(event) => {
          event.preventDefault();
          battle.cancel();
        }}
      >
        <BattleMap
          state={state}
          selectedId={busy ? (battle.enemyActor ?? "") : battle.selectedId}
          destination={destination}
          reachable={battle.moves}
          showCommand={showCommand && !busy}
          onTile={battle.onTile}
        />
        <div
          className={`turn-window classic-window ${busy ? "enemy-turn" : ""}`}
          aria-live="polite"
        >
          <span>
            TURN{" "}
            <strong data-testid="round">
              {String(state.round).padStart(2, "0")}
            </strong>
          </span>
          <b data-testid="phase">
            {state.activeSide === "player"
              ? "아군 턴"
              : state.activeSide === "enemy"
                ? "적군 턴"
                : "중립 페이즈"}
          </b>
        </div>
        <div className="command-window classic-window" aria-label="전투 명령">
          <div className="window-caption">COMMAND</div>
          <button disabled={!canAct} onClick={() => battle.prepare("wait")}>
            대기
          </button>
          <button
            disabled={!canAct || unit?.kind !== "commander"}
            onClick={() => battle.prepare("treat")}
          >
            정비
          </button>
          <button
            disabled={!canAct || !unit?.canHeal || unit.mp < 3}
            onClick={() => battle.prepare("heal")}
          >
            회복
          </button>
          <div className="menu-separator" />
          <button
            onClick={battle.nextUnit}
            disabled={busy || !battle.remaining}
          >
            다음 부대 <kbd>N</kbd>
          </button>
          <button
            aria-pressed={showCommand}
            onClick={() => setShowCommand((v) => !v)}
          >
            지휘 범위 <small>{showCommand ? "ON" : "OFF"}</small>
          </button>
          <button
            className="end-turn"
            onClick={battle.requestEnd}
            disabled={busy}
          >
            턴 종료 <kbd>E</kbd>
          </button>
          <label className="speed-option">
            <input
              type="checkbox"
              checked={battle.fast}
              onChange={(e) => battle.setFast(e.target.checked)}
            />{" "}
            빠른 진행
          </label>
        </div>
        {busy && (
          <div className="phase-banner" aria-hidden="true">
            {state.activeSide === "enemy" ? "ENEMY PHASE" : "NEXT TURN"}
          </div>
        )}
        {showRoster && (
          <section
            className="roster-window classic-window"
            role="dialog"
            aria-label="부대 목록"
          >
            <div className="window-caption">
              출격 부대{" "}
              <button
                onClick={() => setShowRoster(false)}
                aria-label="부대 목록 닫기"
              >
                ×
              </button>
            </div>
            {content.scenario.units
              .filter((u) => u.side === "player" && u.kind === "commander")
              .map((leader) => (
                <div className="squad" key={leader.id}>
                  <button
                    className={
                      battle.selectedId === leader.id
                        ? "selected squad-leader"
                        : "squad-leader"
                    }
                    disabled={!state.units.some((u) => u.id === leader.id)}
                    aria-label={`${leader.name} 선택`}
                    onClick={() => {
                      battle.select(leader.id);
                      setShowRoster(false);
                    }}
                  >
                    <b>{leader.name}</b>
                    <small>
                      {state.units.find((u) => u.id === leader.id)?.acted
                        ? "행동 완료"
                        : "지휘관"}
                    </small>
                  </button>
                  <div className="soldiers">
                    {state.units
                      .filter((u) => u.commanderId === leader.id)
                      .map((u) => (
                        <button
                          key={u.id}
                          aria-label={`${u.id} ${u.name} 선택`}
                          onClick={() => {
                            battle.select(u.id);
                            setShowRoster(false);
                          }}
                        >
                          {names[u.unitType]}{" "}
                          <span>{u.acted ? "✓" : u.hp}</span>
                        </button>
                      ))}
                  </div>
                </div>
              ))}
          </section>
        )}
      </section>
      <section className="bottom-hud classic-window">
        <div className="unit-summary">
          <div className={`portrait ${unit?.side ?? ""}`} aria-hidden="true">
            <span className="portrait-head" />
            <span className="portrait-body" />
            <span className="portrait-shield" />
          </div>
          <div>
            <div className="unit-name">
              <h2>{unit?.name ?? "부대 선택"}</h2>
              <small>
                {unit ? (names[unit.unitType] ?? unit.unitType) : ""}
              </small>
              {unit?.acted && <em data-testid="acted">행동 완료</em>}
            </div>
            <div className="stats-line">
              <span>
                AT{" "}
                <b>
                  {unit?.stats.at ?? "―"}
                  {bonus?.active && <i>+{bonus.at}</i>}
                </b>
              </span>
              <span>
                DF{" "}
                <b>
                  {unit?.stats.df ?? "―"}
                  {bonus?.active && <i>+{bonus.df}</i>}
                </b>
              </span>
              <span>
                MV <b>{unit?.stats.move ?? "―"}</b>
              </span>
              <span className="health-line">
                HP <strong>{unit?.hp ?? "―"}</strong>
              </span>
              <span>
                MP <b>{unit?.mp ?? "―"}</b>
              </span>
            </div>
            <div className="terrain-line">
              {terrain?.name ?? "―"}　지형 DF +
              {unit?.moveType === "flying" ? 0 : (terrain?.defense ?? 0)}　
              {unit?.command
                ? `지휘 ${unit.command.radius}`
                : bonus?.active
                  ? "지휘 범위 안"
                  : "지휘 보정 없음"}
            </div>
          </div>
        </div>
        <div className="order-panel">
          <p role="status">
            {busy
              ? battle.message
              : preview && !preview.ok
                ? preview.error
                : destination
                  ? `${unit?.name} → (${destination.x}, ${destination.y})`
                  : battle.message}
          </p>
          {preview?.ok && (
            <div className="prediction" data-testid="prediction">
              {preview.events
                .filter(
                  (e) =>
                    e.type === "damaged" ||
                    e.type === "healed" ||
                    e.type === "removed",
                )
                .map((e, i) => (
                  <span key={i}>
                    {state.units.find((u) => u.id === e.unitId)?.name}{" "}
                    {e.type === "removed"
                      ? e.reason === "retreated"
                        ? "부대 퇴각"
                        : "전투불능"
                      : `${e.type === "damaged" ? "−" : "+"}${e.amount} HP`}
                  </span>
                ))}
            </div>
          )}
          <div className="order-buttons">
            <button disabled={!destination || busy} onClick={battle.cancel}>
              취소 <kbd>Esc</kbd>
            </button>
            <button disabled={!preview?.ok || busy} onClick={battle.commit}>
              행동 확정 <kbd>↵</kbd>
            </button>
            <small>미행동 {battle.remaining}기</small>
          </div>
        </div>
      </section>
      <div className="key-guide">
        <span>
          부대 → 이동 위치 → 적 선택 → 확정　│　드래그: 지도 이동　우클릭: 취소
        </span>
        <span>전투 연습판 · 적 자동 행동 / 저장 없음</span>
      </div>
      {battle.confirmEnd && (
        <div className="modal-scrim">
          <section
            className="classic-window confirm-window"
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-title"
          >
            <h2 id="end-title">아군 턴을 종료합니까?</h2>
            <p>아직 행동하지 않은 부대가 {battle.remaining}기 있습니다.</p>
            <p>남은 행동을 포기하고 적군 턴으로 넘어갑니다.</p>
            <div>
              <button autoFocus onClick={() => battle.setConfirmEnd(false)}>
                계속 조작
              </button>
              <button onClick={battle.finishTurn}>턴 종료 확인</button>
            </div>
          </section>
        </div>
      )}
      {showInfo && (
        <div className="modal-scrim">
          <section
            className="classic-window info-window"
            role="dialog"
            aria-modal="true"
            aria-label="전투 안내"
          >
            <h2>전투 연습 안내</h2>
            <p>
              턴 종료 → 적군 이동·공격 → 다음 아군 턴 순서로 진행됩니다. 아군 턴
              시작에 지휘관과 인접한 소속 용병은 HP 3, 거점 위 지상 유닛은 HP
              2를 회복합니다. 두 회복은 중첩되지 않습니다.
            </p>
            <p>
              현재는 부대 전투 연습판입니다. 호송대 이동·봉화 점령·증원·시나리오
              승패는 다음 개발 단계이며, 새로고침하면 초기화됩니다.
            </p>
            <details>
              <summary>최근 전투 기록</summary>
              <ol>
                {battle.history.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            </details>
            <button autoFocus onClick={() => setShowInfo(false)}>
              닫기
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
