import { test, expect, type Page } from "@playwright/test";
async function attack(page: Page) {
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page
    .getByRole("button", { name: "A21 창병 선택", exact: true })
    .click();
  const canvas = page.locator('canvas[data-ready="true"]');
  await canvas.click({ position: { x: 11 * 48 + 24, y: 10 * 48 + 24 } });
  await canvas.click({ position: { x: 12 * 48 + 24, y: 10 * 48 + 24 } });
  await page.getByRole("button", { name: "행동 확정" }).click();
}
async function start(page: Page) {
  await page.goto("/");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
}
async function checkDamage(page: Page) {
  await expect(
    page.getByRole("button", { name: "부대 목록", exact: true }),
  ).toBeEnabled();
  await page
    .locator('canvas[data-ready="true"]')
    .click({ position: { x: 12 * 48 + 24, y: 10 * 48 + 24 } });
  await expect(page.locator(".health-line strong")).toHaveText("5");
}
test("detailed combat shows both formations and resolved HP, then returns to map", async ({
  page,
}) => {
  await start(page);
  await expect(page.getByLabel("전투 연출")).toHaveValue("simple");
  await page.getByLabel("전투 연출").selectOption("detailed");
  await attack(page);
  const dialog = page.getByRole("dialog", { name: "상세 전투", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".duel-fighter")).toHaveCount(20);
  await expect(dialog.getByLabel("방어 HP", { exact: true })).toContainText(
    "5",
  );
  await page.screenshot({ path: "test-results/detailed-battle.png" });
  await expect(dialog).toHaveCount(0, { timeout: 6000 });
  await checkDamage(page);
});
test("skip does not apply damage twice and simple mode produces the same HP", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await page.getByLabel("전투 연출").selectOption("detailed");
  await attack(page);
  await page.getByRole("button", { name: "건너뛰기" }).click();
  await checkDamage(page);
  await page.getByRole("button", { name: "연습 초기화" }).click();
  await page.getByLabel("전투 연출").selectOption("simple");
  await attack(page);
  await expect(
    page.getByRole("dialog", { name: "상세 전투", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("battle-feedback")).toBeVisible();
  await checkDamage(page);
  expect(errors).toEqual([]);
});
test("render preference survives reload and Escape skips only the active detailed battle", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("전투 연출").selectOption("detailed");
  await page.reload();
  await expect(page.getByLabel("전투 연출")).toHaveValue("detailed");
  await attack(page);
  await expect(
    page.getByRole("dialog", { name: "상세 전투", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await checkDamage(page);
  await expect(page.getByTestId("round")).toHaveText("01");
});
