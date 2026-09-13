import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { contentSchema } from "../../packages/schema/src/index";
import { apply, createBattle } from "../../packages/core/src/index";
import type { BattleSave } from "../../apps/web/src/storage/saveFormat";
import type { createBattleSaveStore } from "../../apps/web/src/storage/battleSaveStore";

const content = contentSchema.parse(
  JSON.parse(readFileSync("packages/content/data/two-crossings.json", "utf8")),
);

declare global {
  interface Window {
    slotsStoreTest: {
      store: ReturnType<typeof createBattleSaveStore>;
      other: ReturnType<typeof createBattleSaveStore>;
      saves: BattleSave[];
      branches: BattleSave[];
      putRaw(key: string, value: unknown): Promise<void>;
    };
  }
}

async function prepare(page: Page) {
  await page.route("**/slots-storage-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Save slot adapter</title>",
    }),
  );
  await page.goto("/slots-storage-test");
  const initial = createBattle(content);
  const states = [initial];
  for (let index = 0; index < 2; index++) {
    const state = states.at(-1)!;
    const result = apply(content, state, {
      type: "endPhase",
      side: state.activeSide,
      commandId: `slot-${state.revision}`,
      expectedRevision: state.revision,
    });
    if (!result.ok) throw Error(result.error);
    states.push(result.nextState);
  }
  const branches = ["knife", "great-sword"].map((itemId) => {
    const equipped = apply(content, initial, {
      type: "equip",
      commandId: "equip-0",
      expectedRevision: 0,
      unitId: "A1",
      slot: "weapon",
      itemId,
    });
    if (!equipped.ok) throw Error(equipped.error);
    const acted = apply(content, equipped.nextState, {
      type: "act",
      commandId: "act-1",
      expectedRevision: 1,
      unitId: "A1",
      path: [],
      action: { type: "wait" },
    });
    if (!acted.ok) throw Error(acted.error);
    return acted.nextState;
  });

  await page.evaluate(
    async ({ states, branches }) => {
      const adapterPath = "/src/storage/battleSaveStore.ts";
      const formatPath = "/src/storage/saveFormat.ts";
      const { createBattleSaveStore } = (await import(
        adapterPath
      )) as typeof import("../../apps/web/src/storage/battleSaveStore");
      const { createSave } = (await import(
        formatPath
      )) as typeof import("../../apps/web/src/storage/saveFormat");
      const store = createBattleSaveStore("slots-a");
      const other = createBattleSaveStore("slots-b");
      await store.load();
      window.slotsStoreTest = {
        store,
        other,
        saves: states.map((state) => createSave(state)),
        branches: branches.map((state) => createSave(state)),
        async putRaw(key, value) {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("orden-battle", 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          await new Promise<void>((resolve, reject) => {
            const tx = database.transaction("saves", "readwrite");
            tx.objectStore("saves").put(value, key);
            tx.oncomplete = () => {
              database.close();
              resolve();
            };
            tx.onabort = () => {
              database.close();
              reject(tx.error);
            };
          });
        },
      };
    },
    { states, branches },
  );
}

test("new save namespaces leave legacy 0.7 originals and other modes untouched", async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, other, saves, putRaw } = window.slotsStoreTest;
    const original = {
      rulesVersion: "0.7",
      schemaVersion: 1,
      source: "unchanged legacy JSON",
    };
    await putRaw("latest", original);
    await putRaw("previous", null);
    await store.write(saves[1]!);
    await other.write(saves[0]!);
    return {
      original,
      legacy: await store.readLegacyRaw("latest"),
      legacyNull: await other.readLegacyRaw("previous"),
      a: (await store.load()).save!.revision,
      b: (await other.load()).save!.revision,
    };
  });
  expect(result.legacy).toEqual(result.original);
  expect(result.legacyNull).toBeNull();
  expect(result.a).toBe(1);
  expect(result.b).toBe(0);
});

