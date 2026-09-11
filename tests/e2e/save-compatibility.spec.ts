import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { contentSchema } from "../../packages/schema/src/index";
import { apply, createBattle } from "../../packages/core/src/index";

const content = contentSchema.parse(
  JSON.parse(readFileSync("packages/content/data/two-crossings.json", "utf8")),
);
const states = [createBattle(content)];
for (const [index, unitId] of ["A1", "A2"].entries()) {
  const state = states[index]!;
  const result = apply(content, state, {
    type: "act",
    commandId: `compatibility-${index}`,
    expectedRevision: state.revision,
    unitId,
    path: [],
    action: { type: "wait" },
  });
  if (!result.ok) throw new Error(result.error);
  states.push(result.nextState);
}

async function start(page: Page) {
  await page.goto("/");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "부대 목록", exact: true }),
  ).toBeEnabled();
}

async function readSlots(page: Page) {
  return page.evaluate(async () => {
    const adapterPath = "/src/storage/battleSaveStore.ts";
    const { createBattleSaveStore } = (await import(
      adapterPath
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    const store = createBattleSaveStore();
    return {
      latest: await store.readRaw("latest"),
      previous: await store.readRaw("previous"),
    };
  });
}

async function seedOldSaves(page: Page) {
  return page.evaluate(async (battleStates) => {
    const formatPath = "/src/storage/saveFormat.ts";
    const { createSave, checksumForSave } = (await import(
      formatPath
    )) as typeof import("../../apps/web/src/storage/saveFormat");
    const originals = battleStates.slice(1).map((state) => {
      const { checksum: _checksum, ...body } = createSave(state);
      const oldBody = { ...body, rulesVersion: "0.2" };
      return { ...oldBody, checksum: checksumForSave(oldBody) };
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("orden-battle", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const slots = { latest: originals[1]!, previous: originals[0]! };
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("saves", "readwrite");
        for (const [slot, save] of Object.entries(slots))
          tx.objectStore("saves").put(save, slot);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    return slots;
  }, states);
}

test("incompatible saves survive gameplay and both originals download unchanged", async ({
  page,
}, testInfo) => {
  await start(page);
  const originals = await seedOldSaves(page);
  expect(originals.latest.rulesVersion).not.toBe(content.rulesVersion);
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 확인 실패");
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "title",
    /기존 저장은 보존했습니다/,
  );
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(page.getByTestId("acted")).toHaveText("행동 완료");
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 중지");
  expect(await readSlots(page)).toEqual(originals);

  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page.getByText("기존 저장 원본 백업", { exact: true }).click();
  for (const [slot, label] of [
    ["latest", "최신"],
    ["previous", "직전"],
  ] as const) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: `기존 ${label} 저장 백업` }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(`original-save-${slot}.json`);
    const path = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(path);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(originals[slot]);
    await expect(page.getByTestId("save-notice")).toContainText(
      `기존 ${label} 저장 원본`,
    );
  }
  const currentDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "파일 내보내기", exact: true })
    .click();
  const current = await currentDownload;
  const currentPath = testInfo.outputPath("current.json");
  await current.saveAs(currentPath);
  const fresh = JSON.parse(await readFile(currentPath, "utf8"));
  expect(fresh.rulesVersion).toBe(content.rulesVersion);
  expect(fresh.revision).toBe(1);
  expect(fresh.commands).not.toEqual(originals.previous.commands);

  await page.getByLabel("전투 저장 파일").setInputFiles({
    name: "old-version.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(originals.latest)),
  });
  await expect(page.getByTestId("save-notice")).toContainText("규칙 버전");
  expect(await readSlots(page)).toEqual(originals);
  await page.screenshot({
    path: testInfo.outputPath("original-save-backup.png"),
    fullPage: true,
  });
});

test("absent slots show a useful error while a stored null remains exportable", async ({
  page,
}, testInfo) => {
  await start(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("orden-battle", 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("saves", "readwrite");
      tx.objectStore("saves").put(null, "latest");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 확인 실패");
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page.getByText("기존 저장 원본 백업", { exact: true }).click();
  await page.getByRole("button", { name: "기존 직전 저장 백업" }).click();
  await expect(page.getByTestId("save-notice")).toHaveText(
    "백업할 기존 직전 저장이 없습니다.",
  );
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "기존 최신 저장 백업" }).click();
  const download = await pending;
  const path = testInfo.outputPath("null-original.json");
  await download.saveAs(path);
  expect(await readFile(path, "utf8")).toBe("null");
  expect(await readSlots(page)).toEqual({ latest: null, previous: undefined });
});

test("unserializable and oversized originals report bounded errors without changing storage", async ({
  page,
}) => {
  await start(page);
  const originals = await seedOldSaves(page);
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 확인 실패");
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page.getByText("기존 저장 원본 백업", { exact: true }).click();
  let downloads = 0;
  page.on("download", () => downloads++);
  for (const [kind, error] of [
    ["cyclic", "순환 참조"],
    ["unsupported", "JSON으로 표현할 수 없는 값"],
    ["oversized", "2MiB"],
  ] as const) {
    await page.evaluate(async (payloadKind) => {
      const raw: Record<string, unknown> = { kind: payloadKind };
      raw.value =
        payloadKind === "cyclic"
          ? raw
          : payloadKind === "unsupported"
            ? undefined
            : "x".repeat(2 * 1024 * 1024 + 1);
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("orden-battle", 1);
        request.onsuccess = () => resolve(request.result);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("saves", "readwrite");
        tx.objectStore("saves").put(raw, "latest");
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    }, kind);
    await page.getByRole("button", { name: "기존 최신 저장 백업" }).click();
    await expect(page.getByTestId("save-notice")).toContainText(error);
    expect(
      (await page.getByTestId("save-notice").innerText()).length,
    ).toBeLessThan(100);
    const preserved = await page.evaluate(async () => {
      const adapterPath = "/src/storage/battleSaveStore.ts";
      const { createBattleSaveStore } = (await import(
        adapterPath
      )) as typeof import("../../apps/web/src/storage/battleSaveStore");
      const store = createBattleSaveStore();
      const raw = (await store.readRaw("latest")) as Record<string, unknown>;
      return {
        kind: raw.kind,
        intact:
          raw.kind === "cyclic"
            ? raw.value === raw
            : raw.kind === "unsupported"
              ? Object.hasOwn(raw, "value") && raw.value === undefined
              : typeof raw.value === "string" &&
                raw.value.length === 2 * 1024 * 1024 + 1,
        previous: await store.readRaw("previous"),
      };
    });
    expect(preserved).toEqual({
      kind,
      intact: true,
      previous: originals.previous,
    });
  }
  expect(downloads).toBe(0);
});

test("a failed original backup keeps current battle export available with storage blocked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException("Storage is blocked", "SecurityError");
    };
  });
  await start(page);
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(page.getByTestId("acted")).toHaveText("행동 완료");
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page.getByText("기존 저장 원본 백업", { exact: true }).click();
  await page.getByRole("button", { name: "기존 최신 저장 백업" }).click();
  await expect(page.getByTestId("save-notice")).toContainText(
    "허용하지 않습니다",
  );
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "파일 내보내기", exact: true })
    .click();
  expect((await pending).suggestedFilename()).toContain("rev-1");
  await expect(page.getByTestId("save-notice")).toHaveText(
    "현재 전투를 파일로 내보냈습니다.",
  );
});
