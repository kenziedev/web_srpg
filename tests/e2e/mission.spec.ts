import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { contentSchema } from "../../packages/schema/src/index";
import type { BattleSave } from "../../apps/web/src/storage/saveFormat";
const content = contentSchema.parse(
  JSON.parse(readFileSync("packages/content/data/two-crossings.json", "utf8")),
);
import {
  apply,
  createBattle,
  effectiveUnit,
  type Command,
} from "../../packages/core/src/index";
for (const route of ["beacon", "frontal"]) {
  const fixture = JSON.parse(
    readFileSync(`packages/sim/fixtures/${route}-clear.json`, "utf8"),
  );
  test(`recorded ${route} strategy wins through real map inputs and automatic enemy turns`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/");
    const canvas = page.locator('canvas[data-ready="true"]');
    await expect(canvas).toBeVisible();
    await page.getByLabel("빠른 진행").check();
    let state = createBattle(content);
    let healingCount = 0;
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
            await page.getByLabel("전투 연출").selectOption("detailed");
            await page
              .getByRole("button", { name: "회복", exact: true })
              .click();
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
          if (action.type === "heal") {
            const magic = page.getByRole("dialog", {
              name: "상세 마법",
              exact: true,
            });
            await expect(magic).toBeVisible();
            await expect(
              magic.locator(".spell-theater-caster svg"),
            ).toBeVisible();
            await expect(
              magic.locator(".spell-light-column").first(),
            ).toBeVisible();
            await page.screenshot({
              path: `test-results/${route}-heal-spell.png`,
            });
            if (healingCount++ % 2 === 0) await page.keyboard.press("Escape");
            await expect(magic).toHaveCount(0);
            const resolved = apply(content, state, command);
            if (!resolved.ok) throw Error(resolved.error);
            const caster = resolved.nextState.units.find(
              (u) => u.id === command.unitId,
            )!;
            await expect(page.locator(".health-line strong")).toHaveText(
              String(caster.hp),
            );
            await expect(page.locator(".health-line + span b")).toHaveText(
              `${caster.mp} / ${effectiveUnit(content, resolved.nextState, caster).stats.maxMp}`,
            );
            await page.getByLabel("전투 연출").selectOption("simple");
          }
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
      } else {
        // Await each automatic command, rather than fitting a whole enemy/NPC
        // phase into the next round assertion's single five-second timeout.
        await expect
          .poll(
            () =>
              page.evaluate(async (revision) => {
                const storePath = "/src/storage/battleSaveStore.ts";
                const { createCurrentBattleSaveStore } = (await import(
                  storePath
                )) as typeof import("../../apps/web/src/storage/battleSaveStore");
                const saved = (await createCurrentBattleSaveStore().readRaw(
                  "latest",
                )) as BattleSave | undefined;
                return saved?.commands[revision];
              }, command.expectedRevision),
            { message: `Automatic command ${command.commandId} is saved` },
          )
          .toEqual(command);
      }
      const result = apply(content, state, command);
      if (!result.ok) throw Error(result.error);
      state = result.nextState;
    }
    await expect(page.getByRole("heading", { name: "작전 성공" })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("dialog")).toContainText(
      `${fixture.expectedOutcome.round}라운드`,
    );
    await expect(page.getByRole("dialog")).toContainText(
      fixture.expectedOutcome.bonuses.join(" · "),
    );
    if (route === "frontal")
      await expect(page.getByRole("dialog")).not.toContainText(
        "봉화 조기 점령",
      );
    await page.screenshot({
      path: `test-results/${route}-mission-victory.png`,
      fullPage: true,
    });
    await expect(page.getByTestId("save-status")).toContainText(
      "자동 저장 완료",
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "작전 성공" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(
      `${fixture.expectedOutcome.round}라운드`,
    );
    await expect(page.getByRole("dialog")).toContainText(
      fixture.expectedOutcome.bonuses.join(" · "),
    );
    await expect(page.getByTestId("save-status")).toContainText(
      "저장 복구 완료",
    );
    expect(errors).toEqual([]);
  });
}
