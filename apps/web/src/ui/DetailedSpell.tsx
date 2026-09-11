import { useEffect, useRef, useState, type CSSProperties } from "react";
import { content } from "@orden/content";
import type { Unit } from "@orden/core";
import type { BattleAnimation } from "../game/BattleAnimation";
import { rider, soldier } from "../game/pixelUnits";
import { Portrait } from "./Portrait";
import { spellShapeLabel } from "./spellLabels";
import { magicEventText, statusNames } from "./magicText";
import "./spell-animation.css";

function SpellFighter({ unit }: { unit: Unit }) {
  const pattern = unit.moveType === "mounted" ? rider : soldier;
  const palette: Record<string, string> = {
    h: "#7f98b0",
    l: "#e2e4c8",
    s: "#e9b687",
    o: "#1b283f",
    a: unit.side === "enemy" ? "#b56170" : "#638bd0",
    d: "#584333",
    w: "#d2bd83",
  };
  return (
    <svg viewBox="-2 -3 24 24" shapeRendering="crispEdges" aria-hidden="true">
      <ellipse cx="8" cy="17" rx="9" ry="2" fill="#071423" opacity=".6" />
      {pattern.flatMap((row, y) =>
        [...row].map((pixel, x) =>
          palette[pixel] ? (
            <rect
              key={`${x},${y}`}
              x={x}
              y={y}
              width="1"
              height="1"
              fill={palette[pixel]}
            />
          ) : null,
        ),
      )}
      {unit.kind === "commander" && (
        <path d="M3-1h2v1h2v-2h2v2h2v-1h2v4H3z" fill="#e8c985" />
      )}
    </svg>
  );
}

