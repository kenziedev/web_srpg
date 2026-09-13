import { expect, test, type Page } from "@playwright/test";
import type { BattleSave } from "../../apps/web/src/storage/saveFormat";

async function latest(page: Page, mode: "practice" | "operation" = "practice") {
  return page.evaluate(async (playMode) => {
    const path = "/src/storage/battleSaveStore.ts";
    const { createCurrentBattleSaveStore } = (await import(
      path
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    return createCurrentBattleSaveStore(playMode).readRaw("latest");
  }, mode) as Promise<BattleSave>;
}

async function waitSelected(page: Page) {
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
}

test("manual slots and the last preparation restore complete distinct command histories", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await waitSelected(page);
  const first = await latest(page);
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page
    .getByRole("button", { name: "수동 슬롯 1 저장", exact: true })
    .click();
  await expect(page.getByTestId("save-notice")).toContainText(
    "슬롯에 현재 진행을 저장",
  );
  await expect(
    page.getByRole("listitem", { name: "수동 슬롯 1", exact: true }),
  ).toContainText("1명령");
  await expect(
    page.getByRole("listitem", { name: "수동 슬롯 2", exact: true }),
  ).toContainText("비어 있음");
  await page
    .getByRole("button", { name: "전투로 돌아가기", exact: true })
    .click();
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page.getByRole("button", { name: "카이엘 선택", exact: true }).click();
  await waitSelected(page);
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page
    .getByRole("button", { name: "수동 슬롯 2 저장", exact: true })
    .click();
  await expect(page.getByTestId("save-notice")).toContainText(
    "슬롯에 현재 진행을 저장",
  );
  await page
    .getByRole("button", { name: "수동 슬롯 1 불러오기", exact: true })
    .click();
  await expect(page.getByTestId("save-notice")).toContainText(
    "선택한 저장을 복구",
  );
  expect((await latest(page)).battle).toEqual(first.battle);
  await expect(
    page.getByRole("listitem", { name: "수동 슬롯 2", exact: true }),
  ).toContainText("2명령");
  await page
    .getByRole("button", { name: "출격 준비 체크포인트 불러오기", exact: true })
    .click();
  await expect(page.getByTestId("save-notice")).toContainText(
    "선택한 저장을 복구",
  );
  expect((await latest(page)).commands).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.getByRole("dialog", {
    name: "전투 저장 · 복구",
    exact: true,
  });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/system-save-slots-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  expect((await latest(page)).commands).toEqual([]);
});

test("practice and operation keep separate records across switching and reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await waitSelected(page);
  const practice = await latest(page);
  await page
    .getByRole("button", { name: "정식 출격 열기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "출격 준비 열기", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "대기", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page
    .getByRole("button", { name: "현재 전투 다시 저장", exact: true })
    .click();
  await expect(page.getByTestId("save-panel-status")).toContainText(
    "자동 저장 완료",
  );
  const operation = await latest(page, "operation");
  expect(operation.battle.mode).toBe("operation");
  expect(operation.battle.operation!.equipmentFunds).toBe(300);
  expect(operation.battle.inventory).toEqual({});
  await page
    .getByRole("button", { name: "전투로 돌아가기", exact: true })
    .click();
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  await expect(
    page.getByRole("button", { name: "연습 기록 열기", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "연습 기록 열기", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  expect(await latest(page)).toEqual(practice);
  expect(await latest(page, "operation")).toEqual(operation);
});

test("failed persistence prevents mode switching from discarding unsaved progress", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await waitSelected(page);
  await page.evaluate(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException("storage blocked", "SecurityError");
    };
  });
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page.getByRole("button", { name: "카이엘 선택", exact: true }).click();
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(page.getByTestId("save-status")).toContainText("저장 실패");
  await page
    .getByRole("button", { name: "정식 출격 열기", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "전투 저장 · 복구",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("연습 · 명령 2/1024");
  const backup = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "파일 내보내기", exact: true })
    .click();
  expect((await backup).suggestedFilename()).toContain("rev-2");
  await dialog
    .getByRole("button", { name: "전투로 돌아가기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "정식 출격 열기", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("acted")).toHaveText("행동 완료");
});
