import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { BattleAnimation } from "../game/BattleAnimation";
import { inAttackRange, type Unit } from "@orden/core";
import { soldier, rider } from "../game/pixelUnits";
import { Portrait } from "./Portrait";

function Fighter({ unit }: { unit: Unit }) {
  const mounted = unit.moveType === "mounted";
  const pattern = mounted ? rider : soldier;
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
      viewBox={`0 0 ${mounted ? 16 : 12} 16`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {unit.moveType === "flying" && (
        <path fill="#dbdfc8" d="M0 3h4v7H1zM9 3h3v7H9z" />
      )}
      {pattern.flatMap((row, y) =>
        [...row].flatMap((ink, x) =>
          ink === "." ? (
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
      {unit.unitType === "pike" && <path fill="#e2dcb7" d="M11 0h1v15h-1z" />}
      {unit.unitType === "archer" && (
        <path d="M10 3l2 4-2 5" stroke="#bc9162" fill="none" />
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
  const [impact, setImpact] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    button.current?.focus();
    const timer = window.setTimeout(
      () => setImpact(true),
      animation.impactMs * 0.54,
    );
    return () => {
      window.clearTimeout(timer);
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
          <small>{impact ? "교전 결과" : "부대 교전"}</small>
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
          className={`duel-stage ${impact ? "impact" : ""}`}
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
                    style={{
                      left: `${(i % 3) * 27}%`,
                      top: `${Math.floor(i / 3) * 17}%`,
                    }}
                  >
                    <Fighter unit={unit} />
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
