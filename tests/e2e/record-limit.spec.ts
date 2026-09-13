import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  contentSchema,
  MAX_SAVE_COMMANDS,
} from "../../packages/schema/src/index";
import { apply, createBattle } from "../../packages/core/src/index";

test("an enemy phase at the command limit stops automatically and keeps backup and preparation recovery available", async ({
  page,
}) => {
  test.setTimeout(90000);
  const content = contentSchema.parse(
    JSON.parse(
      readFileSync("packages/content/data/two-crossings.json", "utf8"),
    ),
  );
  let state = createBattle(content);
  for (let i = 0; i < MAX_SAVE_COMMANDS - 1; i++) {
    const result = apply(content, state, {
      type: "equip",
      commandId: `limit-equip-${i}`,
      expectedRevision: state.revision,
      unitId: "A1",
      slot: "weapon",
      itemId: i % 2 === 0 ? "knife" : null,
    });
    if (!result.ok) throw Error(result.error);
    state = result.nextState;
  }
  const end = apply(content, state, {
    type: "endPhase",
    commandId: "limit-enemy",
    expectedRevision: state.revision,
    side: "player",
  });
  if (!end.ok) throw Error(end.error);
  state = end.nextState;
  expect(state.activeSide).toBe("enemy");
  await page.goto("/");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await page.evaluate(async (battle) => {
    const storePath = "/src/storage/battleSaveStore.ts";
    const formatPath = "/src/storage/saveFormat.ts";
    const { createCurrentBattleSaveStore } = (await import(
      storePath
    )) as typeof import("../../apps/web/src/storage/battleSaveStore");
    const { createSave } = (await import(
      formatPath
    )) as typeof import("../../apps/web/src/storage/saveFormat");
    await createCurrentBattleSaveStore().write(createSave(battle));
  }, state);
  await page.reload();
  await expect(
    page.getByText("명령 기록 1,024개에 도달해 전투를 멈췄습니다.", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("button", { name: "저장 · 복구 열기", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "출격 준비 체크포인트 불러오기",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 15000 });
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "파일 내보내기", exact: true })
    .click();
  expect((await download).suggestedFilename()).toContain("rev-1024");
  await page
    .getByRole("button", { name: "출격 준비 체크포인트 불러오기", exact: true })
    .click();
  await expect(page.getByTestId("save-notice")).toContainText(
    "선택한 저장을 복구",
    { timeout: 15000 },
  );
  await page
    .getByRole("button", { name: "전투로 돌아가기", exact: true })
    .click();
  await expect(page.getByTestId("phase")).toHaveText("아군 턴");
  await expect(
    page.getByText("명령 기록 1,024개에 도달해 전투를 멈췄습니다.", {
      exact: false,
    }),
  ).toHaveCount(0);
});
