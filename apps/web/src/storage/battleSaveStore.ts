import { content } from "@orden/content";
import { type BattleSave, validateSave } from "./saveFormat";
import { preparationCheckpoint } from "./saveCheckpoints";

const DATABASE = "orden-battle";
const STORE = "saves";
const TIMEOUT_MS = 5000;

// Share ordering across hook remounts and store instances in the same tab.
let pending: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => undefined);
  return result;
}

function storageError(cause: unknown): Error {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "QuotaExceededError")
    return new Error("저장 공간이 부족합니다. 전투를 파일로 내보내 주세요.");
  if (name === "AbortError" || name === "TransactionInactiveError")
    return new Error("저장이 중단되었습니다. 기존 저장은 유지됩니다.");
  if (name === "VersionError")
    return new Error("이 브라우저 저장소의 버전을 지원하지 않습니다.");
  if (name === "SecurityError" || name === "NotSupportedError")
    return new Error("브라우저가 저장소 사용을 허용하지 않습니다.");
  return new Error(
    "브라우저 저장소에 접근하지 못했습니다. 파일 백업을 이용해 주세요.",
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            "저장소 응답 시간이 초과되었습니다. 다른 전투 탭을 닫고 다시 시도해 주세요.",
          ),
        ),
      TIMEOUT_MS,
    );
    try {
      if (!globalThis.indexedDB) {
        fail(new Error("이 브라우저에서는 전투 저장소를 사용할 수 없습니다."));
        return;
      }
      const request = indexedDB.open(DATABASE, 1);
      request.onblocked = () =>
        fail(
          new Error(
            "다른 전투 탭이 저장소를 사용 중입니다. 해당 탭을 닫고 다시 시도해 주세요.",
          ),
        );
      request.onerror = () => fail(storageError(request.error));
      request.onupgradeneeded = () => {
        // An already rejected open request cannot be cancelled; abort a late upgrade.
        if (settled) {
          request.transaction?.abort();
          return;
        }
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        database.onversionchange = () => database.close();
        resolve(database);
      };
    } catch (error) {
      fail(storageError(error));
    }
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    result: (value: T) => void,
    abort: (error: unknown) => void,
  ) => void,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(STORE, mode);
      } catch (error) {
        reject(storageError(error));
        return;
      }
      let value: T;
      let failure: Error | null = null;
      const abort = (error: unknown) => {
        failure = error instanceof Error ? error : storageError(error);
        try {
          transaction.abort();
        } catch {
          clearTimeout(timer);
          reject(failure);
        }
      };
      const timer = setTimeout(
        () =>
          abort(
            new Error(
              "저장소 응답 시간이 초과되었습니다. 기존 저장은 유지됩니다.",
            ),
          ),
        TIMEOUT_MS,
      );
      database.onversionchange = () => {
        abort(
          new Error(
            "저장소 버전이 변경되어 작업을 중단했습니다. 새로고침해 주세요.",
          ),
        );
        database.close();
      };
      transaction.oncomplete = () => {
        clearTimeout(timer);
        resolve(value);
      };
      transaction.onabort = () => {
        clearTimeout(timer);
        reject(
          failure ??
            storageError(
              transaction.error ?? new DOMException("", "AbortError"),
            ),
        );
      };
      // Requests propagate errors to an automatic abort; only abort/complete settles.
      transaction.onerror = () => undefined;
      try {
        operation(
          transaction.objectStore(STORE),
          (result) => {
            value = result;
          },
          abort,
        );
      } catch (error) {
        abort(storageError(error));
      }
    });
  } finally {
    database.close();
  }
}

type BattleMode = BattleSave["battle"]["mode"];

function validateStoredSave(
  value: unknown,
  expectedMode?: BattleMode,
): BattleSave {
  const save = validateSave(value);
  if (expectedMode !== undefined && save.battle.mode !== expectedMode)
    throw new Error(
      "현재 저장 영역과 다른 플레이 모드의 기록입니다. 원본을 내보낸 뒤 해당 모드에서 가져와 주세요.",
    );
  return save;
}

function validOrNull(
  value: unknown,
  expectedMode?: BattleMode,
): BattleSave | null {
  if (value === undefined) return null;
  try {
    return validateStoredSave(value, expectedMode);
  } catch {
    return null;
  }
}

export interface LoadedBattleSave {
  save: BattleSave | null;
  recoveredPrevious: boolean;
  warning: string | null;
}

export type AutoSaveSlot = "latest" | "previous";
export type ManualSaveSlot = "manual-1" | "manual-2" | "manual-3";
export type ManagedSaveSlot = ManualSaveSlot | "preparation";
export type StoredSaveSlot = AutoSaveSlot | ManagedSaveSlot;

export interface StoredSlotInfo {
  slot: ManagedSaveSlot;
  status: "empty" | "ready" | "unreadable";
  summary: null | {
    updatedAt: string;
    round: number;
    revision: number;
    side: BattleSave["battle"]["activeSide"];
    outcome: "victory" | "defeat" | null;
    commanders: string[];
  };
  error: string | null;
}

export const managedSaveSlots: readonly ManagedSaveSlot[] = [
  "manual-1",
  "manual-2",
  "manual-3",
  "preparation",
];

