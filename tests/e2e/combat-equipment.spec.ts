import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { contentSchema } from "../../packages/schema/src/index";
import { apply, createBattle } from "../../packages/core/src/index";
import type { BattleSave } from "../../apps/web/src/storage/saveFormat";

const content = contentSchema.parse(
  JSON.parse(readFileSync("packages/content/data/two-crossings.json", "utf8")),
);

test("an arbalest with minimum range 1 uses projectiles at distance 4 and keeps the melee defender inactive", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await page
    .getByRole("button", { name: "장비 · 마법 편성", exact: true })
    .click();
  const panel = page.getByRole("dialog", { name: "부대 장비", exact: true });
  await panel.getByLabel("장비 지휘관", { exact: true }).selectOption("A2");
  await panel
    .getByRole("button", { name: "아바 레스트 장착", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
  await panel
    .getByRole("button", { name: "전투로 돌아가기", exact: true })
    .click();
  await page.getByLabel("전투 연출", { exact: true }).selectOption("detailed");
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page.getByRole("button", { name: "로엔 선택", exact: true }).click();
  const target = content.scenario.units.find((unit) => unit.id === "E11")!;
  await page.locator('canvas[data-ready="true"]').click({
    position: { x: target.pos.x * 48 + 24, y: target.pos.y * 48 + 24 },
  });
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeEnabled();
  await page.getByRole("button", { name: "행동 확정" }).click();
  const dialog = page.getByRole("dialog", { name: "상세 전투", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".army-0")).toHaveAttribute(
    "data-attack-style",
    "ranged",
  );
  await expect(dialog.locator(".army-1")).toHaveAttribute(
    "data-attack-style",
    "inactive",
  );
  await expect(dialog.locator(".projectile-0").first()).toBeVisible();
  await expect(dialog.locator(".projectile-1")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("arbalest-projectiles.png"),
    fullPage: true,
  });
  const save = (await page.evaluate(async () => {
    const storePath = "/src/storage/battleSaveStore.ts";
    const { createCurrentBattleSaveStore } = (await import(
      storePath
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    return createCurrentBattleSaveStore().readRaw("latest");
  })) as BattleSave;
  let replay = createBattle(content);
  for (const command of save.commands) {
    const result = apply(content, replay, command);
    if (!result.ok) throw Error(result.error);
    replay = result.nextState;
  }
  expect(save.battle).toEqual(replay);
  expect(save.commands.at(-1)).toMatchObject({
    type: "act",
    unitId: "A2",
    action: { type: "attack", targetId: "E11" },
  });
});
