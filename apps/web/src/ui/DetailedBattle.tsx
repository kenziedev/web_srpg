import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { BattleAnimation } from "../game/BattleAnimation";
import { canCounter, distance, type Unit } from "@orden/core";
import { content } from "@orden/content";
import { soldier, rider } from "../game/pixelUnits";
import { Portrait } from "./Portrait";

type Pose = "ready" | "run" | "attack" | "hit" | "cast";
function Fighter({
  unit,
  pose,
  frame,
}: {
  unit: Unit;
  pose: Pose;
  frame: number;
}) {
  const mounted = unit.moveType === "mounted";
  const pattern = mounted ? rider : soldier;
  const stride = frame % 2 === 0 ? -1 : 1;
  const bob = pose === "run" ? stride : 0;
  const swing =
    pose === "attack" || pose === "cast"
      ? frame % 3 === 0
        ? -55
        : frame % 3 === 1
          ? 25
          : 75
      : 0;
  const palette: Record<string, string> = {
    h: "#6e8798",
    l: "#e2e4c8",
    s: "#e9b687",
    o: "#1b283f",
    a: unit.side === "enemy" ? "#ae534d" : "#456da7",
    d: "#584333",
    w: "#d2bd83",
  };
  return (
    <svg
      viewBox={mounted ? "-3 -3 24 22" : "-3 -3 22 22"}
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-pose={pose}
    >
      <ellipse cx="7" cy="15" rx="7" ry="1" fill="#233b36" opacity=".35" />
      <g transform={`translate(${pose === "hit" ? -2 : 0} ${bob})`}>
        {unit.moveType === "flying" && (
          <path
            fill="#dbdfc8"
            d={
              frame % 2
                ? "M-2 1h6v8H0zM9 1h7v8h-7z"
                : "M-2 5h6v6H0zM9 5h7v6h-7z"
            }
          />
        )}
        {pattern.flatMap((row, y) =>
          [...row].flatMap((ink, x) =>
            ink === "." ||
            y >= (mounted ? 12 : 11) ||
            (!mounted && ink === "w") ? (
              []
            ) : (
              <rect
                key={`${x}/${y}`}
                x={x}
                y={y}
                width="1"
                height="1"
                fill={palette[ink]}
              />
            ),
          ),
        )}
        <g
          className="fighter-legs"
          transform={`translate(${pose === "run" ? stride : 0} 0)`}
          fill="#4f3932"
        >
          {mounted ? (
            <path
              d={
                frame % 2 && pose === "run"
                  ? "M4 12h2v3H3v-1h1zM10 12h2v2h3v1h-4z"
                  : "M4 12h2v2H3v1H2v-2h2zM11 12h2v3h-2z"
              }
            />
          ) : (
            <path
              d={
                frame % 2 && pose === "run"
                  ? "M4 11h2v2h3v2H5v-2H3zM8 11h2v3h-2z"
                  : "M4 11h2v3H2v-1h2zM8 11h2v2h2v2H8z"
              }
            />
          )}
        </g>
        <g
          className="fighter-weapon"
          transform={
            unit.unitType === "pike"
              ? `translate(${pose === "attack" ? (frame % 2 ? 4 : 0) : 0} 0) rotate(${pose === "attack" ? 65 : 0} 9 7)`
              : `rotate(${swing} 9 7)`
          }
        >
          <path fill="#edbd8e" d="M8 6h3v2H8z" />
          {pose === "cast" ? (
            <>
              <path d="M11 0v15" stroke="#d1b578" strokeWidth="2" />
              <circle
                cx="11"
                cy="0"
                r="3"
                fill={frame % 2 ? "#edffd8" : "#80eac5"}
              />
            </>
          ) : unit.unitType === "archer" ? (
            <>
              <path d="M11 2l3 5-3 5M11 2v10" stroke="#cda66d" fill="none" />
              <path
                d={pose === "attack" ? "M9 7h8" : "M10 7h4"}
                stroke="#f7e5b7"
              />
            </>
          ) : unit.unitType === "pike" ? (
            <>
              <path fill="#af8c54" d="M11 0h1v16h-1z" />
              <path fill="#eef0d5" d="M11-3h1v3h-1zM10-1h3v2h-3z" />
            </>
          ) : (
            <>
              <path fill="#e3e4ce" d="M10-1h2v8h-2z" />
              <path fill="#c3a26c" d="M8 6h6v1H8zM10 7h2v3h-2z" />
            </>
          )}
        </g>
      </g>
      {pose === "attack" && frame % 2 === 0 && (
        <path
          d="M12-1l5 4-1 6-3 3"
          fill="none"
          stroke="#fff0bd"
          strokeWidth="1"
        />
      )}
      {pose === "hit" && (
        <path d="M2 3l9 9M12 3L3 12" stroke="#ffe6a2" strokeWidth="1" />
      )}
    </svg>
  );
}

