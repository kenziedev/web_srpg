import { useState } from "react";
import {
  commanderGrowth,
  type BattleState,
  type ClassChangeOption,
  type Content,
} from "@orden/core";
import "./growth.css";

export interface GrowthPanelProps {
  content: Content;
  state: BattleState;
  locked: boolean;
  error?: string;
  promote: (unitId: string, classId: string) => void;
  reclass: (unitId: string) => void;
}
const movementNames = {
  foot: "보행",
  mounted: "기승",
  flying: "비행",
  amphibious: "수륙",
};
const unitNames = {
  infantry: "보병",
  pike: "창병",
  cavalry: "기병",
  archer: "궁병",
  flier: "비병",
  sailor: "수병",
  cleric: "성직병",
  undead: "불사",
  mage: "마법사",
  neutral: "중립",
};
const statNames = {
  at: "AT",
  df: "DF",
  mag: "MAG",
  res: "RES",
  maxMp: "최대 MP",
};

function ClassCard({
  option,
  content,
  locked,
  commit,
}: {
  option: ClassChangeOption;
  content: Content;
  locked: boolean;
  commit: () => void;
}) {
  const { before, after, definition } = option;
  const spellNames = option.learnedSpellIds.map(
    (id) => content.spells.find((spell) => spell.id === id)?.name ?? id,
  );
  const laterSpells = definition.learns.filter(
    (entry) => entry.level > after.progression!.level,
  );
  return (
    <li className="growth-class" aria-label={`${definition.name} 전직 비교`}>
      <h4>{definition.name}</h4>
      <p>{definition.description}</p>
      <dl className="growth-comparison">
        <div>
          <dt>병종</dt>
          <dd>
            {unitNames[before.unitType]} → {unitNames[after.unitType]}
          </dd>
        </div>
        <div>
          <dt>이동</dt>
          <dd>
            {movementNames[before.moveType]} {before.stats.move} →{" "}
            {movementNames[after.moveType]} {after.stats.move}
          </dd>
        </div>
        <div>
          <dt>물리 사거리</dt>
          <dd>
            {before.range.join("–")} → {after.range.join("–")}
          </dd>
        </div>
        <div>
          <dt>지휘 반경</dt>
          <dd>
            {before.command?.radius ?? 0} → {after.command?.radius ?? 0}
          </dd>
        </div>
        <div>
          <dt>지휘 AT / DF</dt>
          <dd>
            +{before.command?.at ?? 0} / +{before.command?.df ?? 0} → +
            {after.command?.at ?? 0} / +{after.command?.df ?? 0}
          </dd>
        </div>
        {(["at", "df", "mag", "res", "maxMp"] as const).map((stat) => (
          <div key={stat}>
            <dt>{statNames[stat]}</dt>
            <dd>
              {before.stats[stat]} → {after.stats[stat]}
            </dd>
          </div>
        ))}
        <div>
          <dt>전직 직후</dt>
          <dd>
            Lv{after.progression!.level} · EXP {after.progression!.exp}/100
          </dd>
        </div>
        <div>
          <dt>소모품</dt>
          <dd>{option.consumedItemId ? "룬스톤 1개" : "없음"}</dd>
        </div>
      </dl>
      <p>
        새로 배우는 마법: {spellNames.length ? spellNames.join(" · ") : "없음"}
      </p>
      {laterSpells.length > 0 && (
        <small>
          직업 학습:{" "}
          {laterSpells
            .map(
              (entry) =>
                `Lv${entry.level} ${entry.spellIds.map((id) => content.spells.find((spell) => spell.id === id)?.name ?? id).join(" · ")}`,
            )
            .join(" / ")}
        </small>
      )}
      {option.unequippedItemIds.length > 0 && (
        <small>
          병종 제한으로 해제:{" "}
          {option.unequippedItemIds
            .map(
              (id) => content.items.find((item) => item.id === id)?.name ?? id,
            )
            .join(" · ")}
        </small>
      )}
      <small>
        {option.reason ??
          (option.reset
            ? "기존 성장·학습을 유지하며 보관 EXP는 초기화합니다."
            : "확정하면 현재 직업의 다른 분기로 바꿀 수 없습니다.")}
      </small>
      <button
        disabled={locked || !!option.reason}
        onClick={commit}
        aria-label={
          option.reset ? "룬스톤 사용 확정" : `${definition.name} 전직 확정`
        }
      >
        {option.reset ? "룬스톤 사용 확정" : `${definition.name} 전직 확정`}
      </button>
    </li>
  );
}

