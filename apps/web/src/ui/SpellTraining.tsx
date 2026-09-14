import { useEffect, useState } from "react";
import { content } from "@orden/content";
import { canPrepare, effectiveUnit, type BattleState } from "@orden/core";
import { spellShapeLabel, spellEffectLabel } from "./spellLabels";
import { SpellIcon } from "./SpellIcon";

/** The core validates the selected loadout against the current mode and learning. */
export function SpellTraining({
  state,
  locked,
  train,
}: {
  state: BattleState;
  locked: boolean;
  train: (unitId: string, spellIds: string[]) => void;
}) {
  const casters = state.units.filter(
    (unit) =>
      unit.side === "player" &&
      unit.kind === "commander" &&
      !unit.summon &&
      unit.stats.maxMp > 0,
  );
  const [casterId, setCasterId] = useState(casters[0]?.id ?? "");
  const caster = casters.find((unit) => unit.id === casterId) ?? casters[0];
  const [ids, setIds] = useState<string[]>(caster?.spellIds ?? []);
  const learnedKey = JSON.stringify(caster?.spellIds ?? []);
  useEffect(() => {
    setIds(JSON.parse(learnedKey) as string[]);
  }, [caster?.id, learnedKey]);
  if (!caster) return null;
  const disabled = locked || !canPrepare(state);
  const cap = effectiveUnit(content, state, caster).stats.maxMp;
  return (
    <section
      className="spell-training"
      aria-label={
        state.mode === "operation" ? "학습 마법 편성" : "연습 마법 편성"
      }
    >
      <h3>
        {state.mode === "operation" ? "학습 마법 편성" : "연습 마법 편성"}
      </h3>
      <p>
        {state.mode === "operation"
          ? "직업과 레벨로 배운 마법 중 사용할 것을 선택합니다."
          : "연습에서는 학습 여부와 관계없이 사용할 마법을 선택합니다."}
        편성을 바꿔도 MP는 회복되지 않습니다.
      </p>
      <label>
        마법 지휘관{" "}
        <select
          value={caster.id}
          onChange={(event) => setCasterId(event.target.value)}
          disabled={locked}
        >
          {casters.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
      </label>
      <p>
        현재 MP {caster.mp} / 최대 {cap} · 장비 소환은 해당 장비를 착용하면
        추가됩니다.
      </p>
      <div className="training-spells">
        {content.spells
          .filter((spell) => spell.learnable !== false)
          .filter(
            (spell) =>
              state.mode !== "operation" ||
              caster.progression?.learnedSpellIds.includes(spell.id),
          )
          .map((spell) => (
            <label key={spell.id} title={spellEffectLabel(spell)}>
              <input
                type="checkbox"
                aria-label={`${spell.name} 편성`}
                checked={ids.includes(spell.id)}
                disabled={disabled}
                onChange={(event) =>
                  setIds(
                    event.target.checked
                      ? [...ids, spell.id]
                      : ids.filter((id) => id !== spell.id),
                  )
                }
              />
              <SpellIcon spellId={spell.id} />
              <span className="training-spell-description">
                {spell.name}
                <small>
                  MP {spell.mpCost} · {spellShapeLabel(spell)}
                  {spell.mpCost > cap ? " · 최대 MP 부족" : ""}
                </small>
              </span>
            </label>
          ))}
      </div>
      <button
        disabled={
          disabled || JSON.stringify(ids) === JSON.stringify(caster.spellIds)
        }
        onClick={() => train(caster.id, ids)}
      >
        마법 편성 적용
      </button>
    </section>
  );
}
