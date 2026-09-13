import { useEffect, useRef, useState } from "react";
import { content } from "@orden/content";
import {
  canPrepare,
  hireOptions,
  operationSummary,
  shopOptions,
  type BattleState,
} from "@orden/core";
import "./operation.css";

export interface OperationPanelProps {
  state: BattleState;
  locked: boolean;
  error: string;
  close: () => void;
  hire: (unitId: string, templateId: string | null) => void;
  trade: (type: "buy" | "sell", itemId: string) => void;
  startBattle: () => void;
  openEquipment: () => void;
  openGrowth: () => void;
}
const moveNames = {
  foot: "보행",
  mounted: "기승",
  flying: "비행",
  amphibious: "수륙",
};

/** Prices, discounts, budget checks and eligibility are entirely core queries. */
export function OperationPanel(props: OperationPanelProps) {
  const panel = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<"hire" | "shop">("hire");
  const [commanderId, setCommanderId] = useState(
    props.state.progression.roster[0]?.id ?? "",
  );
  const [slotId, setSlotId] = useState<string | null>(null);
  const [shopSlot, setShopSlot] = useState<"weapon" | "armor">("weapon");
  const summary = operationSummary(content, props.state);
  const preparing = canPrepare(props.state);
  const commander =
    props.state.progression.roster.find((unit) => unit.id === commanderId) ??
    props.state.progression.roster[0];
  const slots =
    summary?.slots.filter((slot) => slot.commanderId === commander?.id) ?? [];
  const selected = slots.find((slot) => slot.unitId === slotId) ?? slots[0];
  const options = selected
    ? hireOptions(content, props.state, selected.unitId)
    : [];
  const offers = shopOptions(content, props.state).filter(
    (offer) => offer.item.slot === shopSlot,
  );
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <div className="modal-scrim operation-scrim">
      <section
        ref={panel}
        tabIndex={-1}
        className="classic-window operation-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" && !props.locked) props.close();
          if (event.key !== "Tab") return;
          const controls = Array.from(
            panel.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled),select:not(:disabled),input:not(:disabled),a[href],summary",
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = controls[0],
            last = controls.at(-1);
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
        <header className="operation-heading">
          <div>
            <div className="window-caption">OPERATION / PREPARATION</div>
            <h2 id="operation-title">작전 준비</h2>
          </div>
          <button onClick={props.close} disabled={props.locked}>
            전장 보기
          </button>
        </header>
        {!summary ? (
          <p>정식 작전에서 편성과 상점을 사용할 수 있습니다.</p>
        ) : (
          <>
            <p className="operation-guidance">
              {preparing
                ? "용병을 편성하고 장비와 성장을 확인한 뒤 출격을 확정하세요. 변경은 바로 저장됩니다."
                : "출격이 확정되어 편성과 거래가 잠겼습니다. 현재 편성과 정산 내역을 확인할 수 있습니다."}
            </p>
            {props.error && (
              <p role="alert" className="operation-error">
                {props.error}
              </p>
            )}
            <dl className="operation-budget" aria-label="작전 자금">
              <div>
                <dt>이번 작전비</dt>
                <dd>{summary.budget}</dd>
              </div>
              <div>
                <dt>편성 사용액</dt>
                <dd>{summary.spent}</dd>
              </div>
              <div
                className={summary.remaining < 0 ? "over-budget" : undefined}
              >
                <dt>남은 작전비</dt>
                <dd>{summary.remaining}</dd>
              </div>
              <div>
                <dt>장비 자금</dt>
                <dd>{summary.equipmentFunds}</dd>
              </div>
            </dl>
            <p className="operation-money-note">
              작전비는 이번 출격의 용병 편성에 사용하고, 장비 자금은 아이템
              구매와 판매에 사용합니다.
              {summary.pendingSupport > 0
                ? ` 다음 출격 지원금 ${summary.pendingSupport}이 대기 중입니다.`
                : ""}
            </p>
            <div className="operation-shortcuts">
              <button onClick={props.openEquipment} disabled={props.locked}>
                장비 · 마법 편성
              </button>
              <button onClick={props.openGrowth} disabled={props.locked}>
                성장 · 전직 · 마스터리
              </button>
            </div>
            {summary.settlement && (
              <section
                className="operation-settlement"
                aria-label="작전 보상 정산"
              >
                <h3>
                  {props.state.outcome?.status === "defeat"
                    ? "패배 정산"
                    : summary.settlement.firstClear
                      ? "첫 승리 작전 보상"
                      : "재연습 정산"}
                </h3>
                <p>
                  장비 자금 +{summary.settlement.equipmentFunds} · 다음 출격
                  지원 +{summary.settlement.support}
                </p>
                <p>
                  획득 아이템:{" "}
                  {Object.entries(summary.settlement.items)
                    .map(
                      ([id, count]) =>
                        `${content.items.find((item) => item.id === id)?.name ?? id} ${count}개`,
                    )
                    .join(" · ") || "없음"}
                </p>
                {summary.settlement.contracts.length > 0 && (
                  <p>
                    생존 계약:{" "}
                    {summary.settlement.contracts
                      .map(
                        (contract) =>
                          `${props.state.progression.roster.find((unit) => unit.id === contract.commanderId)?.name ?? contract.commanderId} ${content.mercenaryTemplates.find((template) => template.id === contract.templateId)?.name ?? contract.templateId} ${contract.count}기`,
                      )
                      .join(" · ")}
                  </p>
                )}
                <p>
                  {props.state.outcome?.status === "defeat"
                    ? "재도전하면 이번 준비 전의 자금·장비·편성과 성장으로 돌아갑니다."
                    : "첫 승리 보상은 다시 지급하지 않습니다. 생존 계약은 다음 출격에서 같은 지휘관과 병종의 고용 비용을 줄입니다."}
                </p>
              </section>
            )}
            <div className="operation-tabs" aria-label="작전 준비 보기">
              <button
                aria-pressed={tab === "hire"}
                onClick={() => setTab("hire")}
              >
                용병 편성
              </button>
              <button
                aria-pressed={tab === "shop"}
                onClick={() => setTab("shop")}
              >
                장비 상점
              </button>
            </div>
            {tab === "hire" ? (
              <div className="operation-hiring">
                <aside className="operation-squad">
                  <label>
                    지휘관
                    <select
                      value={commander?.id ?? ""}
                      onChange={(event) => {
                        setCommanderId(event.target.value);
                        setSlotId(null);
                      }}
                      disabled={props.locked}
                      aria-label="편성 지휘관"
                    >
                      {props.state.progression.roster.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    {
                      content.classes.find(
                        (job) => job.id === commander?.progression?.classId,
                      )?.name
                    }{" "}
                    · 고용 가능 병종은 현재 직업에 따라 달라집니다.
                  </p>
                  <div
                    className="operation-positions"
                    aria-label="용병 배치 슬롯"
                  >
                    {slots.map((slot, index) => (
                      <button
                        key={slot.unitId}
                        aria-pressed={selected?.unitId === slot.unitId}
                        aria-label={`${commander?.name} 용병 자리 ${index + 1}`}
                        onClick={() => setSlotId(slot.unitId)}
                        disabled={props.locked}
                      >
                        <small>자리 {index + 1}</small>
                        <strong>{slot.template?.name ?? "빈 자리"}</strong>
                        <span>
                          {slot.template
                            ? `${slot.cost} 작전비${slot.discounted ? " · 생존 할인" : ""}`
                            : "출격하지 않음"}
                        </span>
                      </button>
                    ))}
                  </div>
                  {selected && (
                    <button
                      className="operation-remove"
                      onClick={() => props.hire(selected.unitId, null)}
                      disabled={
                        props.locked ||
                        !preparing ||
                        selected.templateId === null
                      }
                    >
                      선택 자리 비우기
                    </button>
                  )}
                  <p>
                    빈 자리는 출격하지 않습니다. 편성한 용병은 정해진 출발
                    위치에서 시작합니다.
                  </p>
                </aside>
                <section
                  className="operation-hire-options"
                  aria-label="고용 가능한 용병"
                >
                  <h3>
                    {selected
                      ? `${selected.name} 자리의 병종 선택`
                      : "지휘관의 용병 자리를 선택하세요."}
                  </h3>
                  <ul>
                    {options.map((option) => (
                      <li
                        key={option.template.id}
                        className={option.selected ? "selected" : undefined}
                      >
                        <div className="operation-offer-heading">
                          <strong>{option.template.name}</strong>
                          <span>
                            {option.cost} 작전비
                            {option.discounted && <small>생존 계약 할인</small>}
                          </span>
                        </div>
                        <p>
                          AT {option.template.stats.at} · DF{" "}
                          {option.template.stats.df} · RES{" "}
                          {option.template.stats.res} ·{" "}
                          {moveNames[option.template.moveType]}{" "}
                          {option.template.stats.move} · 사거리{" "}
                          {option.template.range.join("–")}
                        </p>
                        <p>
                          이 편성의 총사용액 {option.totalCost} · 남음{" "}
                          {option.remaining}
                        </p>
                        <div className="operation-offer-action">
                          <small>{option.reason ?? "편성 가능"}</small>
                          <button
                            disabled={props.locked || !!option.reason}
                            aria-label={`${option.template.name} 고용`}
                            onClick={() =>
                              props.hire(selected!.unitId, option.template.id)
                            }
                          >
                            {option.selected ? "편성 중" : "고용"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            ) : (
              <section className="operation-shop" aria-label="작전 장비 상점">
                <div className="operation-shop-filter">
                  <button
                    aria-pressed={shopSlot === "weapon"}
                    onClick={() => setShopSlot("weapon")}
                  >
                    무기
                  </button>
                  <button
                    aria-pressed={shopSlot === "armor"}
                    onClick={() => setShopSlot("armor")}
                  >
                    방어구 · 장신구
                  </button>
                </div>
                <p>
                  한 번에 1개씩 거래합니다. 장착 중인 아이템은 해제한 뒤 판매할
                  수 있습니다.
                </p>
                <ul>
                  {offers.map((offer) => (
                    <li key={offer.item.id}>
                      <div className="operation-offer-heading">
                        <strong>{offer.item.name}</strong>
                        <span>
                          보유 {offer.owned} · 미장착 {offer.available}
                        </span>
                      </div>
                      <p>{offer.item.description}</p>
                      <div className="operation-shop-trades">
                        <div>
                          <button
                            disabled={props.locked || !!offer.buyReason}
                            onClick={() => props.trade("buy", offer.item.id)}
                            aria-label={`${offer.item.name} 구매`}
                          >
                            구매 {offer.buyPrice}
                          </button>
                          <small>{offer.buyReason ?? "1개 구매 가능"}</small>
                        </div>
                        <div>
                          <button
                            disabled={props.locked || !!offer.sellReason}
                            onClick={() => props.trade("sell", offer.item.id)}
                            aria-label={`${offer.item.name} 판매`}
                          >
                            판매 {offer.sellPrice}
                          </button>
                          <small>
                            {offer.sellReason ?? "미장착 1개 판매 가능"}
                          </small>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <footer className="operation-start">
              <p>
                {summary.startReason ??
                  "현재 편성으로 출격할 수 있습니다. 확정하면 전투가 끝날 때까지 편성과 거래가 잠깁니다."}
              </p>
              <button
                disabled={props.locked || !!summary.startReason}
                onClick={props.startBattle}
              >
                출격 확정
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
