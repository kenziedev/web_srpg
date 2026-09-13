import { expect, test } from "@playwright/test";

test("threat, zoom and keyboard destination share core preview without committing input twice", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.locator('canvas[data-ready="true"]');
  await expect(canvas).toBeVisible();
  await page.getByRole("button", { name: "연습 초기화", exact: true }).click();
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
  const revision = () =>
    page.evaluate(async () => {
      const path = "/src/storage/battleSaveStore.ts";
      const { createCurrentBattleSaveStore } = (await import(
        path
      )) as typeof import("../../apps/web/src/storage/battleSaveStore");
      return (await createCurrentBattleSaveStore().load()).save!.battle;
    });
  const before = await revision();
  await page.getByRole("button", { name: "적 위협 T", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-threat-count", /[1-9]\d*/);
  await expect(
    page.getByText("현재 적의 이동 후 물리 공격 범위", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "지도 축소", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-zoom", "0.5");
  await page
    .getByRole("button", { name: "지도 배율 초기화", exact: true })
    .click();
  await expect(canvas).toHaveAttribute("data-zoom", "1");
  await page
    .getByRole("button", { name: "키보드 타일 선택", exact: true })
    .click();
  await expect(canvas).toHaveAttribute("data-cursor", "8,10");
  await page.keyboard.press("ArrowUp");
  await expect(canvas).toHaveAttribute("data-cursor", "8,9");
  await page.keyboard.press("Space");
  await expect(canvas).toHaveAttribute("data-command-origin", "8,9");
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeEnabled();
  await page.keyboard.press("Enter");
  expect(await revision()).toEqual(before);
  await page.screenshot({
    path: "test-results/system-map-controls.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
  const after = await revision();
  expect(after.revision).toBe(1);
  expect(after.units.find((unit) => unit.id === "A2")!.pos).toEqual({
    x: 8,
    y: 9,
  });
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("t");
  expect(await revision()).toEqual(after);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "전투 저장 · 복구", exact: true }),
  ).toHaveCount(0);
});
