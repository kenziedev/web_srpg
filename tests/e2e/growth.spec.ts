import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { contentSchema } from "../../packages/schema/src/index";
import {
  apply,
  createBattle,
  type BattleState,
  type Command,
} from "../../packages/core/src/index";
import type { BattleSave } from "../../apps/web/src/storage/saveFormat";

const content = contentSchema.parse(
  JSON.parse(readFileSync("packages/content/data/two-crossings.json", "utf8")),
);
const fixture = JSON.parse(
  readFileSync("packages/sim/fixtures/beacon-clear.json", "utf8"),
) as { commands: Command[] };
function run(state: BattleState, command: Command) {
  const result = apply(content, state, command);
  if (!result.ok) throw Error(result.error);
  return result.nextState;
}
function victory() {
  return fixture.commands.reduce(run, createBattle(content));
}
async function latest(page: Page): Promise<BattleSave> {
  return page.evaluate(async () => {
    const path = "/src/storage/battleSaveStore.ts";
    const { createBattleSaveStore } = (await import(
      path
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    return createBattleSaveStore().readRaw("latest");
  }) as Promise<BattleSave>;
}
async function load(page: Page, state: BattleState) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "성장 · 전직", exact: true }),
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
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
}

test("class comparisons explain the level requirement without changing progression on desktop and mobile", async ({
  page,
}) => {
  await load(page, createBattle(content));
  const snapshot = await latest(page);
  await page.getByRole("button", { name: "성장 · 전직", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "성장 · 전직", exact: true });
  await expect(panel.getByLabel("현재 성장 기록")).toContainText("Lv1 / 10");
  const branches = content.classes.find(
    (entry) => entry.id === "lord",
  )!.promotions;
  for (const classId of branches) {
    const name = content.classes.find((entry) => entry.id === classId)!.name;
    const card = panel.getByRole("listitem", {
      name: `${name} 전직 비교`,
      exact: true,
    });
    await expect(card).toContainText("Lv10");
    await expect(
      card.getByRole("button", { name: `${name} 전직 확정`, exact: true }),
    ).toBeDisabled();
  }
  await page.screenshot({
    path: "test-results/growth-comparison-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByLabel("성장 지휘관", { exact: true }).selectOption("A3");
  await expect(panel).toContainText("매직 애로우");
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/growth-comparison-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(await latest(page)).toEqual(snapshot);
});

test("victory shows earned levels and deploys the grown roster with exact save restoration", async ({
  page,
}) => {
  const won = victory();
  await load(page, won);
  await expect(page.getByTestId("growth-summary")).toContainText(
    "경험치 정산 완료",
  );
  await page
    .getByRole("button", { name: "성장 · 전직 확인", exact: true })
    .click();
  const panel = page.getByRole("dialog", { name: "성장 · 전직", exact: true });
  for (const entry of won.progression.settlement!.entries) {
    await panel
      .getByLabel("성장 지휘관", { exact: true })
      .selectOption(entry.unitId);
    await expect(panel.getByLabel("전투 성장 정산")).toContainText(
      `획득 ${entry.awardedExp} EXP`,
    );
    await expect(panel.getByLabel("현재 성장 기록")).toContainText(
      `Lv${entry.level} / 10`,
    );
    expect(
      won.units.find((unit) => unit.id === entry.unitId)?.progression?.level,
    ).toBe(1);
    expect(entry.level).toBeGreaterThan(1);
  }
  await page.screenshot({
    path: "test-results/growth-victory-settlement.png",
    fullPage: true,
  });
  const deployed = run(won, {
    type: "deploy",
    commandId: `deploy-${won.revision + 1}`,
    expectedRevision: won.revision,
  });
  await panel
    .getByRole("button", { name: "성장한 부대로 다시 연습", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await latest(page)).battle).toEqual(deployed);
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page.getByRole("button", { name: "미라 선택", exact: true }).click();
  await expect(page.locator(".growth-level")).toContainText(
    `Lv.${deployed.units.find((unit) => unit.id === "A3")!.progression!.level}`,
  );
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  expect((await latest(page)).battle).toEqual(deployed);
  await page.getByRole("button", { name: "성장 · 전직", exact: true }).click();
  await expect(panel).toContainText("추가 EXP는 지급하지 않습니다.");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "장비 · 마법 편성", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "메사이얀 소드 장착", exact: true }),
  ).toBeEnabled();
});

test("committed mercenary damage belongs to its leader and remains pending after reload", async ({
  page,
}) => {
  await load(page, createBattle(content));
  await page.getByLabel("빠른 진행").check();
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page
    .getByRole("button", { name: "A21 창병 선택", exact: true })
    .click();
  const canvas = page.locator('canvas[data-ready="true"]');
  await canvas.click({ position: { x: 11 * 48 + 24, y: 10 * 48 + 24 } });
  await canvas.click({ position: { x: 12 * 48 + 24, y: 10 * 48 + 24 } });
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect.poll(async () => (await latest(page)).battle.revision).toBe(1);
  const saved = await latest(page);
  const contribution = saved.battle.progression.contributions.A2!;
  const earned = Object.values(contribution).reduce(
    (sum, amount) => sum + amount,
    0,
  );
  expect(contribution.damage).toBeGreaterThan(0);
  expect(
    saved.battle.progression.roster.find((unit) => unit.id === "A2")!
      .progression,
  ).toMatchObject({ level: 1, exp: 0 });
  await page.reload();
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  expect((await latest(page)).battle).toEqual(saved.battle);
  await page.getByRole("button", { name: "성장 · 전직", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "성장 · 전직", exact: true });
  await panel.getByLabel("성장 지휘관", { exact: true }).selectOption("A2");
  await expect(panel).toContainText(`현재 전투 기여 ${earned} EXP`);
  await expect(panel).toContainText("전투 중 레벨과 능력치는 변하지 않습니다.");
});

test("retrying a lost practice keeps previously earned growth and the reward ledger", async ({
  page,
}) => {
  const won = victory();
  let lost = run(won, {
    type: "deploy",
    commandId: "practice",
    expectedRevision: won.revision,
  });
  while (!lost.outcome) {
    lost = run(lost, {
      type: "endPhase",
      commandId: `skip-${lost.revision}`,
      expectedRevision: lost.revision,
      side: lost.activeSide,
    });
  }
  expect(lost.outcome.status).toBe("defeat");
  await load(page, lost);
  await expect(page.getByTestId("growth-summary")).toContainText("패배");
  await page.getByRole("button", { name: "다시 도전", exact: true }).click();
  const expected = run(lost, {
    type: "deploy",
    commandId: `deploy-${lost.revision + 1}`,
    expectedRevision: lost.revision,
  });
  await expect.poll(async () => (await latest(page)).battle).toEqual(expected);
  expect(expected.progression.roster.map((unit) => unit.progression)).toEqual(
    won.progression.roster.map((unit) => unit.progression),
  );
  expect(expected.progression.rewardedScenarioIds).toEqual(
    won.progression.rewardedScenarioIds,
  );
});
