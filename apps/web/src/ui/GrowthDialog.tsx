import { useEffect, useRef } from "react";
import { content } from "@orden/content";
import type { BattleState } from "@orden/core";
import { GrowthPanel } from "./GrowthPanel";

export function GrowthDialog({
  state,
  locked,
  error,
  close,
  promote,
  reclass,
  mastery,
  deploy,
}: {
  state: BattleState;
  locked: boolean;
  error: string;
  close: () => void;
  promote: (unitId: string, classId: string) => void;
  reclass: (unitId: string) => void;
  mastery: (unitId: string, masteryId: string | null) => void;
  deploy: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div className="modal-scrim growth-scrim">
      <section
        ref={panel}
        tabIndex={-1}
        className="classic-window growth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="growth-dialog-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" && !locked) close();
          if (event.key !== "Tab") return;
          const controls = Array.from(
            panel.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled),select:not(:disabled),input:not(:disabled),a[href],summary",
            ),
          ).filter((el) => el.getClientRects().length > 0);
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
        <div className="growth-dialog-heading">
          <h2 id="growth-dialog-title">성장 · 전직</h2>
          <button onClick={close} disabled={locked}>
            닫기
          </button>
        </div>
        <GrowthPanel
          content={content}
          state={state}
          locked={locked}
          error={error}
          promote={promote}
          reclass={reclass}
          mastery={mastery}
        />
        {state.outcome && (
          <div className="growth-deploy">
            <p>
              획득한 성장과 장비로 같은 맵에 다시 출격합니다. 이미 클리어한 맵의
              경험치는 추가 지급하지 않습니다.
            </p>
            <button onClick={deploy} disabled={locked}>
              {state.outcome.status === "victory"
                ? "성장한 부대로 다시 연습"
                : "성장을 유지하고 다시 도전"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
