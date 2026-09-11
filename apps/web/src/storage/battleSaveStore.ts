import { type BattleSave, validateSave } from "./saveFormat";

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
  if (name === "AbortError")
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

function validOrNull(value: unknown): BattleSave | null {
  if (value === undefined) return null;
  try {
    return validateSave(value);
  } catch {
    return null;
  }
}

export interface LoadedBattleSave {
  save: BattleSave | null;
  recoveredPrevious: boolean;
  warning: string | null;
}

export type StoredSaveSlot = "latest" | "previous";

export function createBattleSaveStore() {
  return {
    // Keep unknown versions and even malformed JSON values available for backup.
    // undefined denotes an absent slot; a stored null is still original data.
    readRaw(slot: StoredSaveSlot): Promise<unknown> {
      return enqueue(() =>
        transact("readonly", (store, result) => {
          const request = store.get(slot);
          request.onsuccess = () => result(request.result);
        }),
      );
    },
    load(): Promise<LoadedBattleSave> {
      return enqueue(() =>
        transact("readonly", (store, result) => {
          const latest = store.get("latest");
          const previous = store.get("previous");
          previous.onsuccess = () => {
            const currentSave = validOrNull(latest.result);
            if (currentSave) {
              result({
                save: currentSave,
                recoveredPrevious: false,
                warning: null,
              });
              return;
            }
            const previousSave = validOrNull(previous.result);
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
                  : "저장 데이터가 손상되었거나 지원하지 않는 버전입니다. 기존 저장은 보존했습니다. 파일 가져오기 또는 새 전투를 선택해 주세요.",
            });
          };
        }),
      );
    },
    async write(save: BattleSave): Promise<void> {
      // Validation returns a detached snapshot before this operation joins the queue.
      // Invalid imports therefore cannot start a transaction or alter either slot.
      const snapshot = validateSave(save);
      return enqueue(() =>
        transact<void>("readwrite", (store, result, abort) => {
          const latest = store.get("latest");
          latest.onsuccess = () => {
            try {
              const previous = validOrNull(latest.result);
              if (previous) store.put(previous, "previous");
              store.put(snapshot, "latest");
              result(undefined);
            } catch (error) {
              abort(storageError(error));
            }
          };
        }),
      );
    },
    loadPrevious(): Promise<BattleSave | null> {
      return enqueue(() =>
        transact("readonly", (store, result, abort) => {
          const request = store.get("previous");
          request.onsuccess = () => {
            try {
              result(
                request.result === undefined
                  ? null
                  : validateSave(request.result),
              );
            } catch (error) {
              abort(error);
            }
          };
        }),
      );
    },
  };
}
