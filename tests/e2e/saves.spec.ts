import { expect, test, type Page } from "@playwright/test";
import type { BattleSave } from "../../apps/web/src/storage/saveFormat";

async function start(page: Page) {
  await page.goto("/");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "부대 목록", exact: true }),
  ).toBeEnabled();
}

async function readLatest(page: Page): Promise<BattleSave | undefined> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("orden-battle", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db
          .transaction("saves")
          .objectStore("saves")
          .get("latest");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }) as Promise<BattleSave | undefined>;
}

async function select(page: Page, label: string) {
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function waitUnit(page: Page, label: string) {
  await select(page, label);
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
}

test("committed damage restores during detailed animation without applying twice", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("전투 연출").selectOption("detailed");
  await select(page, "A21 창병 선택");
  const canvas = page.locator('canvas[data-ready="true"]');
  await canvas.click({ position: { x: 11 * 48 + 24, y: 10 * 48 + 24 } });
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeEnabled();
  await canvas.click({ position: { x: 12 * 48 + 24, y: 10 * 48 + 24 } });
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(
    page.getByRole("dialog", { name: "상세 전투", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
  const saved = (await readLatest(page))!;
  expect(saved.revision).toBe(1);
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await select(page, "A21 창병 선택");
  await expect(page.getByTestId("acted")).toHaveText("행동 완료");
  await page
    .locator('canvas[data-ready="true"]')
    .click({ position: { x: 12 * 48 + 24, y: 10 * 48 + 24 } });
  await expect(page.locator(".health-line strong")).toHaveText("5");
  expect(await readLatest(page)).toEqual(saved);
});

test("movement preview never changes saved battle or command history", async ({
  page,
}) => {
  await start(page);
  await waitUnit(page, "카이엘 선택");
  const saved = await readLatest(page);
  await select(page, "A21 창병 선택");
  await page
    .locator('canvas[data-ready="true"]')
    .click({ position: { x: 11 * 48 + 24, y: 10 * 48 + 24 } });
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeEnabled();
  expect(await readLatest(page)).toEqual(saved);
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeDisabled();
  expect(await readLatest(page)).toEqual(saved);
});

test("file backup restores after reset and invalid imports preserve the current save", async ({
  page,
}, testInfo) => {
  await start(page);
  await waitUnit(page, "카이엘 선택");
  const original = (await readLatest(page))!;
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "파일 내보내기", exact: true })
    .click();
  const download = await downloadPromise;
  const backup = testInfo.outputPath("battle.json");
  await download.saveAs(backup);
  await page.getByRole("button", { name: "전투로 돌아가기" }).click();
  await page.getByRole("button", { name: "연습 초기화" }).click();
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
  expect((await readLatest(page))!.revision).toBe(0);
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page.getByLabel("전투 저장 파일").setInputFiles(backup);
  await expect(page.getByTestId("save-notice")).toContainText("불러왔습니다");
  expect((await readLatest(page))!.battle).toEqual(original.battle);
  const restored = await readLatest(page);
  for (const bad of [
    "{broken json",
    JSON.stringify({ ...original, schemaVersion: 99 }),
    JSON.stringify({ ...original, contentHash: "old-content" }),
  ]) {
    await page
      .getByLabel("전투 저장 파일")
      .setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from(bad),
      });
    await expect(page.getByTestId("save-notice")).not.toContainText(
      "불러왔습니다",
    );
    await expect(
      page.getByRole("button", { name: "전투로 돌아가기" }),
    ).toBeEnabled();
    expect(await readLatest(page)).toEqual(restored);
  }
  await page.screenshot({
    path: "test-results/save-panel.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "전투로 돌아가기" }).click();
  await expect(page.getByTestId("acted")).toHaveText("행동 완료");
});

test("previous save is available and a broken latest automatically falls back without overwriting it", async ({
  page,
}) => {
  await start(page);
  await waitUnit(page, "카이엘 선택");
  const previous = await readLatest(page);
  await waitUnit(page, "로엔 선택");
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page
    .getByRole("button", { name: "직전 저장 복구", exact: true })
    .click();
  await expect(page.getByTestId("save-notice")).toContainText(
    "직전 저장을 복구",
  );
  expect((await readLatest(page))!.battle).toEqual(previous!.battle);
  await page.getByRole("button", { name: "전투로 돌아가기" }).click();
  await waitUnit(page, "미라 선택");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("orden-battle", 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("saves", "readwrite");
      tx.objectStore("saves").put({ broken: true }, "latest");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("직전 저장 복구");
  expect(await readLatest(page)).toEqual({ broken: true });
  await select(page, "카이엘 선택");
  await expect(page.getByTestId("acted")).toHaveText("행동 완료");
  await select(page, "미라 선택");
  await expect(page.getByTestId("acted")).toHaveCount(0);
});

test("blocked storage keeps gameplay and file backup available with a persistent failure", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException("저장소 접근이 차단되었습니다.", "SecurityError");
    };
  });
  await start(page);
  await expect(page.getByTestId("save-status")).toContainText("저장 확인 실패");
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(page.getByTestId("acted")).toHaveText("행동 완료");
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page.getByRole("button", { name: "현재 전투 다시 저장" }).click();
  await expect(page.getByTestId("save-panel-status")).toContainText(
    "저장 실패",
  );
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "파일 내보내기", exact: true })
    .click();
  expect((await pending).suggestedFilename()).toContain("rev-1");
  await page.screenshot({
    path: "test-results/save-failure.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("save-status")).toContainText("저장 실패");
});

test("reload resumes confirmed follower and enemy queues without duplicate commands", async ({
  page,
}) => {
  test.setTimeout(45000);
  await start(page);
  await page.getByRole("button", { name: /^턴 종료 E$/ }).click();
  await page.getByRole("button", { name: "턴 종료 확인", exact: true }).click();
  await expect
    .poll(async () => (await readLatest(page))?.continuation.finishing)
    .toBe(true);
  await page.reload();
  await page.getByLabel("빠른 진행").check();
  await expect(page.getByTestId("round")).toHaveText("02", { timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "부대 목록", exact: true }),
  ).toBeEnabled();
  const save = (await readLatest(page))!;
  expect(save.battle.activeSide).toBe("player");
  expect(save.continuation.finishing).toBe(false);
  expect(new Set(save.commands.map((c) => c.commandId)).size).toBe(
    save.commands.length,
  );
  expect(
    save.commands.filter(
      (c) => c.type === "act" && c.commandId.startsWith("follow-"),
    ).length,
  ).toBe(9);
  await page.getByRole("button", { name: "연습 초기화" }).click();
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
  await page.reload();
  await expect(page.getByTestId("round")).toHaveText("01");
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  expect((await readLatest(page))!.revision).toBe(0);
});
