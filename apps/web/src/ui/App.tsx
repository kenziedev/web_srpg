import { GrowthDialog } from "./GrowthDialog";
import { EquipmentPanel } from "./EquipmentPanel";
import { SpellTraining } from "./SpellTraining";
import { magicEventText, statusNames } from "./magicText";
import { DetailedBattle } from "./DetailedBattle";
import { DetailedSpell } from "./DetailedSpell";
import "./spells.css";
import { useEffect, useState, useRef } from "react";
import { content } from "@orden/content";
import {
  commandBonus,
  terrainAt,
  effectiveUnit,
  effectiveSpellRange,
  previewCommandRange,
} from "@orden/core";
import {
  BattleMap,
  type BattleMapControls,
  type BattleMapView,
} from "../game/BattleMap";
import { MissionPanel, BattleResult } from "./MissionPanel";
import { Portrait } from "./Portrait";
import { SpellIcon } from "./SpellIcon";
import { ArtCredits } from "./ArtCredits";
import { useBattle } from "./useBattle";
import { SavePanel } from "./SavePanel";
import { SaveSlotsPanel } from "./SaveSlotsPanel";
import { OperationPanel } from "./OperationPanel";
import {
  spellRangeLabel,
  spellShapeLabel,
  spellEffectLabel,
} from "./spellLabels";

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
  const [showThreat, setShowThreat] = useState(false);
  const mapControls = useRef<BattleMapControls | null>(null);
  const [mapView, setMapView] = useState<BattleMapView>({
    zoom: 1,
    cursor: null,
  });
  const [showRoster, setShowRoster] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const mapLocked =
    !battle.ready ||
    battle.saving ||
    battle.restoring ||
    battle.showOperation ||
    battle.showSaves ||
    battle.showEquipment ||
    battle.showGrowth ||
    !!battle.animation ||
    battle.finishing ||
    battle.confirmEnd ||
    showInfo ||
    showRoster;
  const viewUnit = unit ? effectiveUnit(content, state, unit) : undefined;
  const commandPreview = unit
    ? previewCommandRange(content, state, unit.id, destination)
    : null;
  const bonus = unit
    ? (commandPreview?.bonuses.find((entry) => entry.unitId === unit.id)
        ?.after ?? commandBonus(state, unit, content))
    : null;
  const terrain = unit
    ? terrainAt(content, destination ?? unit.pos, state)
    : null;
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        battle.showSaves ||
        battle.showEquipment ||
        battle.showGrowth ||
        battle.showOperation ||
        !battle.ready
      )
        return;
      if ((event.target as HTMLElement).closest("input, textarea, select"))
        return;
      if (battle.animation?.detailed) return;
      if (event.key === "Escape") {
        battle.cancel();
        battle.setConfirmEnd(false);
        setShowRoster(false);
        setShowInfo(false);
      }
      if (battle.confirmEnd || showInfo || showRoster || state.outcome) return;
      if (event.key.toLowerCase() === "c") setShowCommand((v) => !v);
      if (event.key.toLowerCase() === "t") setShowThreat((v) => !v);
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
    <>
      <main
        className="game-shell"
        inert={
          battle.showSaves ||
          battle.showEquipment ||
          battle.showGrowth ||
          battle.showOperation
        }
      >
        {battle.animation?.detailed &&
          (battle.animation.events.some(
            (event) => event.type === "spellCast",
          ) ? (
            <DetailedSpell
              key={battle.animation.id}
              animation={battle.animation}
              skip={battle.skipAnimation}
            />
          ) : (
            <DetailedBattle
              key={battle.animation.id}
              animation={battle.animation}
              skip={battle.skipAnimation}
            />
          ))}
        <header className="system-bar">
          <h1>
            오르덴 연대기 <span>― 두 개의 건널목 ―</span>
          </h1>
          <nav>
            <button
              disabled={
                !battle.ready ||
                battle.saving ||
                battle.restoring ||
                !!battle.animation ||
                battle.finishing
              }
              onClick={battle.switchMode}
            >
              {state.mode === "operation" ? "연습 기록 열기" : "정식 출격 열기"}
            </button>
            {state.mode === "operation" && (
              <button
                disabled={
                  !battle.ready ||
                  battle.saving ||
                  battle.restoring ||
                  !!battle.animation ||
                  battle.finishing
                }
                onClick={() => {
                  battle.cancel();
                  battle.setShowOperation(true);
                }}
              >
                출격 준비 · 상점
              </button>
            )}
            <button
              disabled={
                !battle.ready ||
                battle.saving ||
                battle.restoring ||
                !!battle.animation ||
                battle.finishing ||
                (!state.outcome && state.activeSide !== "player")
              }
              onClick={() => {
                battle.cancel();
                battle.setConfirmEnd(false);
                setShowInfo(false);
                setShowRoster(false);
                battle.setShowGrowth(true);
              }}
            >
              성장 · 전직
            </button>
            <button
              disabled={
                !battle.ready ||
                battle.saving ||
                battle.restoring ||
                !!battle.animation ||
                battle.finishing ||
                state.activeSide !== "player"
              }
              onClick={() => {
                battle.cancel();
                battle.setConfirmEnd(false);
                setShowInfo(false);
                setShowRoster(false);
                battle.setShowEquipment(true);
              }}
            >
              장비 · 마법 편성
            </button>
            <button
              disabled={!battle.ready || !!battle.animation || battle.restoring}
              onClick={() => {
                battle.cancel();
                battle.setConfirmEnd(false);
                setShowInfo(false);
                setShowRoster(false);
                battle.setShowSaves(true);
              }}
            >
              저장 · 복구
            </button>
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
            <button
              disabled={!battle.ready || battle.restoring}
              onClick={battle.reset}
            >
              {state.mode === "operation" ? "정식 기록 초기화" : "연습 초기화"}
            </button>
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
          {battle.operationPreparing && (
            <div className="operation-banner" role="status">
              정식 출격 준비 중 · 용병과 장비를 준비한 뒤 출격을 확정하세요.
              <button onClick={() => battle.setShowOperation(true)}>
                출격 준비 열기
              </button>
            </div>
          )}
          {battle.commandLimit && (
            <div className="operation-banner" role="status">
              명령 기록 1,024개에 도달해 전투를 멈췄습니다. 저장·복구에서 파일을
              백업하거나 준비 체크포인트를 불러올 수 있습니다.
              <button onClick={() => battle.setShowSaves(true)}>
                저장 · 복구 열기
              </button>
            </div>
          )}
          <BattleMap
            state={state}
            animation={battle.animation?.detailed ? null : battle.animation}
            selectedId={
              busy && !battle.operationPreparing
                ? (battle.enemyActor ?? "")
                : battle.selectedId
            }
            destination={destination}
            reachable={battle.moves}
            spellCenters={battle.spellCenters}
            spellTiles={battle.spellTiles}
            showCommand={showCommand && !busy}
            showThreat={showThreat}
            inputDisabled={mapLocked}
            onControlsReady={(controls) => {
              mapControls.current = controls;
            }}
            onViewChange={setMapView}
            onTile={battle.onTile}
          />

          {(showThreat || mapView.cursor) && (
            <div className="map-help classic-window" aria-live="polite">
              {showThreat && (
                <span>
                  현재 적의 이동 후 물리 공격 범위 · 행동 완료 포함 · 마법·미래
                  증원 제외
                </span>
              )}
              {mapView.cursor && (
                <span>
                  타일 {mapView.cursor.x}, {mapView.cursor.y} · 방향키 이동 ·
                  Space 선택 · WASD 카메라 · Home 부대 중앙 · Esc 취소
                </span>
              )}
            </div>
          )}
          <div
            className={`turn-window classic-window ${state.activeSide === "enemy" ? "enemy-turn" : ""}`}
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
              disabled={
                !canAct ||
                !battle.healingSpell ||
                (unit?.mp ?? 0) < battle.healingSpell.mpCost
              }
              onClick={() => battle.prepare("heal")}
            >
              회복
            </button>
            <button
              disabled={!canAct || !battle.spells.length}
              aria-expanded={battle.spellMenuOpen}
              aria-controls="spell-menu"
              onClick={() => battle.setSpellMenuOpen(!battle.spellMenuOpen)}
            >
              마법
            </button>
            {battle.spellMenuOpen && canAct && (
              <section
                id="spell-menu"
                className="spell-menu classic-window"
                aria-label="마법 목록"
              >
                <div className="window-caption">마법 선택 · MP {unit?.mp}</div>
                {battle.spells.map((spell) => (
                  <button
                    key={spell.id}
                    onClick={() => battle.prepareSpell(spell.id)}
                  >
                    <strong>
                      <SpellIcon spellId={spell.id} />
                      {spell.name}
                    </strong>
                    <span>MP {spell.mpCost}</span>
                    <small>
                      {spellRangeLabel({
                        ...spell,
                        range: effectiveSpellRange(content, unit!, spell),
                      })}{" "}
                      · {spellShapeLabel(spell)}
                      {(unit?.mp ?? 0) < spell.mpCost ? " · MP 부족" : ""}
                    </small>
                    <small>{spellEffectLabel(spell)}</small>
                  </button>
                ))}
                <p>이동 위치를 먼저 정한 뒤 마법과 중심 칸을 선택하세요.</p>
                <button onClick={() => battle.setSpellMenuOpen(false)}>
                  마법 목록 닫기
                </button>
              </section>
            )}
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
            <label className="combat-mode">
              전투 연출
              <select
                aria-label="전투 연출"
                disabled={busy}
                value={battle.combatMode}
                onChange={(e) =>
                  battle.setCombatMode(e.target.value as "simple" | "detailed")
                }
              >
                <option value="simple">간략</option>
                <option value="detailed">상세</option>
              </select>
            </label>
            <label className="speed-option">
              <input
                type="checkbox"
                checked={battle.autoFollow}
                disabled={busy}
                onChange={(e) => battle.setAutoFollow(e.target.checked)}
              />
              용병 자동 행동
            </label>
            <label className="speed-option">
              <input
                type="checkbox"
                checked={battle.fast}
                onChange={(e) => battle.setFast(e.target.checked)}
              />{" "}
              빠른 진행
            </label>
          </div>
          {busy &&
            !state.outcome &&
            !battle.animation &&
            !battle.saving &&
            !battle.showSaves &&
            !battle.showEquipment &&
            !battle.showGrowth && (
              <div className="phase-banner" aria-hidden="true">
                {!battle.ready
                  ? "저장 확인 중…"
                  : battle.finishing
                    ? "FOLLOW ORDERS"
                    : state.activeSide === "enemy"
                      ? "ENEMY PHASE"
                      : "NEXT TURN"}
              </div>
            )}
          {battle.animation && !battle.animation.detailed && (
            <div
              className="battle-feedback classic-window"
              data-testid="battle-feedback"
              aria-live="polite"
            >
              {battle.feedback}
            </div>
          )}
          <MissionPanel state={state} />
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
                            {u.summon ? u.name : (names[u.unitType] ?? u.name)}{" "}
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
            <Portrait unit={unit} />
            <div>
              <div className="unit-name">
                <h2>{unit?.name ?? "부대 선택"}</h2>
                <small>
                  {unit ? (names[unit.unitType] ?? unit.unitType) : ""}
                </small>
                {unit?.progression && (
                  <span className="growth-level">
                    Lv.{unit.progression.level}{" "}
                    {
                      content.classes.find(
                        (entry) => entry.id === unit.progression?.classId,
                      )?.name
                    }
                  </span>
                )}
                {unit?.acted && <em data-testid="acted">행동 완료</em>}
              </div>
              <div className="stats-line">
                <span>
                  AT{" "}
                  <b>
                    {viewUnit?.stats.at ?? "―"}
                    {bonus?.active && <i>+{bonus.at}</i>}
                  </b>
                </span>
                <span>
                  DF{" "}
                  <b>
                    {viewUnit?.stats.df ?? "―"}
                    {bonus?.active && <i>+{bonus.df}</i>}
                  </b>
                </span>
                <span>
                  MV <b>{viewUnit?.stats.move ?? "―"}</b>
                </span>
                <span className="health-line">
                  HP <strong>{unit?.hp ?? "―"}</strong>
                </span>
                <span>
                  MP{" "}
                  <b>
                    {unit?.mp ?? "―"} / {viewUnit?.stats.maxMp ?? "―"}
                  </b>
                </span>
              </div>
              <div className="terrain-line">
                {terrain?.name ?? "―"}　지형 DF +
                {unit?.moveType === "flying" ? 0 : (terrain?.defense ?? 0)}　
                {viewUnit?.command
                  ? `지휘 ${viewUnit.command.radius}`
                  : bonus?.active
                    ? "지휘 범위 안"
                    : "지휘 보정 없음"}
              </div>
              <div className="status-badges" aria-label="상태 효과">
                {state.statuses
                  .filter((effect) => effect.unitId === unit?.id)
                  .map((effect) => (
                    <span
                      key={effect.status}
                      title={`${effect.expiresRound}라운드 ${effect.expiresSide} 페이즈에 종료`}
                    >
                      {statusNames[effect.status]}
                      {effect.power
                        ? ` ${effect.status === "decline" ? "−" : "+"}${effect.power}`
                        : ""}
                    </span>
                  ))}
              </div>
              <div className="magic-stats">
                MAG {viewUnit?.stats.mag ?? "―"} · RES{" "}
                {viewUnit?.stats.res ?? "―"}
              </div>
            </div>
          </div>
          <div className="order-panel">
            <p role="status">
              {busy
                ? battle.message
                : preview && !preview.ok
                  ? preview.error
                  : battle.selectedSpell
                    ? `${battle.selectedSpell.name}${battle.selectedSpell.effect.type === "teleport" ? (battle.spellAnchor ? ` · 도착 ${battle.spellDestination ? `(${battle.spellDestination.x}, ${battle.spellDestination.y})` : "칸 선택"}` : " · 이동할 아군 선택") : ""} · ${battle.spellCenter ? `중심 (${battle.spellCenter.x}, ${battle.spellCenter.y})` : "중심 칸 선택"} · MP ${unit?.mp}${preview?.ok ? ` → ${preview.nextState.units.find((u) => u.id === unit?.id)?.mp ?? 0}` : ` / 소모 ${battle.selectedSpell.mpCost}`}`
                    : destination
                      ? `${unit?.name} → (${destination.x}, ${destination.y})`
                      : battle.message}
            </p>
            {preview?.ok && (
              <div
                className={`prediction ${battle.selectedSpell ? "spell-prediction" : ""}`}
                data-testid="prediction"
                aria-live="polite"
              >
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
                      {battle.selectedSpell ? `${e.unitId} ` : ""}
                      {e.type === "removed"
                        ? e.reason === "retreated"
                          ? "부대 퇴각"
                          : "전투불능"
                        : battle.selectedSpell
                          ? `HP ${state.units.find((u) => u.id === e.unitId)?.hp} → ${preview.nextState.units.find((u) => u.id === e.unitId)?.hp ?? "전장 이탈"} (${e.type === "damaged" ? "−" : "+"}${e.amount})`
                          : `${e.type === "damaged" ? "−" : "+"}${e.amount} HP`}
                    </span>
                  ))}
                {preview.events.flatMap((event, index) => {
                  const text = magicEventText(
                    content,
                    state,
                    preview.nextState,
                    event,
                  );
                  return text
                    ? [<span key={`magic-${index}`}>{text}</span>]
                    : [];
                })}
              </div>
            )}
            <div className="order-buttons">
              {battle.spellAnchor && (
                <button
                  disabled={busy}
                  onClick={() => battle.prepareSpell(battle.selectedSpell!.id)}
                >
                  대상 다시 선택
                </button>
              )}
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
          <div className="map-tools" aria-label="지도 보기 도구">
            <button
              aria-pressed={showThreat}
              onClick={() => setShowThreat((value) => !value)}
            >
              적 위협 T
            </button>
            <button
              aria-label="지도 축소"
              disabled={mapLocked || mapView.zoom <= 0.5}
              onClick={() => mapControls.current?.zoomOut()}
            >
              −
            </button>
            <button
              aria-label="지도 확대"
              disabled={mapLocked || mapView.zoom >= 1.5}
              onClick={() => mapControls.current?.zoomIn()}
            >
              +
            </button>
            <button
              aria-label="지도 배율 초기화"
              disabled={mapLocked}
              onClick={() => mapControls.current?.resetZoom()}
            >
              {Math.round(mapView.zoom * 100)}%
            </button>
            <button
              disabled={mapLocked}
              onClick={() => mapControls.current?.centerOn(battle.unit?.pos)}
            >
              부대 중앙
            </button>
            <button
              disabled={mapLocked}
              onClick={() => mapControls.current?.focusTile(battle.unit?.pos)}
            >
              키보드 타일 선택
            </button>
          </div>
          <span
            data-testid="save-status"
            className={battle.saveError ? "save-error" : ""}
            title={battle.saveError}
            aria-live="polite"
          >
            {battle.saveStatus}
            {battle.saveError ? " · 저장/복구 확인" : ""}
          </span>
        </div>
        {!battle.animation && (
          <BattleResult
            state={state}
            restart={battle.deploy}
            growth={() => battle.setShowGrowth(true)}
            locked={battle.saving || battle.restoring}
            error={battle.preparationError}
          />
        )}
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
              <p>
                {battle.autoFollow
                  ? "미행동 용병은 지휘관을 따라 이동·공격한 뒤 적군 턴으로 넘어갑니다. 미행동 지휘관은 대기합니다."
                  : "남은 행동을 포기하고 적군 턴으로 넘어갑니다."}
              </p>
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
              <ArtCredits />
              <p>
                턴 종료 → 미행동 용병 추종·공격 → 적군 행동 → 다음 아군 턴
                순서입니다. 직접 대기·공격한 용병은 자동 행동하지 않습니다. 아군
                턴 시작에 지휘관과 인접한 소속 용병은 HP 3, 거점 위 지상 유닛은
                HP 2를 회복합니다. 두 회복은 중첩되지 않습니다.
              </p>
              <p>
                10라운드 내 호송대를 동쪽 탈출 지점으로 보내십시오. 카이엘 또는
                호송대가 쓰러지면 패배합니다. 호송대는 NPC 턴마다 도로를 2칸
                이동하며 아군은 통과하지만 점유 칸에는 멈추지 못합니다. 확정된
                전투는 자동 저장하며 새로고침 후 이어집니다. 저장·복구에서 파일
                백업과 직전 저장 복구를 할 수 있습니다.
              </p>
              <p>
                마법은 이동 위치 → 마법 목록 → 중심 칸 → 행동 확정 순서로
                사용합니다. 보라색은 중심 사거리, 밝은 테두리는 효과 범위입니다.
                지역 마법은 빈 칸을 중심으로 선택할 수 있습니다. 부대 마법은
                지휘관이나 소속 용병을 누르면 같은 부대 전체에 적용됩니다. 모든
                대상의 피해·회복과 MP 변화를 먼저 확인하세요. 마법에는 반격이
                없으며 Esc로 선택을 취소할 수 있습니다.
              </p>
              <p>
                봉화 (7, 2)는 아군 지휘관이 라운드 끝까지 점유해야 합니다.
                2라운드까지 점령하면 보너스, 증원 전 점령하면 비병 등장이
                취소됩니다. 호송 HP 7 이상 탈출도 보너스입니다.
              </p>
              <p>
                비병 3기는 3라운드 종료에 (13, 1), (12, 1), (14, 1)로
                등장합니다. 예비 칸은 각 위치의 바로 위입니다. 공간 부족 시 전체
                부대가 보류되며 등장 다음 적 턴부터 행동합니다.
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
      {battle.showOperation && (
        <OperationPanel
          state={state}
          locked={battle.saving || battle.restoring}
          error={battle.preparationError}
          close={() => battle.setShowOperation(false)}
          hire={battle.hire}
          trade={battle.trade}
          startBattle={battle.startBattle}
          openEquipment={() => {
            battle.setShowOperation(false);
            battle.setShowEquipment(true);
          }}
          openGrowth={() => {
            battle.setShowOperation(false);
            battle.setShowGrowth(true);
          }}
        />
      )}
      {battle.showGrowth && (
        <GrowthDialog
          state={state}
          locked={battle.saving || battle.restoring}
          error={battle.preparationError}
          close={() => battle.setShowGrowth(false)}
          promote={battle.promote}
          reclass={battle.reclass}
          mastery={battle.mastery}
          deploy={battle.deploy}
        />
      )}
      {battle.showEquipment && (
        <EquipmentPanel
          content={content}
          state={state}
          locked={battle.saving || battle.restoring}
          error={battle.preparationError}
          close={() => battle.setShowEquipment(false)}
          equip={battle.equip}
        >
          <SpellTraining
            state={state}
            locked={battle.saving || battle.restoring}
            train={battle.train}
          />
        </EquipmentPanel>
      )}
      {battle.showSaves && (
        <SavePanel
          status={battle.saveStatus}
          error={battle.saveError}
          notice={battle.saveNotice}
          savedAt={battle.savedAt}
          locked={battle.saving || battle.restoring}
          close={() => battle.setShowSaves(false)}
          exportSave={battle.exportSave}
          exportStoredSave={battle.exportStoredSave}
          importSave={(file) => {
            void battle.loadSave(file);
          }}
          restorePrevious={() => {
            void battle.loadSave();
          }}
          retry={battle.retrySave}
          exportLegacySave={(slot) => {
            void battle.exportStoredSave(slot, true);
          }}
          modeLabel={state.mode === "operation" ? "정식 출격" : "연습"}
          commandCount={state.commands.length}
        >
          <SaveSlotsPanel
            slots={battle.saveSlots}
            loading={battle.slotsLoading}
            locked={battle.saving || battle.restoring}
            error={battle.slotsError}
            save={(slot) => {
              void battle.saveManual(slot);
            }}
            load={(slot) => {
              void battle.loadSave(undefined, slot);
            }}
            exportSlot={(slot) => {
              void battle.exportStoredSave(slot);
            }}
          />
        </SavePanel>
      )}
    </>
  );
}
