import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { BattleAnimation } from "../game/BattleAnimation";
import { inAttackRange, type Unit } from "@orden/core";
import { soldier, rider } from "../game/pixelUnits";
import { Portrait } from "./Portrait";

type Pose = "ready" | "run" | "attack" | "hit";
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
    pose === "attack" ? (frame % 3 === 0 ? -55 : frame % 3 === 1 ? 25 : 75) : 0;
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
          {unit.unitType === "archer" ? (
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
  const progress = frame / 40;
  const impact = progress >= 0.68;
  const phase =
    progress < 0.16
      ? "ready"
      : progress < 0.4
        ? "run"
        : progress < 0.68
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
          40,
          Math.floor(((performance.now() - start) / animation.impactMs) * 40),
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
  if (cmd.type !== "act" || cmd.action.type !== "attack") return null;
  const targetId = cmd.action.targetId;
  const attacker = animation.before.units.find((u) => u.id === cmd.unitId)!;
  const defender = animation.before.units.find((u) => u.id === targetId)!;
  const participants = [attacker, defender];
  const returned = inAttackRange(defender, {
    ...attacker,
    pos: cmd.path.at(-1) ?? attacker.pos,
  });
  const damageFor = (id: string) =>
    animation.events.find((e) => e.type === "damaged" && e.unitId === id);
  const afterHp = (unit: Unit) =>
    animation.after.units.find((u) => u.id === unit.id)?.hp ?? 0;
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
                run: "돌격",
                attack: "공격 · 반격",
                hit: "피격",
                result: "교전 결과",
              }[phase]
            }
          </small>
        </header>
        <div className="duel-status">
          {participants.map((unit, index) => (
            <div
              className={`duel-unit ${index ? "defender" : "attacker"}`}
              key={unit.id}
            >
              <Portrait unit={unit} />
              <div>
                <small>
                  {index ? "방어 부대" : "공격 부대"} ·{" "}
                  {unit.kind === "commander" ? "지휘관" : "병력"}
                </small>
                <h2>{unit.name}</h2>
                <div
                  className="duel-hp"
                  aria-label={`${index ? "방어" : "공격"} HP`}
                >
                  <b>{impact ? afterHp(unit) : unit.hp}</b>
                  <span>/ 10</span>
                </div>
                <div className="duel-hp-bar">
                  <i
                    style={{
                      width: `${(impact ? afterHp(unit) : unit.hp) * 10}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div
          className={`duel-stage phase-${phase} ${impact ? "impact" : ""}`}
          data-phase={phase}
          data-frame={frame}
          aria-hidden="true"
        >
          <div className="duel-cloud cloud-one" />
          <div className="duel-cloud cloud-two" />
          <div className="duel-hills" />
          <div className="duel-ground" />
          {participants.map((unit, side) => {
            const count = unit.kind === "mercenary" ? unit.hp : 1;
            const survivors =
              unit.kind === "mercenary"
                ? afterHp(unit)
                : afterHp(unit) > 0
                  ? 1
                  : 0;
            return (
              <div
                key={unit.id}
                className={`duel-army army-${side} ${unit.range[0] > 1 ? "ranged" : ""} ${side === 1 && !returned ? "no-counter" : ""}`}
              >
                {Array.from({ length: count }, (_, i) => (
                  <div
                    className={`duel-fighter ${unit.kind === "commander" ? "leader" : ""} ${impact && i >= survivors ? "fallen" : ""}`}
                    key={i}
                    style={
                      {
                        left: `${(i % 3) * 27}%`,
                        top: `${Math.floor(i / 3) * 17}%`,
                        "--fighter-delay": `${i * 18}ms`,
                      } as CSSProperties
                    }
                  >
                    <Fighter
                      unit={unit}
                      frame={frame + i}
                      pose={
                        phase === "run" &&
                        unit.range[0] <= 1 &&
                        (side === 0 || returned)
                          ? "run"
                          : phase === "attack" && (side === 0 || returned)
                            ? "attack"
                            : phase === "hit" && afterHp(unit) < unit.hp
                              ? "hit"
                              : "ready"
                      }
                    />
                  </div>
                ))}
              </div>
            );
          })}
          <div className="duel-clash">✦</div>
          {attacker.range[0] > 1 && <div className="duel-arrows">➶　➶　➶</div>}
          {impact &&
            participants.map((unit, index) => {
              const event = damageFor(unit.id);
              const amount = event?.type === "damaged" ? event.amount : 0;
              return (
                <div className={`duel-damage damage-${index}`} key={unit.id}>
                  {index === 0 && !returned
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
                      `${u.name} HP ${u.hp} → ${afterHp(u)}${i === 0 && !returned ? " (반격 불가)" : ""}`,
                  )
                  .join("　│　")
              : "양측 부대가 맞붙습니다."}
          </p>
          <button ref={button} onClick={skip}>
            건너뛰기 <kbd>Space</kbd>
          </button>
        </footer>
      </section>
    </div>
  );
}
