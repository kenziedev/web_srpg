import { expect, test } from "@playwright/test";

test("map input previews movement plus attack and applies predicted damage", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.locator('canvas[data-ready="true"]');
  await expect(canvas).toBeVisible();
  await page
    .getByRole("button", { name: "A21 창병 선택", exact: true })
    .click();
  const box = (await canvas.boundingBox())!;
  // The initial camera centers at world (480, 384) and clamps to the 960×720 map.
  const scrollX = Math.max(0, Math.min(960 - box.width, 480 - box.width / 2));
  const scrollY = Math.max(0, Math.min(720 - box.height, 384 - box.height / 2));
  const tile = (x: number, y: number) => ({
    x: x * 48 + 24 - scrollX,
    y: y * 48 + 24 - scrollY,
  });
  await canvas.click({ position: tile(11, 10) });
  await expect(page.getByRole("status")).toContainText("(11, 10)");
  await canvas.click({ position: tile(12, 10) });
  await expect(page.getByTestId("prediction")).toContainText("기병 −5 HP");
  await expect(page.getByTestId("prediction")).toContainText("창병 −0 HP");
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(
    page.getByRole("button", { name: "A21 창병 선택", exact: true }),
  ).toContainText("✓");
  // With the actor spent, selecting the defender opens its updated stats.
  await canvas.click({ position: tile(12, 10) });
  await expect(page.locator(".health-line strong")).toHaveText("5");
});

test("map mounts, preview is cancellable, wait commits once, reset restores", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "두 개의 건널목" }),
  ).toBeVisible();
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await page.getByRole("button", { name: "카이엘 선택", exact: true }).click();
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeEnabled();
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeDisabled();
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(
    page.getByRole("button", { name: "카이엘 선택", exact: true }),
  ).toContainText("행동 완료");
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeDisabled();
  await page.getByRole("button", { name: "연습 초기화" }).click();
  await expect(
    page.getByRole("button", { name: "카이엘 선택", exact: true }),
  ).not.toContainText("행동 완료");
  await page.screenshot({ path: "test-results/workbench.png", fullPage: true });
  expect(errors).toEqual([]);
});
