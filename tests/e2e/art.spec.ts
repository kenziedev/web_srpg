import { expect, test } from "@playwright/test";

test("licensed battlefield and distinct commander portraits load with accessible attribution", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (/\.png(?:\?|$)/.test(response.url()) && !response.ok())
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("/");
  const canvas = page.locator('canvas[data-ready="true"]');
  await expect(canvas).toHaveAttribute("data-art", "toen");
  const portraits: string[] = [];
  for (const name of ["카이엘", "로엔", "미라"]) {
    await page.getByRole("button", { name: "부대 목록", exact: true }).click();
    await page
      .getByRole("button", { name: `${name} 선택`, exact: true })
      .click();
    const portrait = page.locator(".bottom-hud .portrait[data-art] image");
    await expect(portrait).toBeAttached();
    const href = await portrait.getAttribute("href");
    expect(href).toBeTruthy();
    portraits.push(href!);
    await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (image.naturalWidth < 300) throw new Error("Portrait did not decode");
    }, href!);
  }
  expect(new Set(portraits).size).toBe(3);
  await page.getByRole("button", { name: "안내", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "전투 안내" });
  await dialog.getByText("그림 출처와 라이선스", { exact: true }).click();
  await expect(
    dialog.getByRole("link", { name: "CC BY 4.0", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "CC BY 3.0", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "ZeNeRIA29", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a failed terrain download keeps the original battlefield playable and saves the action", async ({
  page,
}) => {
  // Vite also serves an ESM URL module at .png?import. Fail the PNG request,
  // while allowing the application code to initialize its fallback renderer.
  await page.route("**/*medieval-strategy*.png*", (route) =>
    ["image", "xhr", "fetch"].includes(route.request().resourceType())
      ? route.abort()
      : route.continue(),
  );
  await page.goto("/");
  const canvas = page.locator('canvas[data-ready="true"]');
  await expect(canvas).toHaveAttribute("data-art", "original");
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page.getByRole("button", { name: "카이엘 선택", exact: true }).click();
  await page.getByRole("button", { name: "대기", exact: true }).click();
  await page.getByRole("button", { name: "행동 확정" }).click();
  await expect(page.getByTestId("save-status")).toContainText("자동 저장 완료");
  await page.reload();
  await expect(canvas).toHaveAttribute("data-art", "original");
  await expect(page.getByTestId("save-status")).toContainText("저장 복구 완료");
  await page.getByRole("button", { name: "부대 목록", exact: true }).click();
  await page.getByRole("button", { name: "카이엘 선택", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "대기", exact: true }),
  ).toBeDisabled();
});
