import { useEffect, useMemo, useState } from "react";
import { content } from "@orden/content";
import {
  apply,
  commandBonus,
  createBattle,
  evaluate,
  reachable,
  samePosition,
  type ActCommand,
  type Action,
  type Position,
} from "@orden/core";
import { BattleMap } from "../game/BattleMap";

const unitNames: Record<string, string> = {
  infantry: "보병",
  pike: "창병",
  cavalry: "기병",
  archer: "궁병",
  flier: "비병",
  neutral: "호송대",
};

export function App() {
  const [state, setState] = useState(() => createBattle(content));
  const [selectedId, setSelectedId] = useState("A2");
  const [destination, setDestination] = useState<Position | null>(null);
  const [action, setAction] = useState<Action>({ type: "wait" });
  const [showCommand, setShowCommand] = useState(true);
  const [message, setMessage] = useState(
    "유닛을 선택하고 밝은 칸을 눌러 이동을 준비하세요.",
  );
  const [history, setHistory] = useState<string[]>([]);
  const unit = state.units.find((u) => u.id === selectedId);
  const canAct = unit?.side === state.activeSide && !unit.acted;
  const moves = useMemo(
    () => (unit && canAct ? reachable(content, state, unit) : []),
    [state, unit, canAct],
  );
  const command: ActCommand | null =
    unit && destination
      ? {
          type: "act",
          commandId: `action-${state.revision + 1}`,
          expectedRevision: state.revision,
          unitId: unit.id,
          path: moves.find((r) => samePosition(r.pos, destination))?.path ?? [],
          action,
        }
      : null;
  const preview = command ? evaluate(content, state, command) : null;
  const bonus = unit ? commandBonus(state, unit) : null;
  const leader = state.units.find((u) => u.id === unit?.commanderId);
  const cancel = () => {
    setDestination(null);
    setAction({ type: "wait" });
  };
  const select = (id: string) => {
    setSelectedId(id);
    cancel();
    setMessage("이동할 칸 또는 공격 대상을 선택하세요.");
  };
  const commit = () => {
    if (!command) return;
    const result = apply(content, state, command);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setState(result.nextState);
    const text = `${unit!.name} · ${action.type === "attack" ? "공격" : action.type === "heal" ? "회복" : action.type === "treat" ? "정비" : "이동·대기"} 완료`;
    setHistory((lines) => [text, ...lines].slice(0, 6));
    setMessage(text);
    cancel();
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest("button, input, select, textarea")
      )
        return;
      if (event.key === "Escape") cancel();
      if (event.key === "Enter") commit();
      if (event.key.toLowerCase() === "c") setShowCommand((v) => !v);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  const onTile = (pos: Position) => {
    const target = state.units.find((u) => samePosition(u.pos, pos));
    if (target && target.side !== "enemy") {
      if (canAct && action.type === "heal" && unit?.canHeal) {
        setDestination(destination ?? unit.pos);
        setAction({ type: "heal", targetId: target.id });
      } else select(target.id);
    } else if (target && canAct && unit) {
      setDestination(destination ?? unit.pos);
      setAction({ type: "attack", targetId: target.id });
    } else if (target) select(target.id);
    else if (canAct && moves.some((r) => samePosition(r.pos, pos))) {
      setDestination(pos);
      setAction({ type: "wait" });
    } else
      setMessage(
        `(${pos.x}, ${pos.y})에는 이동할 수 없습니다. 밝은 빈 칸을 선택하세요.`,
      );
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⚑</span>
          <div>
            오르덴 연대기<small>ORDEN CHRONICLES</small>
          </div>
        </div>
        <span className="section-title">전술 연습장</span>
        <span className="build-label">초기 개발판</span>
      </header>
      <main>
        <section className="mission-heading">
          <div>
            <p className="eyebrow">BRANT FRONTIER / 02</p>
            <h1>두 개의 건널목</h1>
            <p>부대를 나누고, 전선을 지키세요.</p>
          </div>
          <div className="phase">
            <span className="phase-dot" /> 아군 행동 연습{" "}
            <small>
              {
                state.units.filter((u) => u.side === "player" && !u.acted)
                  .length
              }
              기 행동 가능
            </small>
          </div>
        </section>
        <div className="workspace">
          <section className="battle-panel" aria-label="전술 지도와 명령">
            <div className="map-toolbar">
              <span>브란트 국경 · 남쪽 도하 지점</span>
              <button
                aria-pressed={showCommand}
                onClick={() => setShowCommand((v) => !v)}
              >
                지휘 범위 <kbd>C</kbd>
              </button>
            </div>
            <BattleMap
              state={state}
              selectedId={selectedId}
              destination={destination}
              reachable={moves}
              showCommand={showCommand}
              onTile={onTile}
            />
            <div className="map-legend">
              <span>
                <i className="ally" /> 아군
              </span>
              <span>
                <i className="enemy" /> 적군
              </span>
              <span>
                <i className="command" /> 지휘 범위
              </span>
              <span className="pan-hint">지도를 드래그해서 이동</span>
            </div>
            <div className="order-panel">
              <div>
                <p className="eyebrow">행동 미리보기</p>
                <p role="status">
                  {preview && !preview.ok
                    ? preview.error
                    : destination
                      ? `${unit?.name} → (${destination.x}, ${destination.y})`
                      : message}
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
              </div>
              <div className="order-buttons">
                <button onClick={cancel} disabled={!destination}>
                  취소 <kbd>Esc</kbd>
                </button>
                <button
                  className="primary"
                  disabled={!preview?.ok}
                  onClick={commit}
                >
                  행동 확정 <kbd>↵</kbd>
                </button>
              </div>
            </div>
          </section>
          <aside>
            <section className="card unit-card">
              <p className="eyebrow">선택한 유닛</p>
              <div className="unit-title">
                <div className={`unit-emblem ${unit?.side}`}>
                  {unit?.kind === "commander" ? "⚑" : "◆"}
                </div>
                <div>
                  <h2>{unit?.name ?? "유닛을 선택하세요"}</h2>
                  <p>
                    {unit
                      ? `${unitNames[unit.unitType] ?? unit.unitType} · ${unit.kind === "commander" ? "지휘관" : (leader?.name ?? "중립")}`
                      : "전투불능"}
                  </p>
                </div>
              </div>
              {unit && (
                <>
                  <div className="health-line">
                    <span>
                      HP <strong>{unit.hp}</strong>
                      <small> / 10</small>
                    </span>
                    <span>
                      MP {unit.mp} / {unit.stats.maxMp}
                    </span>
                  </div>
                  <div className="health-track">
                    <i style={{ width: `${unit.hp * 10}%` }} />
                  </div>
                  <dl className="stats">
                    <div>
                      <dt>공격</dt>
                      <dd>
                        {unit.stats.at}
                        {bonus?.active && <small> +{bonus.at}</small>}
                      </dd>
                    </div>
                    <div>
                      <dt>방어</dt>
                      <dd>
                        {unit.stats.df}
                        {bonus?.active && <small> +{bonus.df}</small>}
                      </dd>
                    </div>
                    <div>
                      <dt>이동</dt>
                      <dd>{unit.stats.move}</dd>
                    </div>
                    <div>
                      <dt>사거리</dt>
                      <dd>
                        {unit.range[0]}
                        {unit.range[1] !== unit.range[0]
                          ? `–${unit.range[1]}`
                          : ""}
                      </dd>
                    </div>
                  </dl>
                  <p className="command-status">
                    {unit.command
                      ? `⚑ 지휘 반경 ${unit.command.radius} · 소속 용병 공·방 +2`
                      : bonus?.active
                        ? "◇ 소속 지휘 범위 안"
                        : "◇ 지휘 보정 없음"}
                  </p>
                  <div className="unit-actions">
                    <button
                      disabled={!canAct}
                      onClick={() => {
                        setDestination(destination ?? unit.pos);
                        setAction({ type: "wait" });
                      }}
                    >
                      대기
                    </button>
                    <button
                      disabled={!canAct || unit.kind !== "commander"}
                      onClick={() => {
                        setDestination(unit.pos);
                        setAction({ type: "treat" });
                      }}
                    >
                      정비
                    </button>
                    <button
                      disabled={!canAct || !unit.canHeal || unit.mp < 3}
                      onClick={() => {
                        setDestination(destination ?? unit.pos);
                        setAction({ type: "heal", targetId: unit.id });
                        setMessage("회복할 아군을 지도에서 선택하세요.");
                      }}
                    >
                      회복
                    </button>
                  </div>
                </>
              )}
            </section>
            <section className="card roster">
              <div className="card-heading">
                <h2>출격 부대</h2>
                <span>3개 부대</span>
              </div>
              {content.scenario.units
                .filter((u) => u.side === "player" && u.kind === "commander")
                .map((leader) => (
                  <div className="squad" key={leader.id}>
                    <button
                      className={
                        selectedId === leader.id
                          ? "selected squad-leader"
                          : "squad-leader"
                      }
                      disabled={!state.units.some((u) => u.id === leader.id)}
                      aria-label={`${leader.name} 선택`}
                      onClick={() => select(leader.id)}
                    >
                      <span>⚑ {leader.name}</span>
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
                            title={u.id}
                            aria-label={`${u.id} ${u.name} 선택`}
                            className={selectedId === u.id ? "selected" : ""}
                            onClick={() => select(u.id)}
                          >
                            {unitNames[u.unitType]}{" "}
                            <span>{u.acted ? "✓" : u.hp}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
            </section>
            <section className="card objective">
              <p className="eyebrow">작전 구상</p>
              <h2>호송대의 길을 열어라</h2>
              <p>남쪽 다리를 지키거나, 북쪽 봉화로 부대를 나누어 보세요.</p>
              <p className="muted">
                현재는 이동·교전 연습 단계입니다. 적 AI, 호송대 이동, 증원과
                승패 판정은 아직 작동하지 않습니다. 새로고침하면 초기화됩니다.
              </p>
              <button
                className="reset"
                onClick={() => {
                  setState(createBattle(content));
                  setSelectedId("A2");
                  cancel();
                  setHistory([]);
                  setMessage("초기 배치로 돌아왔습니다.");
                }}
              >
                연습 초기화
              </button>
            </section>
          </aside>
        </div>
        <footer>
          <span>작전 기록</span>
          <p>
            {history.length
              ? history.join("　 /　 ")
              : "아직 확정한 행동이 없습니다. 이동 미리보기는 자유롭게 취소할 수 있습니다."}
          </p>
          <span>24 PX · FIELD STUDY</span>
        </footer>
      </main>
    </div>
  );
}
