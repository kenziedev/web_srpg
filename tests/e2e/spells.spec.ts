import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { contentSchema } from "../../packages/schema/src/index";
import {
  apply,
  createBattle,
  nextEnemyCommand,
  phaseEndCommand,
  reachable,
  samePosition,
  spellTargetTiles,
  type ActCommand,
  type BattleState,
  type Command,
} from "../../packages/core/src/index";
import type { BattleSave } from "../../apps/web/src/storage/saveFormat";

const content = contentSchema.parse(
  JSON.parse(readFileSync("packages/content/data/two-crossings.json", "utf8")),
);
const route = JSON.parse(
  readFileSync("packages/sim/fixtures/frontal-clear.json", "utf8"),
) as { commands: Command[] };

// Pick a real, replayable position. No edited HP, MP, units, or initial state.
function sceneFor(spellId: string, minimumTargets = 1, emptyCenter = false) {
  let before = createBattle(content);
  const spell = content.spells.find((s) => s.id === spellId)!;
  for (const recorded of route.commands) {
    const caster = before.units.find((u) => u.id === "A3");
    if (before.activeSide === "player" && caster && !caster.acted) {
      for (const move of reachable(content, before, caster)) {
        for (const target of spellTargetTiles(
          content,
          caster,
          spell,
          move.pos,
        )) {
          if (
            emptyCenter &&
            before.units.some((u) => samePosition(u.pos, target))
          )
            continue;
          const command: ActCommand = {
            type: "act",
            commandId: `action-${before.revision + 1}`,
            expectedRevision: before.revision,
            unitId: caster.id,
            path: move.path,
            action: { type: "cast", spellId, target },
          };
          const result = apply(content, before, command);
          if (
            result.ok &&
            result.events.filter(
              (e) =>
                (e.type === "damaged" || e.type === "healed") && e.amount > 0,
            ).length >= minimumTargets
          )
            return { before, command, result };
        }
      }
    }
    const next = apply(content, before, recorded);
    if (!next.ok) throw Error(next.error);
    before = next.nextState;
  }
  throw Error(`No replayable scene for ${spellId}`);
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
    const { createBattleSaveStore } = (await import(
      storePath
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    await createBattleSaveStore().write(
      createSave(battle, { finishing: false, autoFollow: false }),
    );
  }, state);
  await page.reload();
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
}

