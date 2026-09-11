import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { contentSchema } from "../../packages/schema/src/index";
import { apply, createBattle } from "../../packages/core/src/index";
import type { BattleSave } from "../../apps/web/src/storage/saveFormat";
import type { createBattleSaveStore } from "../../apps/web/src/storage/battleSaveStore";

interface RawSlots {
  latest: unknown;
  previous: unknown;
}

declare global {
  interface Window {
    saveStoreTest: {
      store: ReturnType<typeof createBattleSaveStore>;
      saves: BattleSave[];
      readRaw(): Promise<RawSlots>;
      putRaw(slots: Partial<RawSlots>): Promise<void>;
    };
  }
}

const content = contentSchema.parse(
  JSON.parse(readFileSync("packages/content/data/two-crossings.json", "utf8")),
);
const states = [createBattle(content)];
for (let index = 0; index < 2; index += 1) {
  const state = states[index]!;
  const result = apply(content, state, {
    type: "endPhase",
    commandId: `storage-test-${index}`,
    expectedRevision: state.revision,
    side: state.activeSide,
  });
  if (!result.ok) throw new Error(result.error);
  states.push(result.nextState);
}

async function prepare(page: Page): Promise<BattleSave[]> {
  // Load a document without React so application autosaves cannot affect adapter tests.
  await page.route("**/storage-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Storage test</title>",
    }),
  );
  await page.goto("/storage-test");
  return page.evaluate(async (battleStates) => {
    const adapterPath = "/src/storage/battleSaveStore.ts";
    const formatPath = "/src/storage/saveFormat.ts";
    const { createBattleSaveStore } = (await import(
      adapterPath
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    const { createSave } = (await import(
      formatPath
    )) as typeof import("../../apps/web/src/storage/saveFormat");
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("orden-battle", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("saves");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    window.saveStoreTest = {
      store: createBattleSaveStore(),
      saves: battleStates.map((state) => createSave(state)),
      async readRaw() {
        const database = await open();
        return new Promise<RawSlots>((resolve, reject) => {
          const transaction = database.transaction("saves", "readonly");
          const store = transaction.objectStore("saves");
          const latest = store.get("latest");
          const previous = store.get("previous");
          transaction.oncomplete = () => {
            database.close();
            resolve({ latest: latest.result, previous: previous.result });
          };
          transaction.onabort = () => {
            database.close();
            reject(transaction.error);
          };
        });
      },
      async putRaw(slots) {
        const database = await open();
        return new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("saves", "readwrite");
          const store = transaction.objectStore("saves");
          for (const [key, value] of Object.entries(slots))
            store.put(value, key);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onabort = () => {
            database.close();
            reject(transaction.error);
          };
        });
      },
    };
    return window.saveStoreTest.saves;
  }, states);
}

test("queued writes and reads retain the last two complete snapshots across store instances", async ({
  page,
}) => {
  const saves = await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, saves } = window.saveStoreTest;
    const adapterPath = "/src/storage/battleSaveStore.ts";
    const { createBattleSaveStore } = (await import(
      adapterPath
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    const otherStore = createBattleSaveStore();
    const writes = [
      store.write(saves[0]!),
      otherStore.write(saves[1]!),
      store.write(saves[2]!),
    ];
    const latest = store.load();
    const previous = otherStore.loadPrevious();
    // Caller mutations after write() cannot change the queued snapshot.
    (saves[2]! as { schemaVersion: number }).schemaVersion = -1;
    await Promise.all(writes);
    return {
      latest: await latest,
      previous: await previous,
      raw: await window.saveStoreTest.readRaw(),
    };
  });
  expect(result.latest).toEqual({
    save: saves[2],
    recoveredPrevious: false,
    warning: null,
  });
  expect(result.previous).toEqual(saves[1]);
  expect(result.raw).toEqual({ latest: saves[2], previous: saves[1] });
});