test("current mode stores reject cross-mode automatic and manual writes without changing any slot", async ({
  page,
}) => {
  await prepare(page);
  const results = await page.evaluate(
    async (operationState) => {
      const adapterPath = "/src/storage/battleSaveStore.ts";
      const formatPath = "/src/storage/saveFormat.ts";
      const { createCurrentBattleSaveStore } = (await import(
        adapterPath
      )) as typeof import("../../apps/web/src/storage/battleSaveStore");
      const { createSave } = (await import(
        formatPath
      )) as typeof import("../../apps/web/src/storage/saveFormat");
      const practice = window.slotsStoreTest.saves[0]!;
      const operation = createSave(operationState);
      const results = [];
      for (const mode of ["practice", "operation"] as const) {
        const store = createCurrentBattleSaveStore(mode);
        const matching = mode === "practice" ? practice : operation;
        const foreign = mode === "practice" ? operation : practice;
        await store.write(matching);
        await store.saveManual("manual-1", matching);
        const read = () =>
          Promise.all(
            (["latest", "previous", "preparation", "manual-1"] as const).map(
              (slot) => store.readRaw(slot),
            ),
          );
        const before = await read();
        const errors = [];
        for (const write of [
          () => store.write(foreign),
          () => store.saveManual("manual-1", foreign),
        ]) {
          try {
            await write();
          } catch (failure) {
            errors.push((failure as Error).message);
          }
        }
        results.push({ before, after: await read(), errors });
      }
      return results;
    },
    createBattle(content, "operation"),
  );
  for (const result of results) {
    expect(result.errors).toHaveLength(2);
    expect(
      result.errors.every((error) => error.includes("다른 플레이 모드")),
    ).toBe(true);
    expect(result.after).toEqual(result.before);
  }
});

test("foreign mode rows cannot auto-load or appear as valid slots and remain available as raw backups", async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(
    async (operationState) => {
      const adapterPath = "/src/storage/battleSaveStore.ts";
      const formatPath = "/src/storage/saveFormat.ts";
      const { createCurrentBattleSaveStore } = (await import(
        adapterPath
      )) as typeof import("../../apps/web/src/storage/battleSaveStore");
      const { createSave } = (await import(
        formatPath
      )) as typeof import("../../apps/web/src/storage/saveFormat");
      const { saves, putRaw } = window.slotsStoreTest;
      const foreign = createSave(operationState);
      const store = createCurrentBattleSaveStore("practice");
      const key = (slot: string) => `${foreign.rulesVersion}:practice:${slot}`;
      for (const slot of ["latest", "previous", "manual-1", "preparation"])
        await putRaw(key(slot), foreign);
      const rejected = await store.load();
      const list = await store.listSlots();
      const errors = [];
      for (const read of [
        () => store.loadPrevious(),
        () => store.loadSlot("manual-1"),
        () => store.loadSlot("preparation"),
      ]) {
        try {
          await read();
        } catch (failure) {
          errors.push((failure as Error).message);
        }
      }
      const originals = await Promise.all(
        (["latest", "previous", "manual-1", "preparation"] as const).map(
          (slot) => store.readRaw(slot),
        ),
      );
      await putRaw(key("previous"), saves[0]!);
      const recovered = await store.load();
      await store.write(saves[1]!);
      return {
        foreign,
        rejected,
        list,
        errors,
        originals,
        recovered,
        previous: await store.loadPrevious(),
        expectedPrevious: saves[0],
      };
    },
    createBattle(content, "operation"),
  );
  expect(result.rejected.save).toBeNull();
  expect(result.rejected.warning).toContain("플레이 모드");
  expect(result.list.map((entry) => entry.status)).toEqual([
    "unreadable",
    "empty",
    "empty",
    "unreadable",
  ]);
  expect(result.errors).toHaveLength(3);
  expect(
    result.errors.every((error) => error.includes("다른 플레이 모드")),
  ).toBe(true);
  expect(result.originals).toEqual(Array(4).fill(result.foreign));
  expect(result.recovered.recoveredPrevious).toBe(true);
  expect(result.recovered.save).toEqual(result.expectedPrevious);
  expect(result.previous).toEqual(result.expectedPrevious);
});

