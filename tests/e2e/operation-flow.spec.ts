import { expect, test, type Page } from "@playwright/test";
import type { BattleSave } from "../../apps/web/src/storage/saveFormat";

async function latest(page: Page): Promise<BattleSave | null> {
  return page.evaluate(async () => {
    const path = "/src/storage/battleSaveStore.ts";
    const { createCurrentBattleSaveStore } = (await import(
      path
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    // load() validates the checksum, canonical mode and complete production replay.
    return (await createCurrentBattleSaveStore("operation").load()).save;
  });
}
async function savedAt(page: Page, revision: number): Promise<BattleSave> {
  await expect.poll(async () => (await latest(page))?.revision).toBe(revision);
  return (await latest(page))!;
}
async function checkpoint(page: Page): Promise<BattleSave> {
  return page.evaluate(async () => {
    const path = "/src/storage/battleSaveStore.ts";
    const { createCurrentBattleSaveStore } = (await import(
      path
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    return (await createCurrentBattleSaveStore("operation").loadSlot(
      "preparation",
    ))!;
  });
}
async function openOperation(page: Page) {
  await page
    .getByRole("button", { name: "출격 준비 · 상점", exact: true })
    .click();
  const panel = page.getByRole("dialog", { name: "작전 준비", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}
async function beginOperation(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "정식 출격 열기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "연습 기록 열기", exact: true }),
  ).toBeEnabled();
  return openOperation(page);
}

test("operation mode shows its own budget, enforces class hiring, and returns a removed slot's full cost", async ({
  page,
}, testInfo) => {
  const panel = await beginOperation(page);
  await expect(panel.locator(".operation-budget dd")).toHaveText([
    "1200",
    "1020",
    "180",
    "300",
  ]);
  await expect(
    panel.getByRole("button", { name: "창병 고용", exact: true }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("button", { name: "기병 고용", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "비병 고용", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "수병 고용", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "성직병 고용", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "출격 확정", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("operation-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await panel.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("operation-mobile.png"),
    fullPage: true,
  });
  await panel.getByRole("button", { name: "창병 고용", exact: true }).click();
  let saved = await savedAt(page, 1);
  expect(saved.battle.mode).toBe("operation");
  expect(saved.battle.operation!.hires.A11).toBe("pike");
  expect(saved.battle.units.find((unit) => unit.id === "A11")!.unitType).toBe(
    "pike",
  );
  await expect(panel.locator(".operation-budget dd")).toHaveText([
    "1200",
    "1030",
    "170",
    "300",
  ]);
  await panel
    .getByRole("button", { name: "선택 자리 비우기", exact: true })
    .click();
  saved = await savedAt(page, 2);
  expect(saved.battle.operation!.hires.A11).toBeNull();
  expect(saved.battle.units.some((unit) => unit.id === "A11")).toBe(false);
  await expect(panel.locator(".operation-budget dd")).toHaveText([
    "1200",
    "920",
    "280",
    "300",
  ]);
  await panel.getByRole("button", { name: "보병 고용", exact: true }).click();
  saved = await savedAt(page, 3);
  expect(saved.battle.operation!.hires.A11).toBe("infantry");
  await expect(panel.locator(".operation-budget dd")).toHaveText([
    "1200",
    "1020",
    "180",
    "300",
  ]);
  await panel.getByRole("button", { name: "전장 보기", exact: true }).click();
  await page
    .getByRole("button", { name: "연습 기록 열기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "정식 출격 열기", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "정식 출격 열기", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  expect((await latest(page))!.battle).toEqual(saved.battle);
});

test("operation shop preserves worn items and spell preparation offers only formally learned magic", async ({
  page,
}) => {
  let panel = await beginOperation(page);
  await panel.getByRole("button", { name: "장비 상점", exact: true }).click();
  await panel.getByRole("button", { name: "나이프 구매", exact: true }).click();
  let saved = await savedAt(page, 1);
  expect(saved.battle.inventory.knife).toBe(1);
  expect(saved.battle.operation!.equipmentFunds).toBe(250);
  await panel
    .getByRole("button", { name: "장비 · 마법 편성", exact: true })
    .click();
  const equipment = page.getByRole("dialog", {
    name: "부대 장비",
    exact: true,
  });
  await equipment
    .getByRole("button", { name: "나이프 장착", exact: true })
    .click();
  saved = await savedAt(page, 2);
  expect(
    saved.battle.units.find((unit) => unit.id === "A1")!.equipment!.weapon,
  ).toBe("knife");
  const training = equipment.getByRole("region", {
    name: "학습 마법 편성",
    exact: true,
  });
  await expect(training.getByRole("checkbox")).toHaveCount(4);
  await expect(
    training.getByRole("checkbox", { name: "메테오 편성", exact: true }),
  ).toHaveCount(0);
  await training
    .getByRole("checkbox", { name: "파이어볼 편성", exact: true })
    .uncheck();
  await training
    .getByRole("button", { name: "마법 편성 적용", exact: true })
    .click();
  saved = await savedAt(page, 3);
  const mage = saved.battle.units.find((unit) => unit.id === "A3")!;
  expect(mage.spellIds).not.toContain("fireball");
  expect(mage.progression!.learnedSpellIds).toContain("fireball");
  expect(mage.mp).toBe(9);
  await equipment
    .getByRole("button", { name: "전투로 돌아가기", exact: true })
    .click();
  panel = await openOperation(page);
  await panel.getByRole("button", { name: "장비 상점", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "나이프 판매", exact: true }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "나이프 구매", exact: true }).click();
  saved = await savedAt(page, 4);
  expect(saved.battle.inventory.knife).toBe(2);
  expect(saved.battle.operation!.equipmentFunds).toBe(200);
  await panel.getByRole("button", { name: "나이프 판매", exact: true }).click();
  saved = await savedAt(page, 5);
  expect(saved.battle.inventory.knife).toBe(1);
  expect(saved.battle.operation!.equipmentFunds).toBe(225);
  expect(
    saved.battle.units.find((unit) => unit.id === "A1")!.equipment!.weapon,
  ).toBe("knife");
  await expect(
    panel.getByRole("button", { name: "나이프 판매", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  expect((await latest(page))!.battle).toEqual(saved.battle);
});

test("explicit deployment locks preparation, reload preserves it, and checkpoint restoration returns the full setup", async ({
  page,
}, testInfo) => {
  let panel = await beginOperation(page);
  await panel
    .getByRole("button", { name: "선택 자리 비우기", exact: true })
    .click();
  await savedAt(page, 1);
  await panel.getByRole("button", { name: "장비 상점", exact: true }).click();
  await panel.getByRole("button", { name: "나이프 구매", exact: true }).click();
  const prepared = await savedAt(page, 2);
  expect(prepared.battle.operation!.phase).toBe("preparation");
  expect((await checkpoint(page)).battle).toEqual(prepared.battle);
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  await expect(
    page.getByRole("button", { name: "출격 준비 열기", exact: true }),
  ).toBeVisible();
  expect((await latest(page))!.battle).toEqual(prepared.battle);
  panel = await openOperation(page);
  await panel.getByRole("button", { name: "출격 확정", exact: true }).click();
  const started = await savedAt(page, 3);
  expect(started.commands.at(-1)!.type).toBe("startBattle");
  expect(started.battle.operation!.phase).toBe("battle");
  expect((await checkpoint(page)).battle).toEqual(prepared.battle);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  expect((await latest(page))!.battle).toEqual(started.battle);
  panel = await openOperation(page);
  await expect(panel).toContainText("편성과 거래가 잠겼습니다.");
  await expect(
    panel.getByRole("button", { name: "창병 고용", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "출격 확정", exact: true }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "장비 상점", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "나이프 구매", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("operation-started-locked.png"),
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "장비 · 마법 편성", exact: true })
    .click();
  const equipment = page.getByRole("dialog", {
    name: "부대 장비",
    exact: true,
  });
  await expect(
    equipment.getByRole("button", { name: "나이프 장착", exact: true }),
  ).toBeDisabled();
  for (const checkbox of await equipment
    .getByRole("region", { name: "학습 마법 편성", exact: true })
    .getByRole("checkbox")
    .all())
    await expect(checkbox).toBeDisabled();
  await equipment
    .getByRole("button", { name: "전투로 돌아가기", exact: true })
    .click();
  await page.getByRole("button", { name: "저장 · 복구", exact: true }).click();
  await page
    .getByRole("button", { name: "출격 준비 체크포인트 불러오기", exact: true })
    .click();
  await expect
    .poll(async () => (await latest(page))!.battle)
    .toEqual(prepared.battle);
  await expect(page.getByTestId("save-notice")).toContainText(
    "선택한 저장을 복구했습니다.",
  );
  await page
    .getByRole("button", { name: "전투로 돌아가기", exact: true })
    .click();
  panel = await openOperation(page);
  await expect(
    panel.getByRole("button", { name: "출격 확정", exact: true }),
  ).toBeEnabled();
  expect((await checkpoint(page)).battle).toEqual(prepared.battle);
});
