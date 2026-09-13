import { useEffect, useRef, type ReactNode } from "react";
import type { StoredSaveSlot } from "../storage/battleSaveStore";

interface Props {
  status: string;
  error: string;
  notice: string;
  savedAt: string | null;
  locked: boolean;
  close: () => void;
  exportSave: () => void;
  exportStoredSave: (slot: StoredSaveSlot) => void;
  importSave: (file: File) => void;
  restorePrevious: () => void;
  retry: () => void;
  exportLegacySave: (slot: "latest" | "previous") => void;
  children?: ReactNode;
  modeLabel: string;
  commandCount: number;
}

export function SavePanel(props: Props) {
  const panel = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div className="modal-scrim save-scrim">
      <section
        ref={panel}
        tabIndex={-1}
        className="classic-window save-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" && !props.locked) props.close();
          if (event.key !== "Tab") return;
          const buttons = Array.from(
            panel.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled), summary",
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = buttons[0];
          const last = buttons.at(-1);
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
        <div className="window-caption">SAVE / RECOVERY</div>
        <h2 id="save-title">전투 저장 · 복구</h2>
        <p>
          {props.modeLabel} · 명령 {props.commandCount}/1024 · 모드와 실행
          규칙별로 저장합니다.
        </p>
        <p data-testid="save-panel-status" aria-live="polite">
          {props.status}
        </p>
        {props.savedAt && (
          <p className="save-time">
            마지막 저장: {new Date(props.savedAt).toLocaleString("ko-KR")}
          </p>
        )}
        {props.error && (
          <p className="save-error">
            {props.error} 현재 전투는 파일로 백업할 수 있습니다.
          </p>
        )}
        <p>
          확정한 행동과 턴 진행을 자동 저장합니다. 이동 미리보기는 저장하지
          않습니다. 이 창을 열어 둔 동안 자동 행동은 멈춥니다.
        </p>
        <div className="save-actions">
          <button onClick={props.exportSave} disabled={props.locked}>
            파일 내보내기
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={props.locked}
          >
            파일 가져오기
          </button>
          <button onClick={props.restorePrevious} disabled={props.locked}>
            직전 저장 복구
          </button>
          <button onClick={props.retry} disabled={props.locked}>
            현재 전투 다시 저장
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label="전투 저장 파일"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) props.importSave(file);
          }}
        />
        <p className="save-help">
          가져오기와 직전 저장 복구는 현재 전투를 교체합니다. 필요한 진행은 먼저
          파일로 내보내십시오. 손상되었거나 버전이 다른 파일은 저장을 바꾸지
          않습니다.
        </p>
        {props.children}
        <details>
          <summary>기존 저장 원본 백업</summary>
          <p className="save-help">
            버전이 달라 불러올 수 없는 저장도 원본 그대로 내보냅니다. 현재
            전투를 다시 저장하거나 초기화하기 전에 필요한 파일을 백업하십시오.
            원본 백업은 저장이나 현재 전투를 바꾸지 않습니다.
          </p>
          <div className="save-actions">
            <button
              onClick={() => props.exportStoredSave("latest")}
              disabled={props.locked}
            >
              기존 최신 저장 백업
            </button>
            <button
              onClick={() => props.exportStoredSave("previous")}
              disabled={props.locked}
            >
              기존 직전 저장 백업
            </button>
          </div>
        </details>
        <details>
          <summary>이전 버전(0.7 이하) 원본 백업</summary>
          <p>
            이전 버전 기록은 별도로 보존됩니다. 진행 중 전투를 새 규칙으로 자동
            변환하지 않습니다.
          </p>
          <div className="save-actions">
            <button
              onClick={() => props.exportLegacySave("latest")}
              disabled={props.locked}
            >
              이전 버전 최신 저장 백업
            </button>
            <button
              onClick={() => props.exportLegacySave("previous")}
              disabled={props.locked}
            >
              이전 버전 직전 저장 백업
            </button>
          </div>
        </details>
        <p className="save-notice" aria-live="polite" data-testid="save-notice">
          {props.notice}
        </p>
        <button onClick={props.close} disabled={props.locked}>
          전투로 돌아가기
        </button>
      </section>
    </div>
  );
}