async function latest(page: Page) {
  return page.evaluate(async () => {
    const storePath = "/src/storage/battleSaveStore.ts";
    const { createBattleSaveStore } = (await import(
      storePath
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    return await createBattleSaveStore().readRaw("latest");
  }) as Promise<BattleSave>;
}

async function selectCaster(page: Page) {
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page.getByRole("button", { name: "미라 선택", exact: true }).click();
}
async function tile(page: Page, pos: { x: number; y: number }) {
  await page
    .locator('canvas[data-ready="true"]')
    .click({ position: { x: pos.x * 48 + 24, y: pos.y * 48 + 24 } });
}
async function prepare(page: Page, command: ActCommand) {
  if (command.action.type !== "cast") throw Error("Expected a cast");
  await selectCaster(page);
  const destination = command.path.at(-1);
  if (destination) {
    await tile(page, destination);
    await expect(page.getByRole("button", { name: "행동 확정" })).toBeEnabled();
  }
  await page.getByRole("button", { name: "마법", exact: true }).click();
  const spellId = command.action.spellId;
  const spell = content.spells.find((s) => s.id === spellId)!;
  if (spellId === "fireball")
    await page.screenshot({
      path: "test-results/spell-menu.png",
      fullPage: true,
    });
  await page
    .getByRole("region", { name: "마법 목록" })
    .getByRole("button", { name: new RegExp(`^${spell.name}`) })
    .click();
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeDisabled();
  await tile(page, command.action.target);
}

test("spell selection and invalid range never commit a move, MP, or save", async ({
  page,
}) => {
  const scene = sceneFor("fireball", 2, true);
  await loadScene(page, scene.before);
  const original = await latest(page);
  await prepare(page, scene.command);
  const hits = scene.result.events.filter((e) => e.type === "damaged");
  await expect(page.getByTestId("prediction").locator("span")).toHaveCount(
    hits.length,
  );
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeEnabled();
  expect(await latest(page)).toEqual(original);
  await page.screenshot({
    path: "test-results/spell-area-preview.png",
    fullPage: true,
  });
  const caster = scene.before.units.find((unit) => unit.id === "A3")!;
  const spell = content.spells.find((entry) => entry.id === "fireball")!;
  const centers = spellTargetTiles(
    content,
    caster,
    spell,
    scene.command.path.at(-1) ?? caster.pos,
  );
  const outside = Array.from({ length: content.scenario.width }, (_, x) => ({
    x,
    y: 7,
  })).find((pos) => !centers.some((center) => samePosition(center, pos)))!;
  await tile(page, outside);
  await expect(page.getByRole("status")).toContainText("사거리");
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("prediction")).toHaveCount(0);
  expect(await latest(page)).toEqual(original);
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  expect((await latest(page)).battle).toEqual(scene.before);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`area spell hits every previewed enemy once and resumes after reload (${reducedMotion})`, async ({
    page,
  }) => {
    const scene = sceneFor("fireball", 2, true);
    await page.emulateMedia({ reducedMotion });
    await loadScene(page, scene.before);
    await page.getByLabel("전투 연출").selectOption("detailed");
    await prepare(page, scene.command);
    await page.getByRole("button", { name: "행동 확정" }).click();
    const dialog = page.getByRole("dialog", { name: "상세 마법", exact: true });
    await expect(dialog).toBeVisible();
    const cast = scene.result.events.find((e) => e.type === "spellCast")!;
    for (const id of cast.affectedIds) {
      const removed = scene.result.events.find(
        (event) => event.type === "removed" && event.unitId === id,
      );
      await expect(dialog.getByTestId(`spell-result-${id}`)).toContainText(
        removed?.type === "removed" && removed.reason === "retreated"
          ? "퇴각"
          : `HP ${scene.before.units.find((u) => u.id === id)!.hp} → ${scene.result.nextState.units.find((u) => u.id === id)?.hp ?? 0}`,
      );
    }
    const beforeMp = scene.before.units.find((unit) => unit.id === "A3")!.mp;
    const afterMp = scene.result.nextState.units.find(
      (unit) => unit.id === "A3",
    )!.mp;
    await expect(dialog).toContainText(`MP ${beforeMp} → ${afterMp}`);
    await expect(dialog).toHaveAttribute("data-phase", "release");
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(
      dialog.getByRole("button", { name: "건너뛰기" }),
    ).toBeInViewport();
    await page.screenshot({
      path: `test-results/spell-detailed-${reducedMotion}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByLabel("마법 대상과 부대 퇴각 확정 결과"),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "건너뛰기" }),
    ).toBeFocused();
    await expect(page.getByTestId("save-status")).toContainText(
      "자동 저장 완료",
    );
    expect((await latest(page)).battle).toEqual(scene.result.nextState);
    if (reducedMotion === "reduce") await page.keyboard.press("Escape");
    // Reload while the normal animation is still on screen, or after skip.
    await page.reload();
    await expect(page.getByTestId("save-status")).toContainText(
      "저장 복구 완료",
    );
    await expect(dialog).toHaveCount(0);
    expect((await latest(page)).battle).toEqual(scene.result.nextState);
  });
}

test("single damage and learned healing use the same cast input and saved result", async ({
  page,
}) => {
  for (const spellId of ["magic-arrow", "heal-1", "force-heal-1"]) {
    const scene = sceneFor(spellId);
    await loadScene(page, scene.before);
    await page.getByLabel("빠른 진행").check();
    await prepare(page, scene.command);
    await expect(page.getByRole("button", { name: "행동 확정" })).toBeEnabled();
    await page.getByRole("button", { name: "행동 확정" }).click();
    await expect(page.getByTestId("save-status")).toContainText(
      "자동 저장 완료",
    );
    expect((await latest(page)).battle).toEqual(scene.result.nextState);
    await expect(
      page.getByRole("button", { name: "부대 목록", exact: true }),
    ).toBeEnabled();
  }
});

test("insufficient MP rejects force healing without consuming the next turn", async ({
  page,
}) => {
  const spell = content.spells.find((entry) => entry.id === "force-heal-1")!;
  let state = createBattle(content);
  let spent = false;
  // Branch from a genuine wounded-caster turn, replacing that turn's action
  // with a learned spell. All HP/MP changes still come from replayable commands.
  for (const recorded of route.commands) {
    const caster = state.units.find((unit) => unit.id === "A3")!;
    if (
      recorded.type === "act" &&
      recorded.unitId === caster.id &&
      caster.mp >= spell.mpCost &&
      caster.mp < spell.mpCost * 2
    ) {
      const result = apply(content, state, {
        ...recorded,
        commandId: `mp-setup-${state.revision + 1}`,
        action: {
          type: "cast",
          spellId: spell.id,
          target: recorded.path.at(-1) ?? caster.pos,
        },
      });
      if (result.ok) {
        state = result.nextState;
        spent = true;
        break;
      }
    }
    const next = apply(content, state, recorded);
    if (!next.ok) throw Error(next.error);
    state = next.nextState;
  }
  expect(spent).toBe(true);
  for (let count = 0; count < 44; count++) {
    const command =
      state.activeSide === "enemy"
        ? nextEnemyCommand(content, state)
        : phaseEndCommand(state);
    if (!command) throw Error("Unexpected finished battle");
    const next = apply(content, state, command);
    if (!next.ok) throw Error(next.error);
    state = next.nextState;
    if (state.activeSide === "player") break;
  }
  const caster = state.units.find((unit) => unit.id === "A3")!;
  expect(state.activeSide).toBe("player");
  expect(state.outcome).toBeNull();
  expect(caster.acted).toBe(false);
  expect(caster.hp).toBeLessThan(10);
  expect(caster.mp).toBeLessThan(spell.mpCost);
  await loadScene(page, state);
  const original = await latest(page);
  await prepare(page, {
    type: "act",
    commandId: `action-${state.revision + 1}`,
    expectedRevision: state.revision,
    unitId: caster.id,
    path: [],
    action: { type: "cast", spellId: spell.id, target: caster.pos },
  });
  await expect(page.getByRole("status")).toContainText("MP가 부족");
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeDisabled();
  expect(await latest(page)).toEqual(original);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "정비", exact: true }).click();
  await expect(page.getByRole("button", { name: "행동 확정" })).toBeEnabled();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
  const saved = await latest(page);
  expect(
    saved.battle.units.find((unit) => unit.id === caster.id),
  ).toMatchObject({
    mp: Math.min(caster.stats.maxMp, caster.mp + 2),
    acted: true,
  });
  expect(saved.revision).toBe(original.revision + 1);
  expect(saved.commands.at(-1)).toMatchObject({ action: { type: "treat" } });
});