test("invalid imports leave both raw slots unchanged and do not poison later writes", async ({
  page,
}) => {
  const saves = await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, saves, readRaw } = window.saveStoreTest;
    await store.write(saves[0]!);
    await store.write(saves[1]!);
    const before = await readRaw();
    const invalid = structuredClone(saves[2]!);
    (invalid as { schemaVersion: number }).schemaVersion = 999;
    let error = "";
    try {
      await store.write(invalid);
    } catch (failure) {
      error = (failure as Error).message;
    }
    const after = await readRaw();
    await store.write(saves[2]!);
    return { before, after, error, recovered: await readRaw() };
  });
  expect(result.error).not.toBe("");
  expect(result.after).toEqual(result.before);
  expect(result.recovered).toEqual({ latest: saves[2], previous: saves[1] });
});

test("an aborted write rolls back both slots and the queue recovers", async ({
  page,
}) => {
  const saves = await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, saves, readRaw } = window.saveStoreTest;
    await store.write(saves[0]!);
    await store.write(saves[1]!);
    const before = await readRaw();
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = originalPut.call(this, value, key);
      if (key === "latest") this.transaction.abort();
      return request;
    };
    let error = "";
    try {
      await store.write(saves[2]!);
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    const after = await readRaw();
    await store.write(saves[2]!);
    return { before, after, error, recovered: await readRaw() };
  });
  expect(result.error).toContain("중단");
  expect(result.after).toEqual(result.before);
  expect(result.recovered).toEqual({ latest: saves[2], previous: saves[1] });
});

test("quota failure after staging previous keeps both original slots", async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, saves, readRaw } = window.saveStoreTest;
    await store.write(saves[0]!);
    await store.write(saves[1]!);
    const before = await readRaw();
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === "latest")
        throw new DOMException("Injected quota failure", "QuotaExceededError");
      return originalPut.call(this, value, key);
    };
    let error = "";
    try {
      await store.write(saves[2]!);
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    return { before, after: await readRaw(), error };
  });
  expect(result.error).toContain("저장 공간이 부족");
  expect(result.after).toEqual(result.before);
});

test("corrupt latest falls back without writes and preserves valid previous on the next save", async ({
  page,
}) => {
  const saves = await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, saves, putRaw, readRaw } = window.saveStoreTest;
    await putRaw({
      latest: { schemaVersion: 999, damaged: true },
      previous: saves[0],
    });
    const before = await readRaw();
    const loaded = await store.load();
    const afterRead = await readRaw();
    await store.write(saves[1]!);
    return { before, loaded, afterRead, afterWrite: await readRaw() };
  });
  expect(result.loaded.save).toEqual(saves[0]);
  expect(result.loaded.recoveredPrevious).toBe(true);
  expect(result.loaded.warning).toContain("직전 정상 저장");
  expect(result.afterRead).toEqual(result.before);
  expect(result.afterWrite).toEqual({ latest: saves[1], previous: saves[0] });
});

test("two invalid slots are preserved while load reports that recovery is unavailable", async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, putRaw, readRaw } = window.saveStoreTest;
    await putRaw({ latest: { unexpected: "payload" }, previous: null });
    const before = await readRaw();
    const loaded = await store.load();
    let previousError = "";
    try {
      await store.loadPrevious();
    } catch (error) {
      previousError = (error as Error).message;
    }
    return { before, loaded, after: await readRaw(), previousError };
  });
  expect(result.loaded.save).toBeNull();
  expect(result.loaded.recoveredPrevious).toBe(false);
  expect(result.loaded.warning).toContain("기존 저장은 보존");
  expect(result.previousError).not.toBe("");
  expect(result.after).toEqual(result.before);
});

test("unavailable IndexedDB rejects promptly and later storage operations still work", async ({
  page,
}) => {
  const saves = await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, saves } = window.saveStoreTest;
    const original = indexedDB.open;
    indexedDB.open = () => {
      throw new DOMException("Injected denial", "SecurityError");
    };
    let error = "";
    try {
      await store.load();
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      indexedDB.open = original;
    }
    await store.write(saves[0]!);
    return { error, loaded: await store.load() };
  });
  expect(result.error).toContain("허용하지 않습니다");
  expect(result.loaded.save).toEqual(saves[0]);
});
