import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  canPrepare,
  effectiveUnit,
  equipmentOptions,
  type BattleState,
  type Content,
  type EquipmentSlot,
} from "@orden/core";
import "./equipment.css";
import { ItemIcon } from "./ItemIcon";

export interface EquipmentPanelProps {
  content: Content;
  state: BattleState;
  locked: boolean;
  error: string;
  close: () => void;
  equip: (unitId: string, slot: EquipmentSlot, itemId: string | null) => void;
  children?: ReactNode;
}

/** Selection stays local; every equipment change is an ordinary saved core command. */
export function EquipmentPanel(props: EquipmentPanelProps) {
  const commanders = props.state.units.filter(
    (unit) =>
      unit.kind === "commander" && unit.side === "player" && unit.hp > 0,
  );
  const [unitId, setUnitId] = useState(commanders[0]?.id ?? "");
  const [slot, setSlot] = useState<EquipmentSlot>("weapon");
  const panel = useRef<HTMLElement>(null);
  const unit =
    commanders.find((candidate) => candidate.id === unitId) ?? commanders[0];
  const view = unit
    ? effectiveUnit(props.content, props.state, unit)
    : undefined;
  const preparing = canPrepare(props.state);
  const options = unit
    ? equipmentOptions(props.content, props.state, unit, slot)
    : [];

  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <div className="modal-scrim equipment-scrim">
      <section
        ref={panel}
        tabIndex={-1}
        className="classic-window equipment-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="equipment-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" && !props.locked) props.close();
          if (event.key !== "Tab") return;
          const controls = Array.from(
            panel.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], summary",
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === panel.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last ||
              document.activeElement === panel.current)
          ) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="equipment-heading">
          <div>
            <div className="window-caption">PREPARATION / EQUIPMENT</div>
            <h2 id="equipment-title">부대 장비</h2>
          </div>
          <button onClick={props.close} disabled={props.locked}>
            전투로 돌아가기
          </button>
        </div>
        <p className="equipment-guidance">
          {preparing
            ? "첫 전투 행동 전까지 장비를 준비할 수 있습니다. 변경은 바로 저장됩니다."
            : "전투가 시작되어 장비 변경이 잠겼습니다. 현재 장비와 보관함을 확인할 수 있습니다."}
        </p>
        {props.error && (
          <p role="alert" className="equipment-error">
            {props.error}
          </p>
        )}
        {unit && view ? (
          <div className="equipment-layout">
            <aside className="equipment-unit">
              <label>
                지휘관
                <select
                  aria-label="장비 지휘관"
                  value={unit.id}
                  onChange={(event) => setUnitId(event.target.value)}
                  disabled={props.locked}
                >
                  {commanders.map((commander) => (
                    <option key={commander.id} value={commander.id}>
                      {commander.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="equipment-slots" aria-label="장착 슬롯">
                {(["weapon", "armor"] as const).map((value) => {
                  const item = props.content.items.find(
                    (candidate) => candidate.id === unit.equipment?.[value],
                  );
                  return (
                    <div key={value} className={value === slot ? "active" : ""}>
                      <button
                        aria-pressed={value === slot}
                        onClick={() => setSlot(value)}
                      >
                        <small>
                          {value === "weapon" ? "무기" : "방어구 · 장신구"}
                        </small>
                        <strong className="asset-item-name">
                          <ItemIcon itemId={item?.id} />
                          {item?.name ?? "미장착"}
                        </strong>
                      </button>
                      {item && (
                        <button
                          className="equipment-remove"
                          aria-label={`${value === "weapon" ? "무기" : "방어구"} 해제`}
                          disabled={props.locked || !preparing}
                          onClick={() => props.equip(unit.id, value, null)}
                        >
                          해제
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <dl className="equipment-stats" aria-label="장비 적용 능력치">
                <div>
                  <dt>AT / DF</dt>
                  <dd>
                    {view.stats.at} / {view.stats.df}
                  </dd>
                </div>
                <div>
                  <dt>MAG / RES</dt>
                  <dd>
                    {view.stats.mag} / {view.stats.res}
                  </dd>
                </div>
                <div>
                  <dt>이동</dt>
                  <dd>{view.stats.move}</dd>
                </div>
                <div>
                  <dt>물리 사거리</dt>
                  <dd>
                    {view.range[0]}–{view.range[1]}
                  </dd>
                </div>
                <div>
                  <dt>MP</dt>
                  <dd>
                    {unit.mp} / {view.stats.maxMp}
                  </dd>
                </div>
                {view.command && (
                  <>
                    <div>
                      <dt>지휘 반경</dt>
                      <dd>{view.command.radius}</dd>
                    </div>
                    <div>
                      <dt>지휘 AT / DF</dt>
                      <dd>
                        +{view.command.at} / +{view.command.df}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              <p className="equipment-note">
                장비는 지휘관 한 명당 무기 1개와 방어구·장신구 1개를 장착합니다.
                같은 소유품을 여러 지휘관이 공유할 수 없습니다.
              </p>
            </aside>
            <div className="equipment-inventory">
              <h3>
                {slot === "weapon" ? "무기 보관함" : "방어구 · 장신구 보관함"}
              </h3>
              <ul aria-label="장비 보관함">
                {options.map(({ item, owned, available, equipped, reason }) => (
                  <li key={item.id} className={equipped ? "equipped" : ""}>
                    <div className="equipment-item-top">
                      <strong className="asset-item-name">
                        <ItemIcon itemId={item.id} />
                        {item.name}
                      </strong>
                      <span>
                        {equipped
                          ? "장착 중"
                          : `보유 ${owned} · 남음 ${available}`}
                      </span>
                    </div>
                    <p>{item.description}</p>
                    <div className="equipment-item-action">
                      <small>{reason ?? "장착 가능"}</small>
                      <button
                        disabled={props.locked || !!reason}
                        aria-label={`${item.name} 장착`}
                        onClick={() => props.equip(unit.id, slot, item.id)}
                      >
                        {equipped ? "장착 중" : "장착"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p>장비를 확인할 아군 지휘관이 없습니다.</p>
        )}
        {props.children}
      </section>
    </div>
  );
}