test("three manual slots remain independent from autosaves and return detached verified snapshots", async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, saves } = window.slotsStoreTest;
    const empty = await store.listSlots();
    await store.write(saves[0]!);
    await store.saveManual("manual-1", saves[0]!);
    await store.saveManual("manual-2", saves[1]!);
    await store.saveManual("manual-3", saves[2]!);
    const loaded = await store.loadSlot("manual-2");
    loaded!.battle.units[0]!.hp = 1;
    return {
      empty,
      list: await store.listSlots(),
      latest: (await store.load()).save!.revision,
      previous: await store.loadPrevious(),
      original: saves[1],
      reread: await store.loadSlot("manual-2"),
    };
  });
  expect(result.empty.map((entry) => entry.status)).toEqual([
    "empty",
    "empty",
    "empty",
    "empty",
  ]);
  expect(
    result.list.map((entry) => [
      entry.slot,
      entry.status,
      entry.summary?.revision,
    ]),
  ).toEqual([
    ["manual-1", "ready", 0],
    ["manual-2", "ready", 1],
    ["manual-3", "ready", 2],
    ["preparation", "ready", 0],
  ]);
  expect(result.latest).toBe(0);
  expect(result.previous).toBeNull();
  expect(result.reread).toEqual(result.original);
});

test("absent, stored-null, and incompatible manual slots remain distinct and exportable", async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, putRaw } = window.slotsStoreTest;
    await putRaw("slots-a:manual-1", null);
    await putRaw("slots-a:manual-2", { schemaVersion: 999 });
    let error = "";
    try {
      await store.loadSlot("manual-1");
    } catch (failure) {
      error = (failure as Error).message;
    }
    return {
      list: await store.listSlots(),
      raw: await store.readRaw("manual-1"),
      absent: (await store.readRaw("manual-3")) === undefined,
      error,
    };
  });
  expect(result.list.map((entry) => entry.status)).toEqual([
    "unreadable",
    "unreadable",
    "empty",
    "empty",
  ]);
  expect(result.raw).toBeNull();
  expect(result.absent).toBe(true);
  expect(result.error).not.toBe("");
});

test("an aborted checkpoint update rolls back latest and previous while preserving manual saves", async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, saves } = window.slotsStoreTest;
    await store.write(saves[0]!);
    await store.saveManual("manual-1", saves[2]!);
    const read = async () =>
      Promise.all(
        (["latest", "previous", "preparation", "manual-1"] as const).map(
          (slot) => store.readRaw(slot),
        ),
      );
    const before = await read();
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const result = originalPut.call(this, value, key);
      if (key === "slots-a:preparation") this.transaction.abort();
      return result;
    };
    let error = "";
    try {
      await store.write(saves[1]!);
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    const after = await read();
    await store.write(saves[1]!);
    return {
      before,
      after,
      error,
      recovered: (await store.load()).save!.revision,
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.error).toContain("중단");
  expect(result.recovered).toBe(1);
});

test("loading another manual branch replaces its preparation prefix without mixing histories", async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, branches } = window.slotsStoreTest;
    await store.saveManual("manual-1", branches[0]!);
    await store.write(branches[1]!);
    await store.write((await store.loadSlot("manual-1"))!);
    const checkpoint = (await store.loadSlot("preparation"))!;
    return {
      checkpoint,
      previous: await store.loadPrevious(),
      expectedPrevious: branches[1],
      latest: (await store.load()).save,
      expectedLatest: branches[0],
      manual: await store.loadSlot("manual-1"),
    };
  });
  expect(result.checkpoint.commands).toHaveLength(1);
  expect(
    result.checkpoint.battle.units.find((unit) => unit.id === "A1")!.equipment!
      .weapon,
  ).toBe("knife");
  expect(result.previous).toEqual(result.expectedPrevious);
  expect(result.latest).toEqual(result.expectedLatest);
  expect(result.manual).toEqual(result.expectedLatest);
});

test("invalid manual save writes neither that slot nor the automatic checkpoint", async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { store, saves } = window.slotsStoreTest;
    await store.write(saves[0]!);
    await store.saveManual("manual-1", saves[0]!);
    const before = await store.listSlots();
    const invalid = structuredClone(saves[1]!);
    invalid.battle.units[0]!.hp = 1;
    let error = "";
    try {
      await store.saveManual("manual-1", invalid);
    } catch (failure) {
      error = (failure as Error).message;
    }
    return {
      before,
      after: await store.listSlots(),
      error,
      manual: await store.loadSlot("manual-1"),
      original: saves[0],
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.error).toContain("체크섬");
  expect(result.manual).toEqual(result.original);
});
