import { expect, test, type Page } from "@playwright/test";

async function selectUnit(page: Page, label: string) {
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function start(page: Page) {
  await page.goto("/");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
}

test("map input previews movement plus attack and applies predicted damage", async ({
  page,
}) => {
  await start(page);
  const canvas = page.locator('canvas[data-ready="true"]');
  await selectUnit(page, "A21 창병 선택");
  const box = (await canvas.boundingBox())!;
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
  await expect(page.getByTestId("acted")).toContainText("행동 완료");
  await expect(page.getByTestId("battle-feedback")).toHaveCount(0);
  await canvas.click({ position: tile(12, 10) });
  await expect(page.locator(".health-line strong")).toHaveText("5");
});

test("classic HUD shows selection, cancel, commit and reset without page errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await expect(
    page.getByRole("heading", { name: /두 개의 건널목/ }),
  ).toBeVisible();
  await selectUnit(page, "카이엘 선택");
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeEnabled();
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeDisabled();
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(page.getByTestId("acted")).toContainText("행동 완료");
  await page.getByRole("button", { name: "연습 초기화" }).click();
  await expect(page.getByTestId("acted")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/classic-hud.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("turn confirmation can cancel, then enemy turn runs and player acts again", async ({
  page,
}) => {
  await start(page);
  await selectUnit(page, "미라 선택");
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await page.getByRole("button", { name: /^턴 종료 E$/ }).click();
  await expect(page.getByRole("dialog")).toContainText("11기");
  await page.getByRole("button", { name: "계속 조작" }).click();
  await expect(page.getByTestId("round")).toHaveText("01");
  await expect(page.getByTestId("acted")).toHaveText("행동 완료");
  await page.getByRole("button", { name: /^턴 종료 E$/ }).click();
  await page.getByRole("button", { name: "턴 종료 확인", exact: true }).click();
  await expect(page.getByTestId("phase")).toHaveText("적군 턴", {
    timeout: 15000,
  });
  await expect(
    page.getByRole("button", { name: /^턴 종료 E$/ }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeDisabled();
  await expect(page.getByTestId("round")).toHaveText("02", { timeout: 15000 });
  await expect(page.getByTestId("phase")).toHaveText("아군 턴");
  await expect(page.getByTestId("acted")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "대기", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "test-results/second-turn.png",
    fullPage: true,
  });
});

test("all units spent can end the turn without a redundant confirmation", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("checkbox", { name: "빠른 진행" }).check();
  for (const label of [
    "카이엘 선택",
    "로엔 선택",
    "미라 선택",
    "A11 보병 선택",
    "A12 보병 선택",
    "A13 보병 선택",
    "A21 창병 선택",
    "A22 창병 선택",
    "A23 창병 선택",
    "A31 궁병 선택",
    "A32 궁병 선택",
    "A33 궁병 선택",
  ]) {
    await selectUnit(page, label);
    await page.getByRole("button", { name: "대기", exact: true }).click();
    await page.getByRole("button", { name: "행동 확정" }).click();
  }
  await expect(page.locator(".order-buttons")).toContainText("미행동 0기");
  await page.getByRole("button", { name: /^턴 종료 E$/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("round")).toHaveText("02", { timeout: 15000 });
});

test("reset cancels pending enemy automation and 1280×720 keeps controls visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await start(page);
  await page.getByRole("button", { name: /^턴 종료 E$/ }).click();
  await page.getByRole("button", { name: "턴 종료 확인", exact: true }).click();
  await expect(page.getByTestId("phase")).toHaveText("적군 턴", {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "연습 초기화" }).click();
  // Exceed the old pending callback delay: reset must invalidate it.
  await page.waitForTimeout(700);
  await expect(page.getByTestId("round")).toHaveText("01");
  await expect(page.getByTestId("phase")).toHaveText("아군 턴");
  await expect(
    page.getByRole("button", { name: "행동 확정" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: /^턴 종료 E$/ }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/classic-720p.png",
    fullPage: true,
  });
});
test("mission announces escort movement, ends in defeat and restarts cleanly", async ({
  page,
}) => {
  test.setTimeout(60000);
  await start(page);
  await expect(page.getByTestId("escort-status")).toContainText(
    "현재 (1, 10) → 다음 (3, 10)",
  );
  await expect(page.getByTestId("reinforcement-status")).toContainText(
    "3라운드 종료",
  );
  await page.getByLabel("빠른 진행").check();
  await page.getByLabel("용병 자동 행동").uncheck();
  for (let round = 1; round <= 10; round++) {
    await page.getByRole("button", { name: /^턴 종료 E$/ }).click();
    if (
      await page
        .getByRole("button", { name: "턴 종료 확인", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "턴 종료 확인", exact: true })
        .click();
    await expect
      .poll(
        async () =>
          (await page
            .getByRole("heading", { name: "작전 실패" })
            .isVisible()) ||
          (await page.getByTestId("round").textContent()) !==
            String(round).padStart(2, "0"),
        { timeout: 15000 },
      )
      .toBe(true);
    if (await page.getByRole("heading", { name: "작전 실패" }).isVisible())
      break;
    if (round === 1)
      await expect(page.getByTestId("escort-status")).toContainText(
        "현재 (3, 10)",
      );
  }
  await expect(page.getByRole("heading", { name: "작전 실패" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^턴 종료 E$/ }),
  ).toBeDisabled();
  await page.screenshot({
    path: "test-results/mission-defeat.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "다시 도전" }).click();
  await expect(page.getByTestId("round")).toHaveText("01");
  await expect(page.getByTestId("escort-status")).toContainText("현재 (1, 10)");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("manual attack visibly plays damage feedback and reset cancels its effects", async ({
  page,
}) => {
  await start(page);
  await selectUnit(page, "A21 창병 선택");
  const canvas = page.locator('canvas[data-ready="true"]');
  await canvas.click({ position: { x: 11 * 48 + 24, y: 10 * 48 + 24 } });
  await canvas.click({ position: { x: 12 * 48 + 24, y: 10 * 48 + 24 } });
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(page.getByTestId("battle-feedback")).toContainText("피해 5");
  await expect(
    page.getByRole("button", { name: /^턴 종료 E$/ }),
  ).toBeDisabled();
  await page.screenshot({ path: "test-results/combat-feedback.png" });
  await page.getByRole("button", { name: "연습 초기화" }).click();
  await expect(page.getByTestId("battle-feedback")).toHaveCount(0);
  await expect(page.getByTestId("round")).toHaveText("01");
});

test("end turn runs follower orders while manually held units remain spent", async ({
  page,
}) => {
  test.setTimeout(45000);
  await start(page);
  await page.getByLabel("빠른 진행").check();
  await expect(page.getByLabel("용병 자동 행동")).toBeChecked();
  await selectUnit(page, "A21 창병 선택");
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await selectUnit(page, "로엔 선택");
  await page
    .locator('canvas[data-ready="true"]')
    .click({ position: { x: 8 * 48 + 24, y: 8 * 48 + 24 } });
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await page.getByRole("button", { name: /^턴 종료 E$/ }).click();
  await expect(page.getByRole("dialog")).toContainText("미행동 용병");
  await page.getByRole("button", { name: "턴 종료 확인", exact: true }).click();
  await expect(page.getByTestId("battle-feedback")).toBeVisible({
    timeout: 5000,
  });
  await expect(
    page.getByRole("button", { name: /^턴 종료 E$/ }),
  ).toBeDisabled();
  await expect(page.getByTestId("round")).toHaveText("02", { timeout: 20000 });
  await expect(
    page.getByRole("button", { name: "부대 목록", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "안내", exact: true }).click();
  await page.getByText("최근 전투 기록", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("자동");
});