export function DetailedBattle({
  animation,
  skip,
}: {
  animation: BattleAnimation;
  skip: () => void;
}) {
  const [frame, setFrame] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const progress = frame / 80;
  const impact = progress >= 0.78;
  const phase =
    progress < 0.16
      ? "ready"
      : progress < 0.4
        ? "run"
        : progress < 0.78
          ? "attack"
          : progress < 0.84
            ? "hit"
            : "result";
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    button.current?.focus();
    const start = performance.now();
    let handle = 0;
    const tick = () => {
      setFrame(
        Math.min(
          80,
          Math.floor(((performance.now() - start) / animation.impactMs) * 80),
        ),
      );
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
      previous?.focus();
    };
  }, [animation]);
  const cmd = animation.command;
  if (
    cmd.type !== "act" ||
    (cmd.action.type !== "attack" && cmd.action.type !== "heal")
  )
    return null;
  const healing = cmd.action.type === "heal";
  const targetId = cmd.action.targetId;
  const attacker = animation.before.units.find((u) => u.id === cmd.unitId)!;
  const defender = animation.before.units.find((u) => u.id === targetId)!;
  const participants = [attacker, defender];
  const movedAttacker = { ...attacker, pos: cmd.path.at(-1) ?? attacker.pos };
  const returned =
    !healing && canCounter(content, animation.before, defender, movedAttacker);
  // A bow with minimum range 1 still uses a melee exchange on adjacent tiles.
  const ranged = !healing && distance(movedAttacker.pos, defender.pos) > 1;
  const damageFor = (id: string) =>
    animation.events.find((e) => e.type === "damaged" && e.unitId === id);
  const afterHp = (unit: Unit) =>
    animation.after.units.find((u) => u.id === unit.id)?.hp ?? 0;
  const shownHp = (unit: Unit) => {
    const finalHp = afterHp(unit);
    const reveal = Math.max(0, Math.min(1, (progress - 0.46) / 0.3));
    return unit.hp + Math.trunc((finalHp - unit.hp) * reveal);
  };
  return (
    <div
      className="duel-scrim"
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          skip();
        }
        if (e.key === "Tab") {
          e.preventDefault();
          button.current?.focus();
        }
      }}
    >
      <section
        className="duel-window classic-window"
        role="dialog"
        aria-modal="true"
        aria-label="상세 전투"
        style={
          { "--duel-duration": `${animation.impactMs}ms` } as CSSProperties
        }
      >
        <header className="duel-title">
          <span>ENGAGEMENT</span>
          <b>상세 전투</b>
          <small>
            {
              {
                ready: "대형 정렬",
                run: healing ? "마력 집중" : ranged ? "사격 준비" : "돌격",
                attack: healing
                  ? "회복 마법 발동"
                  : returned
                    ? "공격 · 반격"
                    : "공격 · 반격 없음",
                hit: healing ? "회복" : "피격",
                result: "교전 결과",
              }[phase]
            }
          </small>
        </header>
        <div className="duel-status">
          {participants.map((unit, index) => (
            <div
              className={`duel-unit ${index ? "defender" : "attacker"}`}
              key={index}
            >
              <Portrait unit={unit} />
              <div>
                <small>
                  {healing
                    ? index
                      ? "회복 대상"
                      : "시전자"
                    : index
                      ? "방어 부대"
                      : "공격 부대"}{" "}
                  · {unit.kind === "commander" ? "지휘관" : "병력"}
                </small>
                <h2>{unit.name}</h2>
                <div
                  className="duel-hp"
                  aria-label={`${index ? "방어" : "공격"} HP`}
                >
                  <b>{shownHp(unit)}</b>
                  <span>/ 10</span>
                </div>
                <div className="duel-hp-bar">
                  <i
                    style={{
                      width: `${shownHp(unit) * 10}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div
          className={`duel-stage choreographed ${healing ? "healing" : ""} phase-${phase} ${impact ? "impact" : ""}`}
          data-phase={phase}
          data-frame={frame}
          aria-hidden="true"
        >
          <div className="duel-cloud cloud-one" />
          <div className="duel-cloud cloud-two" />
          <div className="duel-hills" />
          <div className="duel-ground" />
          {participants.map((unit, side) => {
            const count =
              unit.kind === "mercenary"
                ? healing
                  ? Math.max(unit.hp, afterHp(unit))
                  : unit.hp
                : 1;
            const survivors =
              unit.kind === "mercenary"
                ? shownHp(unit)
                : shownHp(unit) > 0
                  ? 1
                  : 0;
            const active = side === 0 || returned;
            return (
              <div
                className={`duel-army army-${side}`}
                key={side}
                data-active={active}
                data-attack-style={
                  healing
                    ? "heal"
                    : !active
                      ? "inactive"
                      : ranged
                        ? "ranged"
                        : "melee"
                }
              >
                {Array.from({ length: count }, (_, i) => {
                  // Independent lanes/ranks and start times make soldiers meet in
                  // the field; this is presentation only, never another combat roll.
                  const lane = unit.kind === "commander" ? 2 : i % 5;
                  const rank = Math.floor(i / 5);
                  const direction = side === 0 ? 1 : -1;
                  const home = side === 0 ? 9 + rank * 12 : 83 - rank * 12;
                  const opponentMoves =
                    !ranged && (side === 0 ? returned : true);
                  const contact =
                    side === 0
                      ? (opponentMoves ? 42 : 75) - rank * 6
                      : (opponentMoves ? 50 : 17) + rank * 6;
                  const approach = Math.max(
                    0,
                    Math.min(
                      1,
                      (progress - 0.14 - lane * 0.009 - rank * 0.03) / 0.23,
                    ),
                  );
                  const retreat = Math.max(
                    0,
                    Math.min(1, (progress - 0.84) / 0.14),
                  );
                  const beat =
                    ((progress - 0.4) * 9 + lane * 0.17 + rank * 0.3) % 1;
                  const fighting = phase === "attack";
                  const thrust = fighting
                    ? Math.sin(Math.max(0, beat) * Math.PI * 2)
                    : 0;
                  const moving = !healing && !ranged && active;
                  const x =
                    home +
                    (moving
                      ? (contact - home) *
                          (reducedMotion
                            ? phase === "attack" || phase === "hit"
                              ? 1
                              : 0
                            : approach * (1 - retreat)) +
                        (reducedMotion ? 0 : direction * thrust * 2.3)
                      : 0);
                  const y = 32 + lane * 10 + rank * 3;
                  const lost = !healing && i >= survivors;
                  const hidden = healing && i >= survivors;
                  const pose: Pose = healing
                    ? side === 0 && progress > 0.16 && !impact
                      ? "cast"
                      : "ready"
                    : lost
                      ? "hit"
                      : moving &&
                          (phase === "run" || (retreat > 0 && retreat < 1))
                        ? "run"
                        : fighting && active
                          ? thrust < -0.5 && afterHp(unit) < unit.hp
                            ? "hit"
                            : "attack"
                          : "ready";
                  const fallAt =
                    unit.kind === "mercenary"
                      ? 0.46 +
                        ((unit.hp - i) / Math.max(1, unit.hp - afterHp(unit))) *
                          0.3
                      : 0.76;
                  const fall = lost
                    ? Math.max(0, Math.min(1, (progress - fallAt) / 0.1))
                    : 0;
                  return (
                    <div
                      key={i}
                      className={`duel-fighter ${unit.kind === "commander" ? "leader" : ""} ${lost ? "casualty" : ""}`}
                      data-x={x.toFixed(2)}
                      data-lost={lost}
                      style={{
                        left: `${x}%`,
                        top: `${y}%`,
                        zIndex: lane * 2 + rank,
                        opacity: hidden ? 0 : 1 - fall,
                        transform: `translate(${lost && !reducedMotion ? -direction * fall * 36 : 0}px, ${lost && !reducedMotion ? fall * 25 : 0}px) rotate(${lost && !reducedMotion ? -direction * fall * 75 : 0}deg)`,
                      }}
                    >
                      <Fighter
                        unit={unit}
                        frame={Math.floor(frame / 2) + i}
                        pose={pose}
                      />
                      {lost && fall < 0.8 && (
                        <span className="soldier-burst">✦</span>
                      )}
                      {fighting && !healing && active && thrust > 0.65 && (
                        <span className="soldier-spark">✧</span>
                      )}
                    </div>
                  );
                })}
                {!healing &&
                  ranged &&
                  active &&
                  phase === "attack" &&
                  Array.from({ length: 5 }, (_, i) => {
                    const flight = ((progress - 0.4) * 7 + i * 0.15) % 1;
                    return (
                      <span
                        key={i}
                        className={`soldier-projectile projectile-${side}`}
                        style={{
                          left: `${side ? 78 - flight * 60 : 18 + flight * 60}%`,
                          top: `${36 + i * 10 - Math.sin(flight * Math.PI) * 12}%`,
                        }}
                      >
                        ➶
                      </span>
                    );
                  })}
              </div>
            );
          })}
          {healing && progress >= 0.16 && progress < 0.84 && (
            <div className="spell-scene">
              <div className="spell-name">
                HEAL <span>회복</span>
              </div>
              <div
                className="spell-circle"
                style={{
                  transform: `scale(${0.6 + Math.min(1, (progress - 0.16) * 4)}) rotateX(60deg) rotate(${frame * 5}deg)`,
                }}
              />
              {Array.from({ length: 12 }, (_, i) => (
                <i
                  className="spell-mote"
                  key={i}
                  style={{
                    left: `${61 + (i % 4) * 7}%`,
                    top: `${75 - ((progress * 130 + i * 11) % 50)}%`,
                    opacity: progress > 0.4 ? 1 : 0.4,
                  }}
                >
                  ✦
                </i>
              ))}
              {progress > 0.4 && <div className="spell-pillar" />}
            </div>
          )}
          {impact &&
            participants.map((unit, index) => {
              const event = healing
                ? animation.events.find(
                    (e) => e.type === "healed" && e.unitId === unit.id,
                  )
                : damageFor(unit.id);
              const amount =
                event?.type === "damaged" || event?.type === "healed"
                  ? event.amount
                  : 0;
              return (
                <div className={`duel-damage damage-${index}`} key={index}>
                  {healing
                    ? index === 1
                      ? `+${amount}`
                      : "시전 완료"
                    : index === 0 && !returned
                      ? "반격 불가"
                      : amount
                        ? `−${amount}`
                        : "방어"}
                </div>
              );
            })}
        </div>
        <footer className="duel-footer">
          <p aria-live="polite">
            {impact
              ? participants
                  .map(
                    (u, i) =>
                      `${u.name} HP ${u.hp} → ${afterHp(u)}${!healing && i === 0 && !returned ? " (반격 불가)" : ""}`,
                  )
                  .join("　│　")
              : healing
                ? "마력을 모아 회복 마법을 시전합니다."
                : ranged
                  ? "원거리 공격을 가합니다."
                  : returned
                    ? "양측 부대가 맞붙습니다."
                    : "공격 부대가 돌격합니다."}
          </p>
          <button ref={button} onClick={skip}>
            건너뛰기 <kbd>Space</kbd>
          </button>
        </footer>
      </section>
    </div>
  );
}
