import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { contentSchema } from "../../packages/schema/src/index";
const content = contentSchema.parse(
  JSON.parse(readFileSync("packages/content/data/two-crossings.json", "utf8")),
);
import {
  apply,
  createBattle,
  type Command,
} from "../../packages/core/src/index";
const fixture = JSON.parse(
  readFileSync("packages/sim/fixtures/beacon-clear.json", "utf8"),
);

test("recorded beacon strategy wins through real map inputs and automatic enemy turns", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const canvas = page.locator('canvas[data-ready="true"]');
  await expect(canvas).toBeVisible();
  await page.getByLabel("빠른 진행").check();
  let state = createBattle(content);
  for (const command of fixture.commands as Command[]) {
    if (state.activeSide === "player") {
      await expect(page.getByTestId("round")).toHaveText(
        String(state.round).padStart(2, "0"),
      );
      await expect(page.getByTestId("phase")).toHaveText("아군 턴");
      if (command.type === "act") {
        const unit = state.units.find((u) => u.id === command.unitId)!;
        await page
          .getByRole("button", { name: "부대 목록", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: `${unit.kind === "mercenary" ? unit.id + " " : ""}${unit.name} 선택`,
            exact: true,
          })
          .click();
        const clickTile = async (p: { x: number; y: number }) =>
          canvas.click({ position: { x: p.x * 48 + 24, y: p.y * 48 + 24 } });
        if (command.path.length)
          await clickTile(command.path[command.path.length - 1]!);
        const action = command.action;
        if (action.type === "attack")
          await clickTile(
            state.units.find((u) => u.id === action.targetId)!.pos,
          );
        else if (action.type === "heal") {
          await page.getByRole("button", { name: "회복", exact: true }).click();
          await clickTile(
            state.units.find((u) => u.id === action.targetId)!.pos,
          );
        } else
          await page
            .getByRole("button", {
              name: command.action.type === "wait" ? "대기" : "정비",
              exact: true,
            })
            .click();
        await page.getByRole("button", { name: "행동 확정" }).click();
      } else {
        await page.getByRole("button", { name: /^턴 종료 E$/ }).click();
        if (
          await page
            .getByRole("button", { name: "턴 종료 확인", exact: true })
            .isVisible()
        )
          await page
            .getByRole("button", { name: "턴 종료 확인", exact: true })
            .click();
      }
    }
    const result = apply(content, state, command);
    if (!result.ok) throw Error(result.error);
    state = result.nextState;
  }
  await expect(page.getByRole("heading", { name: "작전 성공" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("dialog")).toContainText("10라운드");
  await expect(page.getByRole("dialog")).toContainText(
    "봉화 조기 점령 · 호송대 안전 탈출",
  );
  await page.screenshot({
    path: "test-results/mission-victory.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
