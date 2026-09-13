import type {
  ManagedSaveSlot,
  ManualSaveSlot,
  StoredSlotInfo,
} from "../storage/battleSaveStore";
import "./save-slots.css";

export interface SaveSlotsPanelProps {
  slots: StoredSlotInfo[];
  loading: boolean;
  locked: boolean;
  error?: string;
  save: (slot: ManualSaveSlot) => void;
  load: (slot: ManagedSaveSlot) => void;
  exportSlot: (slot: ManagedSaveSlot) => void;
}

export function saveSlotLabel(slot: ManagedSaveSlot): string {
  return slot === "preparation"
    ? "출격 준비 체크포인트"
    : `수동 슬롯 ${slot.slice(-1)}`;
}

/** List metadata comes from verified saves; unreadable rows still offer raw backup. */
export function SaveSlotsPanel(props: SaveSlotsPanelProps) {
  const disabled = props.locked || props.loading;
  return (
    <section className="save-slots" aria-labelledby="save-slots-title">
      <h3 id="save-slots-title">저장 슬롯과 출격 준비</h3>
      <p>
        수동 슬롯은 자동 저장과 별도로 보관합니다. 불러오면 현재 전투와 성장
        기록을 해당 시점으로 교체합니다.
      </p>
      {props.loading && <p role="status">저장 슬롯을 확인하고 있습니다.</p>}
      {props.error && (
        <p role="alert" className="save-error">
          {props.error}
        </p>
      )}
      <ul aria-label="수동 저장 및 준비 체크포인트">
        {props.slots.map((entry) => {
          const label = saveSlotLabel(entry.slot);
          return (
            <li
              key={entry.slot}
              className={
                entry.slot === "preparation" ? "save-checkpoint" : undefined
              }
              aria-label={label}
            >
              <div className="save-slot-heading">
                <strong>{label}</strong>
                <small>
                  {entry.status === "empty"
                    ? "비어 있음"
                    : entry.status === "unreadable"
                      ? "불러올 수 없음 · 원본 보존"
                      : `${entry.summary!.round}라운드 · ${entry.summary!.revision}명령`}
                </small>
              </div>
              {entry.summary && (
                <>
                  <p>
                    <time dateTime={entry.summary.updatedAt}>
                      {new Date(entry.summary.updatedAt).toLocaleString(
                        "ko-KR",
                      )}
                    </time>{" "}
                    ·{" "}
                    {entry.summary.outcome === "victory"
                      ? "승리 정산"
                      : entry.summary.outcome === "defeat"
                        ? "패배 정산"
                        : entry.summary.side === "player"
                          ? "아군"
                          : entry.summary.side === "enemy"
                            ? "적군"
                            : "중립"}
                  </p>
                  <p>{entry.summary.commanders.join(" · ")}</p>
                </>
              )}
              {entry.error && <p className="save-error">{entry.error}</p>}
              {entry.slot === "preparation" && (
                <p>
                  현재 출격의 마지막 준비를 자동 보관합니다. 돌아가면 이후
                  행동과 보상도 준비 시점으로 되돌아갑니다.
                </p>
              )}
              <div className="save-slot-actions">
                {entry.slot !== "preparation" && (
                  <button
                    disabled={disabled}
                    aria-label={`${label} 저장`}
                    onClick={() => props.save(entry.slot as ManualSaveSlot)}
                  >
                    {entry.status === "empty"
                      ? "현재 전투 저장"
                      : "현재 전투로 덮어쓰기"}
                  </button>
                )}
                <button
                  disabled={disabled || entry.status !== "ready"}
                  aria-label={`${label} 불러오기`}
                  onClick={() => props.load(entry.slot)}
                >
                  {entry.slot === "preparation"
                    ? "출격 준비로 돌아가기"
                    : "불러오기"}
                </button>
                <button
                  disabled={disabled || entry.status === "empty"}
                  aria-label={`${label} 원본 내보내기`}
                  onClick={() => props.exportSlot(entry.slot)}
                >
                  원본 내보내기
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
