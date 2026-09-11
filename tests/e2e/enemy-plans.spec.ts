import { expect, test } from "@playwright/test";

test("the disclosed guard operation changes from northern ford to southern escort road at round 3", async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  const intent = page.getByTestId("enemy-intent");
  await expect(intent).toHaveText(
    "경비대장: 북쪽 여울 견제 → 3R 남쪽 호송로 압박",
  );
  await expect(intent).toBeInViewport();
  await page.getByLabel("빠른 진행").check();
  await page.getByLabel("용병 자동 행동").uncheck();
  for (const nextRound of ["02", "03"]) {
    await page.getByRole("button", { name: /^턴 종료 E$/ }).click();
    await page
      .getByRole("button", { name: "턴 종료 확인", exact: true })
      .click();
    await expect(page.getByTestId("round")).toHaveText(nextRound, {
      timeout: 15000,
    });
    await expect(page.getByTestId("phase")).toHaveText("아군 턴");
    await expect(intent).toContainText(
      nextRound === "02" ? "북쪽 여울 견제 →" : "경비대장: 남쪽 호송로 압박",
    );
  }
  await expect(intent).not.toContainText("북쪽");
  await page.screenshot({
    path: "test-results/enemy-operation-round3.png",
    fullPage: true,
  });
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
  await page.reload();
  await expect(page.getByTestId("round")).toHaveText("03");
  await expect(intent).toHaveText("경비대장: 남쪽 호송로 압박");
});