/** A presentation of an already committed cast; it never predicts spell effects. */
export function DetailedSpell({
  animation,
  skip,
}: {
  animation: BattleAnimation;
  skip: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    button.current?.focus();
    setProgress(0);
    const start = performance.now();
    let handle = 0;
    const tick = () => {
      const next = Math.min(
        1,
        (performance.now() - start) / Math.max(1, animation.impactMs),
      );
      setProgress(next);
      if (next < 1) handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
      queueMicrotask(() => {
        if (previous?.isConnected && !previous.closest("[inert]"))
          previous.focus();
      });
    };
  }, [animation]);

  const command = animation.command;
  const event = animation.events.find((item) => item.type === "spellCast");
  if (command.type !== "act" || !event) return null;
  const spellId = event.spellId;
  const spell = content.spells.find((item) => item.id === spellId);
  const caster = animation.before.units.find(
    (unit) => unit.id === command.unitId,
  );
  if (!caster || !spell) return null;
  const affectedIds = new Set([
    ...event.affectedIds,
    ...animation.events.flatMap((item) =>
      item.type === "summoned" ? [item.unitId] : [],
    ),
  ]);
  const affected = [...affectedIds].flatMap((id) => {
    const unit =
      animation.before.units.find((candidate) => candidate.id === id) ??
      animation.after.units.find((candidate) => candidate.id === id);
    return unit ? [unit] : [];
  });
  const indirectRemovals = animation.events.flatMap((item) => {
    if (item.type !== "removed" || affectedIds.has(item.unitId)) return [];
    const unit = animation.before.units.find(
      (candidate) => candidate.id === item.unitId,
    );
    return unit ? [unit] : [];
  });
  const results = [...affected, ...indirectRemovals];
  const healing = spell.effect.type === "heal";
  const offensive =
    spell.effect.type === "damage" || spell.effect.type === "slay-undead";
  const effectName = healing
    ? "회복 마법"
    : offensive
      ? "공격 마법"
      : spell.effect.type === "status"
        ? spell.effect.hostile
          ? "약화 마법"
          : "강화 마법"
        : spell.effect.type === "teleport"
          ? "순간이동"
          : spell.effect.type === "again"
            ? "행동권 회복"
            : "소환 마법";
  const terrainEvents = animation.events.filter(
    (item) => item.type === "terrainChanged",
  );
  const phase =
    progress < 0.38 ? "charge" : progress < 0.72 ? "release" : "result";
  const revealed = phase !== "charge";
  const afterHp = (unit: Unit) =>
    animation.after.units.find((candidate) => candidate.id === unit.id)?.hp ??
    0;
  const afterMp =
    animation.after.units.find((unit) => unit.id === caster.id)?.mp ?? 0;
  const resultLabel = (unit: Unit) => {
    const change = animation.events.find(
      (item) =>
        (item.type === "damaged" || item.type === "healed") &&
        item.unitId === unit.id,
    );
    if (change?.type === "healed") return `+${change.amount}`;
    if (change?.type === "damaged")
      return change.amount > 0 ? `−${change.amount}` : "저항 0";
    const effect = animation.events.find(
      (item) =>
        "unitId" in item &&
        item.unitId === unit.id &&
        [
          "statusApplied",
          "statusExpired",
          "teleported",
          "summoned",
          "refreshed",
        ].includes(item.type),
    );
    if (effect?.type === "statusApplied")
      return effect.success ? statusNames[effect.status] : "저항";
    if (effect?.type === "statusExpired") return "상태 종료";
    if (effect?.type === "teleported") return "이동 완료";
    if (effect?.type === "summoned") return "소환 완료";
    if (effect?.type === "refreshed") return "행동권 회복";
    return "변화 없음";
  };
  return (
    <div
      className="spell-duel-scrim"
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          skip();
        } else if (e.key === "Tab") {
          const focusable = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              "button, [tabindex='0']",
            ) ?? [],
          );
          const index = focusable.indexOf(
            document.activeElement as HTMLElement,
          );
          const next = e.shiftKey
            ? index <= 0
              ? focusable.length - 1
              : index - 1
            : (index + 1) % focusable.length;
          e.preventDefault();
          focusable[next]?.focus();
        }
      }}
    >
      <section
        ref={dialog}
        className={`spell-duel-window classic-window ${healing ? "spell-restorative" : offensive ? "spell-offensive" : "spell-supportive"} ${reducedMotion ? "spell-reduced-motion" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="상세 마법"
        data-testid="detailed-spell"
        data-phase={phase}
        style={
          { "--cast-duration": `${animation.impactMs}ms` } as CSSProperties
        }
      >
        <header className="spell-duel-title">
          <span>ARCANA</span>
          <b>상세 마법</b>
          <small>
            {phase === "charge"
              ? "마력 집중"
              : phase === "release"
                ? "마법 동시 발동"
                : "마법 결과"}
          </small>
        </header>
        <div className="spell-cast-summary">
          <div className="spell-caster">
            <Portrait unit={caster} />
            <div>
              <small>시전자</small>
              <h2>{caster.name}</h2>
              <p>
                MP{" "}
                <b>
                  {caster.mp} → {afterMp}
                </b>
              </p>
              <p>
                HP {caster.hp} → {afterHp(caster)}
              </p>
            </div>
          </div>
          <div className="spell-cast-name">
            <small>
              {spellShapeLabel(spell)} · {effectName}
            </small>
            <h2>{spell.name}</h2>
            <span>
              {affected.length}기 대상
              {terrainEvents.length > 0
                ? ` · 지형 ${terrainEvents.length}칸`
                : ""}{" "}
              · 반격 없음
            </span>
          </div>
        </div>
        <div className={`spell-theater phase-${phase}`} aria-hidden="true">
          <svg
            className="spell-conduits"
            viewBox="0 0 800 220"
            preserveAspectRatio="none"
          >
            <path
              className="spell-magic-ring"
              d="M50 175l60-25 60 25-60 25zM65 175l45-15 45 15-45 15z"
            />
            {affected.map((unit, index) => {
              const x =
                310 + ((index + 0.5) * 450) / Math.max(1, affected.length);
              return (
                <g key={unit.id}>
                  <path
                    className="spell-magic-thread"
                    d={`M110 125Q${x / 2 + 55} 15 ${x} 125`}
                  />
                  <path
                    className="spell-target-ring"
                    d={`M${x - 32} 175l32-13 32 13-32 13z`}
                  />
                  <path
                    className="spell-light-column"
                    d={`M${x - 15} 167v-105h30v105z`}
                  />
                </g>
              );
            })}
          </svg>
          <div className="spell-theater-caster">
            <span className="spell-charge-orb">✦</span>
            <SpellFighter unit={caster} />
          </div>
          <div className="spell-theater-targets">
            {affected.length === 0 && terrainEvents.length > 0 && (
              <div className="spell-terrain-display">
                ▧<b>지형 {terrainEvents.length}칸 변화</b>
              </div>
            )}
            {affected.map((unit) => (
              <div
                className={`spell-theater-target ${afterHp(unit) === 0 && revealed ? "spell-fallen" : ""}`}
                key={unit.id}
              >
                <span className="spell-impact-symbol">
                  {healing ? "✧" : offensive ? "✦" : "◇"}
                </span>
                <SpellFighter unit={unit} />
                <b>{revealed ? resultLabel(unit) : ""}</b>
              </div>
            ))}
          </div>
          <div className="spell-theater-caption">
            {phase === "charge"
              ? "마력을 모으는 중"
              : phase === "release"
                ? spell.name
                : "효과 적용 완료"}
          </div>
        </div>
        <div
          className="spell-results"
          tabIndex={0}
          aria-label="마법 대상과 부대 퇴각 확정 결과"
        >
          {results.map((unit) => {
            const removal = animation.events.find(
              (item) => item.type === "removed" && item.unitId === unit.id,
            );
            const retreated =
              removal?.type === "removed" && removal.reason === "retreated";
            const direct = affectedIds.has(unit.id);
            const beforeUnit = animation.before.units.find(
              (candidate) => candidate.id === unit.id,
            );
            const summonReplaced =
              retreated && !!unit.summon && spell.effect.type === "summon";
            const detailLines = animation.events.flatMap((item) => {
              if (!("unitId" in item) || item.unitId !== unit.id) return [];
              const line = magicEventText(
                content,
                animation.before,
                animation.after,
                item,
              );
              return line ? [line] : [];
            });
            return (
              <div
                className="spell-result"
                key={unit.id}
                data-testid={`spell-result-${unit.id}`}
              >
                <span>
                  {unit.name} · {unit.id}
                  <small>
                    {!direct
                      ? summonReplaced
                        ? "기존 소환물"
                        : "범위 밖 부대 퇴각"
                      : unit.summon
                        ? "소환물"
                        : unit.kind === "commander"
                          ? "지휘관"
                          : unit.kind === "escort"
                            ? "호송대"
                            : "용병"}
                  </small>
                </span>
                <div className="spell-result-hp">
                  {!beforeUnit ? (
                    <span>
                      소환 HP <b>{afterHp(unit)}</b>
                    </span>
                  ) : retreated ? (
                    <span>시전 전 HP {unit.hp} · 퇴각</span>
                  ) : (
                    <>
                      <span>
                        {!offensive && !healing ? (
                          <>
                            HP <b>{afterHp(unit)}</b> 유지
                          </>
                        ) : (
                          <>
                            HP {unit.hp} → <b>{afterHp(unit)}</b>
                          </>
                        )}
                      </span>
                      <div>
                        <i
                          style={{
                            width: `${(revealed ? afterHp(unit) : unit.hp) * 10}%`,
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
                <strong>
                  {direct
                    ? resultLabel(unit)
                    : summonReplaced
                      ? "소환 교체"
                      : "직접 피격 없음"}
                  {retreated
                    ? summonReplaced
                      ? " · 퇴각"
                      : " · 지휘관 격파로 퇴각"
                    : removal?.type === "removed"
                      ? " · 격파"
                      : ""}
                </strong>
                {detailLines.length > 0 && (
                  <p className="spell-result-effect">
                    {detailLines.join(" · ")}
                  </p>
                )}
              </div>
            );
          })}
          {terrainEvents.map((item) => (
            <div
              className="spell-terrain-result"
              key={`${item.pos.x},${item.pos.y}`}
            >
              {magicEventText(content, animation.before, animation.after, item)}
            </div>
          ))}
        </div>
        <footer className="spell-duel-footer">
          <p aria-live="polite">
            {phase === "result"
              ? `${spell.name} · ${affected.length}기 효과 적용 완료`
              : "선택한 범위의 대상에게 동시에 적용합니다."}
          </p>
          <button ref={button} onClick={skip}>
            건너뛰기 <kbd>Space</kbd>
          </button>
        </footer>
      </section>
    </div>
  );
}
