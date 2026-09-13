import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { contentSchema } from "../../packages/schema/src/index";
import {
  apply,
  createBattle,
  spellTargetTiles,
  type BattleState,
  type ActCommand,
} from "../../packages/core/src/index";
import type { BattleSave } from "../../apps/web/src/storage/saveFormat";

const content = contentSchema.parse(
  JSON.parse(readFileSync("packages/content/data/two-crossings.json", "utf8")),
);
function sceneFor(spellId: string) {
  const initial = createBattle(content);
  const trained = apply(content, initial, {
    type: "train",
    commandId: "train",
    expectedRevision: 0,
    unitId: "A3",
    spellIds: [spellId],
  });
  if (!trained.ok) throw Error(trained.error);
  const before = trained.nextState;
  const caster = before.units.find((unit) => unit.id === "A3")!;
  const spell = content.spells.find((spell) => spell.id === spellId)!;
  const centers = spellTargetTiles(content, caster, spell);
  // Prefer the caster's squad when the spell supports a squad anchor.
  centers.sort(
    (a, b) =>
      Number(b.x === caster.pos.x && b.y === caster.pos.y) -
      Number(a.x === caster.pos.x && a.y === caster.pos.y),
  );
  for (const target of centers) {
    const command: ActCommand = {
      type: "act",
      commandId: `action-${before.revision + 1}`,
      expectedRevision: before.revision,
      unitId: "A3",
      path: [],
      action: {
        type: "cast",
        spellId,
        target,
        ...(spellId === "teleport" ? { destination: { x: 7, y: 4 } } : {}),
      },
    };
    const result = apply(content, before, command);
    if (!result.ok) continue;
    if (
      spellId === "meteor" &&
      !result.events.some((event) => event.type === "terrainChanged")
    )
      continue;
    return { before, command, result };
  }
  throw Error(`No legal ${spellId} scene`);
}
async function loadScene(page: Page, state: BattleState) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "부대 목록", exact: true }),
  ).toBeEnabled();
  await page.evaluate(async (battle) => {
    const formatPath = "/src/storage/saveFormat.ts";
    const storePath = "/src/storage/battleSaveStore.ts";
    const { createSave } = (await import(
      formatPath
    )) as typeof import("../../apps/web/src/storage/saveFormat");
    const { createCurrentBattleSaveStore } = (await import(
      storePath
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    await createCurrentBattleSaveStore().write(
      createSave(battle, { finishing: false, autoFollow: false }),
    );
  }, state);
  await page.reload();
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
}
async function latest(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/storage/battleSaveStore.ts";
    const { createCurrentBattleSaveStore } = (await import(
      path
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    return createCurrentBattleSaveStore().readRaw("latest");
  }) as Promise<BattleSave>;
}
async function tile(page: Page, pos: { x: number; y: number }) {
  await page
    .locator('canvas[data-ready="true"]')
    .click({ position: { x: pos.x * 48 + 24, y: pos.y * 48 + 24 } });
}
for (const spellId of ["attack-1", "summon-salamander", "meteor", "teleport"]) {
  test(`${spellId} previews real effects, animates them, and resumes exactly once`, async ({
    page,
  }) => {
    const scene = sceneFor(spellId);
    await loadScene(page, scene.before);
    await page.getByLabel("전투 연출").selectOption("detailed");
    await page.getByRole("button", { name: "부대 목록", exact: true }).click();
    await page.getByRole("button", { name: "미라 선택", exact: true }).click();
    await page.getByRole("button", { name: "마법", exact: true }).click();
    const spell = content.spells.find((spell) => spell.id === spellId)!;
    await page
      .getByRole("region", { name: "마법 목록" })
      .getByRole("button", { name: new RegExp(`^${spell.name}`) })
      .click();
    if (scene.command.action.type !== "cast") throw Error("cast");
    await tile(page, scene.command.action.target);
    if (spellId === "teleport") {
      await expect(
        page.getByRole("button", { name: "행동 확정" }),
      ).toBeDisabled();
      expect((await latest(page)).battle).toEqual(scene.before);
      await expect(page.getByRole("status")).toContainText("도착");
      await tile(page, scene.command.action.destination!);
      await expect(
        page.getByRole("button", { name: "대상 다시 선택" }),
      ).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "행동 확정" })).toBeEnabled();
    const marker =
      spellId === "attack-1"
        ? "공격 강화"
        : spellId === "summon-salamander"
          ? "소환"
          : spellId === "meteor"
            ? "지형"
            : "→";
    await expect(page.getByTestId("prediction")).toContainText(marker);
    expect((await latest(page)).battle).toEqual(scene.before);
    await page.screenshot({
      path: `test-results/${spellId}-preview.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "행동 확정" }).click();
    const dialog = page.getByRole("dialog", { name: "상세 마법", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(marker);
    await expect
      .poll(async () => (await latest(page)).battle)
      .toEqual(scene.result.nextState);
    await page.screenshot({
      path: `test-results/${spellId}-detail.png`,
      fullPage: true,
    });
    await page.reload();
    await expect(page.getByTestId("save-status")).toContainText(
      "저장 복구 완료",
    );
    await expect(dialog).toHaveCount(0);
    expect((await latest(page)).battle).toEqual(scene.result.nextState);
    if (spellId === "attack-1") {
      await page
        .getByRole("button", { name: "부대 목록", exact: true })
        .click();
      await page
        .getByRole("button", { name: "미라 선택", exact: true })
        .click();
      await expect(page.getByLabel("상태 효과")).toContainText("공격 강화 +3");
      const hud = await page.locator(".bottom-hud").boundingBox();
      const magic = await page.locator(".magic-stats").boundingBox();
      expect(magic!.y + magic!.height).toBeLessThanOrEqual(
        hud!.y + hud!.height,
      );
    }
    if (spellId === "summon-salamander") {
      await page
        .getByRole("button", { name: "부대 목록", exact: true })
        .click();
      const summon = scene.result.nextState.units.find((unit) => unit.summon)!;
      await expect(
        page.getByRole("button", {
          name: `${summon.id} ${summon.name} 선택`,
          exact: true,
        }),
      ).toContainText(summon.name);
    }
    await page.screenshot({
      path: `test-results/${spellId}-restored.png`,
      fullPage: true,
    });
  });
}