function slotInfo(
  slot: ManagedSaveSlot,
  value: unknown,
  expectedMode?: BattleMode,
): StoredSlotInfo {
  if (value === undefined)
    return { slot, status: "empty", summary: null, error: null };
  try {
    const save = validateStoredSave(value, expectedMode);
    return {
      slot,
      status: "ready",
      summary: {
        updatedAt: save.updatedAt,
        round: save.battle.round,
        revision: save.revision,
        side: save.battle.activeSide,
        outcome: save.battle.outcome?.status ?? null,
        commanders: save.battle.progression.roster.map(
          (unit) => `${unit.name} Lv.${unit.progression?.level ?? 1}`,
        ),
      },
      error: null,
    };
  } catch (error) {
    return {
      slot,
      status: "unreadable",
      summary: null,
      error:
        error instanceof Error ? error.message : "저장을 읽을 수 없습니다.",
    };
  }
}

/** Production passes rulesVersion + mode. Omission accesses the legacy keys. */
export function createBattleSaveStore(
  namespace?: string,
  expectedMode?: BattleMode,
) {
  if (namespace !== undefined && (!namespace.trim() || namespace.length > 128))
    throw new Error("저장 영역 이름이 올바르지 않습니다.");
  const key = (slot: StoredSaveSlot) =>
    namespace === undefined ? slot : `${namespace}:${slot}`;
  const readKey = (slotKey: string): Promise<unknown> =>
    enqueue(() =>
      transact("readonly", (store, result) => {
        const request = store.get(slotKey);
        request.onsuccess = () => result(request.result);
      }),
    );
  const loadSlot = async (slot: StoredSaveSlot): Promise<BattleSave | null> => {
    const raw = await readKey(key(slot));
    return raw === undefined ? null : validateStoredSave(raw, expectedMode);
  };
  return {
    // undefined means absent; even stored null remains available for raw backup.
    readRaw(slot: StoredSaveSlot): Promise<unknown> {
      return readKey(key(slot));
    },
    readLegacyRaw(slot: AutoSaveSlot): Promise<unknown> {
      return readKey(slot);
    },
    load(): Promise<LoadedBattleSave> {
      return enqueue(() =>
        transact("readonly", (store, result) => {
          const latest = store.get(key("latest"));
          const previous = store.get(key("previous"));
          previous.onsuccess = () => {
            const currentSave = validOrNull(latest.result, expectedMode);
            if (currentSave) {
              result({
                save: currentSave,
                recoveredPrevious: false,
                warning: null,
              });
              return;
            }
            const previousSave = validOrNull(previous.result, expectedMode);
            if (previousSave) {
              result({
                save: previousSave,
                recoveredPrevious: true,
                warning:
                  "최신 저장을 읽을 수 없어 직전 정상 저장으로 복구했습니다.",
              });
              return;
            }
            result({
              save: null,
              recoveredPrevious: false,
              warning:
                latest.result === undefined && previous.result === undefined
                  ? null
                  : "저장 데이터가 손상되었거나 지원하지 않는 버전 또는 플레이 모드입니다. 기존 저장은 보존했습니다. 파일 가져오기 또는 새 전투를 선택해 주세요.",
            });
          };
        }),
      );
    },
    async write(save: BattleSave): Promise<void> {
      // Validate before queueing: failed imports cannot alter any slot.
      const snapshot = validateStoredSave(save, expectedMode);
      const checkpoint = preparationCheckpoint(snapshot);
      return enqueue(() =>
        transact<void>("readwrite", (store, result, abort) => {
          const latest = store.get(key("latest"));
          latest.onsuccess = () => {
            try {
              const previous = validOrNull(latest.result, expectedMode);
              if (previous) store.put(previous, key("previous"));
              store.put(snapshot, key("latest"));
              if (checkpoint) store.put(checkpoint, key("preparation"));
              else store.delete(key("preparation"));
              result(undefined);
            } catch (error) {
              abort(storageError(error));
            }
          };
        }),
      );
    },
    loadPrevious(): Promise<BattleSave | null> {
      return loadSlot("previous");
    },
    loadSlot,
    async listSlots(): Promise<StoredSlotInfo[]> {
      // Read all raw rows in one transaction, then perform replay checks outside it.
      const rows = await enqueue(() =>
        transact<unknown[]>("readonly", (store, result) => {
          const requests = managedSaveSlots.map((slot) => store.get(key(slot)));
          requests.at(-1)!.onsuccess = () =>
            result(requests.map((request) => request.result));
        }),
      );
      return managedSaveSlots.map((slot, index) =>
        slotInfo(slot, rows[index], expectedMode),
      );
    },
    async saveManual(slot: ManualSaveSlot, save: BattleSave): Promise<void> {
      if (!["manual-1", "manual-2", "manual-3"].includes(slot))
        throw new Error("수동 저장 슬롯이 올바르지 않습니다.");
      const snapshot = validateStoredSave(save, expectedMode);
      return enqueue(() =>
        transact<void>("readwrite", (store, result) => {
          store.put(snapshot, key(slot));
          result(undefined);
        }),
      );
    },
  };
}

/** Current application keys never overwrite the unnamespaced public 0.7 saves. */
export function createCurrentBattleSaveStore(mode: BattleMode = "practice") {
  return createBattleSaveStore(`${content.rulesVersion}:${mode}`, mode);
}
