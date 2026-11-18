import { expect, test } from "@playwright/test";

test("issues dialog locates another chapter and retries failed reads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/project/fixture-project?fixture=desktop&largeDirectory=1&grouped=1");
  const issues = page.getByRole("button", { name: "待检查", exact: true });
  await issues.click();
  const rows = page.locator('[data-slot="chapter-issues-scroll"] button');
  await expect(rows).toHaveCount(6);
  await rows.filter({ hasText: "第 102 行" }).click();
  await expect(page.locator('main[data-chapter-id="chapter-10"]')).toBeVisible();

  await page.goto("/project/fixture-project?fixture=desktop&analysis=1&issues-fail");
  await issues.click();
  const dialog = page.getByRole("dialog", { name: /待检查/ });
  await expect(dialog.getByText("未能读取待检查项")).toBeVisible();
  await page.evaluate(() => { window.fixture.recoveredIssues = true; });
  await dialog.getByRole("button", { name: "重试读取" }).click();
  await expect(dialog.getByText("全书暂无待检查项")).toBeVisible();
});
