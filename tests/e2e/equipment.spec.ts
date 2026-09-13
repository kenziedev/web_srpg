import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { contentSchema } from "../../packages/schema/src/index";
import { apply, createBattle } from "../../packages/core/src/index";
import type { BattleSave } from "../../apps/web/src/storage/saveFormat";

const content = contentSchema.parse(
  JSON.parse(readFileSync("packages/content/data/two-crossings.json", "utf8")),
);

async function latest(page: Page): Promise<BattleSave> {
  return page.evaluate(async () => {
    const storePath = "/src/storage/battleSaveStore.ts";
    const { createCurrentBattleSaveStore } = (await import(
      storePath
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    return createCurrentBattleSaveStore().readRaw("latest");
  }) as Promise<BattleSave>;
}
async function open(page: Page) {
  await page
    .getByRole("button", { name: "장비 · 마법 편성", exact: true })
    .click();
  const panel = page.getByRole("dialog", { name: "부대 장비", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}
async function saved(page: Page) {
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
  const result = await latest(page);
  let replay = createBattle(content);
  for (const command of result.commands) {
    const applied = apply(content, replay, command);
    if (!applied.ok) throw new Error(applied.error);
    replay = applied.nextState;
  }
  expect(result.battle).toEqual(replay);
  return result;
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "장비 · 마법 편성", exact: true }),
  ).toBeEnabled();
});