/** The panel displays core comparisons and dispatches ordinary persisted commands. */
export function GrowthPanel(props: GrowthPanelProps) {
  const commanders = props.state.progression.roster;
  const [selectedId, setSelectedId] = useState(commanders[0]?.id ?? "");
  const unitId = commanders.some((unit) => unit.id === selectedId)
    ? selectedId
    : (commanders[0]?.id ?? "");
  const growth = commanderGrowth(props.content, props.state, unitId);
  if (!growth)
    return (
      <section className="growth-panel">
        <p>성장 기록이 있는 지휘관이 없습니다.</p>
      </section>
    );
  const profile = growth.unit.progression!;
  const settlement = props.state.progression.settlement;
  const entry = growth.settlement;
  const learned = profile.learnedSpellIds.map(
    (id) => props.content.spells.find((spell) => spell.id === id)?.name ?? id,
  );
  return (
    <section className="growth-panel" aria-labelledby="growth-panel-title">
      <div className="growth-heading">
        <div>
          <div className="window-caption">GROWTH / CLASS CHANGE</div>
          <h3 id="growth-panel-title">지휘관 성장과 전직</h3>
        </div>
        <label>
          성장 지휘관
          <select
            value={unitId}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={props.locked}
            aria-label="성장 지휘관"
          >
            {commanders.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {props.error && (
        <p role="alert" className="equipment-error">
          {props.error}
        </p>
      )}
      <dl className="growth-summary" aria-label="현재 성장 기록">
        <div>
          <dt>현재 직업</dt>
          <dd>{growth.definition?.name ?? profile.classId}</dd>
        </div>
        <div>
          <dt>직업 레벨</dt>
          <dd>Lv{profile.level} / 10</dd>
        </div>
        <div>
          <dt>{profile.level === 10 ? "보관 EXP" : "현재 EXP"}</dt>
          <dd>{profile.exp} / 100</dd>
        </div>
        <div>
          <dt>누적 획득 EXP</dt>
          <dd>{profile.totalExp}</dd>
        </div>
      </dl>
      <div className="growth-progress">
        <progress
          max={100}
          value={profile.exp}
          aria-label={profile.level === 10 ? "보관 경험치" : "현재 레벨 경험치"}
        />
        <span>
          {profile.level === 10
            ? "전직 가능 레벨"
            : `다음 레벨까지 ${growth.remainingExp} EXP`}
        </span>
      </div>
      {!settlement && (
        <p className="growth-notice">
          {props.state.progression.rewardedScenarioIds.includes(
            props.content.scenario.id,
          )
            ? "이미 클리어한 맵의 연습 전투입니다. 추가 EXP는 지급하지 않습니다."
            : `현재 전투 기여 ${growth.pendingExp} EXP · 승리 시 한 번 정산합니다.`}
          전투 중 레벨과 능력치는 변하지 않습니다.
        </p>
      )}
      {settlement && (
        <div className="growth-earned" aria-label="전투 성장 정산">
          <h4>
            {settlement.outcome === "defeat"
              ? "패배: 기여 EXP 폐기"
              : settlement.duplicate
                ? "이미 보상을 받은 연습 전투"
                : "승리 성장 정산 완료"}
          </h4>
          {entry && (
            <>
              <p>
                획득 {entry.awardedExp} EXP · Lv{entry.previousLevel} → Lv
                {entry.level} · EXP {entry.previousExp} → {entry.exp}
              </p>
              <ul>
                <li>
                  피해 {entry.earned.damage} · 직접 격파 {entry.earned.kills} ·
                  퇴각 {entry.earned.retreats} · 회복 {entry.earned.healing} ·
                  클리어 {entry.earned.clear}
                </li>
                <li>
                  능력치 성장:{" "}
                  {Object.entries(entry.statGains)
                    .filter(([, value]) => value)
                    .map(
                      ([stat, value]) =>
                        `${statNames[stat as keyof typeof statNames]} +${value}`,
                    )
                    .join(" · ") || "없음"}
                </li>
                <li>
                  새로 배운 마법:{" "}
                  {entry.learnedSpellIds
                    .map(
                      (id) =>
                        props.content.spells.find((spell) => spell.id === id)
                          ?.name ?? id,
                    )
                    .join(" · ") || "없음"}
                </li>
              </ul>
            </>
          )}
          <p>
            {settlement.outcome === "defeat" && !settlement.duplicate
              ? "다시 도전해 처음 승리하면 EXP를 정산합니다. 이전에 얻은 성장은 유지됩니다."
              : "같은 맵을 다시 출격해도 EXP를 추가로 받지 않습니다."}
          </p>
        </div>
      )}
      <div className="growth-earned">
        <h4>정식 학습 마법</h4>
        <p>{learned.join(" · ") || "없음"}</p>
        <p>
          직업과 레벨로 배운 마법입니다. 전투 준비의 연습 마법 편성과 별도로
          보존됩니다.
        </p>
      </div>
      <p>
        전직은 직업 Lv10에 전투 시작 전 또는 승리 정산 뒤 확정할 수 있습니다.
        후보 수치는 현재 성장·장비를 기준으로 비교합니다.
      </p>
      <ul className="growth-classes" aria-label="전직 후보">
        {growth.options.map((option) => (
          <ClassCard
            key={option.definition.id}
            option={option}
            content={props.content}
            locked={props.locked}
            commit={() => props.promote(unitId, option.definition.id)}
          />
        ))}
        {growth.reset && (
          <ClassCard
            option={growth.reset}
            content={props.content}
            locked={props.locked}
            commit={() => props.reclass(unitId)}
          />
        )}
      </ul>
      <p className="growth-notice">
        전직에는 지휘관별 EXP를 모아 Lv10에 도달해야 합니다. 현재는 첫 맵만
        제공하며, 이후 장과 고용·마스터리는 아직 연결되지 않았습니다.
      </p>
    </section>
  );
}