test("orb updates effective MP, preserves the original spell loadout and restores the exact saved preparation", async ({
  page,
}) => {
  let panel = await open(page);
  await panel.getByLabel("장비 지휘관", { exact: true }).selectOption("A3");
  await panel.getByRole("button", { name: "오브 장착", exact: true }).click();
  await expect(panel.getByLabel("장비 적용 능력치")).toContainText("18 / 18");
  const snapshot = await saved(page);
  expect(snapshot.battle.units.find((unit) => unit.id === "A3")).toMatchObject({
    mp: 18,
    stats: { maxMp: 9 },
    equipment: { weapon: "orb", armor: null },
    spellIds: ["heal-1", "magic-arrow", "fireball", "force-heal-1"],
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await panel
    .getByRole("button", { name: "전투로 돌아가기", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    panel.getByRole("button", { name: "전투로 돌아가기", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: "test-results/equipment-orb-1280.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  expect(await latest(page)).toEqual(snapshot);
  panel = await open(page);
  await panel.getByLabel("장비 지휘관", { exact: true }).selectOption("A3");
  await expect(
    panel.getByRole("button", { name: "오브 장착", exact: true }),
  ).toBeDisabled();
  await expect(panel.getByLabel("장비 적용 능력치")).toContainText("18 / 18");
  await panel.getByRole("button", { name: "무기 해제", exact: true }).click();
  await expect(panel.getByLabel("장비 적용 능력치")).toContainText("9 / 9");
  const removed = await saved(page);
  expect(removed.battle.inventory.orb).toBe(1);
  expect(removed.commands).toHaveLength(2);
});

test("one owned sword cannot be shared and can be reassigned after its holder removes it", async ({
  page,
}) => {
  const panel = await open(page);
  await panel
    .getByRole("button", { name: "그레이트 소드 장착", exact: true })
    .click();
  await saved(page);
  await panel.getByLabel("장비 지휘관", { exact: true }).selectOption("A2");
  await expect(
    panel.getByRole("button", { name: "그레이트 소드 장착", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("listitem").filter({
      has: page.getByRole("button", {
        name: "그레이트 소드 장착",
        exact: true,
      }),
    }),
  ).toContainText("남는 소유 장비가 없습니다.");
  await panel.getByLabel("장비 지휘관", { exact: true }).selectOption("A1");
  await panel.getByRole("button", { name: "무기 해제", exact: true }).click();
  await saved(page);
  await panel.getByLabel("장비 지휘관", { exact: true }).selectOption("A2");
  await panel
    .getByRole("button", { name: "그레이트 소드 장착", exact: true })
    .click();
  const snapshot = await saved(page);
  expect(
    snapshot.battle.units
      .filter((unit) => unit.equipment?.weapon === "great-sword")
      .map((unit) => unit.id),
  ).toEqual(["A2"]);
  expect(snapshot.battle.inventory["great-sword"]).toBe(1);
  expect(snapshot.commands).toHaveLength(3);
});

test("spell preparation adds selected PC spells without discarding the four defaults or refilling MP", async ({
  page,
}) => {
  let panel = await open(page);
  let training = panel.getByRole("region", {
    name: "연습 마법 편성",
    exact: true,
  });
  await expect(training.locator('input[type="checkbox"]:checked')).toHaveCount(
    4,
  );
  await expect(
    training.getByRole("button", { name: "마법 편성 적용", exact: true }),
  ).toBeDisabled();
  await training
    .getByRole("checkbox", { name: "어택 1 편성", exact: true })
    .check();
  await training
    .getByRole("checkbox", { name: "퀵 편성", exact: true })
    .check();
  // An equipment command clones battle state; unsaved spell choices must survive it.
  await panel.getByLabel("장비 지휘관").selectOption("A3");
  await panel.getByRole("button", { name: "완드 장착", exact: true }).click();
  await saved(page);
  await expect(
    training.getByRole("checkbox", { name: "어택 1 편성", exact: true }),
  ).toBeChecked();
  await expect(
    training.getByRole("checkbox", { name: "퀵 편성", exact: true }),
  ).toBeChecked();
  await training
    .getByRole("button", { name: "마법 편성 적용", exact: true })
    .click();
  const snapshot = await saved(page);
  expect(snapshot.battle.units.find((unit) => unit.id === "A3")).toMatchObject({
    mp: 9,
    spellIds: [
      "heal-1",
      "magic-arrow",
      "fireball",
      "force-heal-1",
      "attack-1",
      "quick",
    ],
  });
  expect(snapshot.commands.at(-1)).toMatchObject({
    type: "train",
    unitId: "A3",
  });
  await page.screenshot({
    path: "test-results/equipment-spell-training.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  expect(await latest(page)).toEqual(snapshot);
  panel = await open(page);
  training = panel.getByRole("region", { name: "연습 마법 편성", exact: true });
  await expect(training.locator('input[type="checkbox"]:checked')).toHaveCount(
    6,
  );
  await expect(
    training.getByRole("checkbox", { name: "퀵 편성", exact: true }),
  ).toBeChecked();
  await expect(
    training.getByRole("button", { name: "마법 편성 적용", exact: true }),
  ).toBeDisabled();
});

test("EXP sword can be equipped, rune explains its use, and the first action closes preparation", async ({
  page,
}) => {
  let panel = await open(page);
  await expect(
    panel.getByRole("button", { name: "메사이얀 소드 장착", exact: true }),
  ).toBeEnabled();
  await panel
    .getByRole("button", { name: "메사이얀 소드 장착", exact: true })
    .click();
  expect(
    (await saved(page)).battle.units.find((unit) => unit.id === "A1")?.equipment
      ?.weapon,
  ).toBe("masayan-sword");
  await panel.getByRole("button", { name: /^방어구 · 장신구/ }).click();
  await expect(
    panel.getByRole("button", { name: "룬스톤 장착", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("listitem").filter({
      has: page.getByRole("button", { name: "룬스톤 장착", exact: true }),
    }),
  ).toContainText("전직");
  await panel
    .getByRole("button", { name: "전투로 돌아가기", exact: true })
    .click();
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page.getByRole("button", { name: "카이엘 선택", exact: true }).click();
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  const snapshot = await saved(page);
  panel = await open(page);
  await expect(panel).toContainText("전투가 시작되어 장비 변경이 잠겼습니다.");
  await expect(
    panel.getByRole("button", { name: "나이프 장착", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("checkbox", { name: "퀵 편성", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "마법 편성 적용", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(await latest(page)).toEqual(snapshot);
});
