import { expect, test } from "@playwright/test";

test("a downloaded desktop update waits for active tasks before installation", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await page.goto("/settings?section=about&fixture=desktop&updateFixture=1&theme=dark");
  await expect(page.getByText("可用版本 0.1.1")).toBeVisible();
  await page.getByRole("button", { name: "下载更新" }).click();
  const install = page.getByRole("button", { name: "安装并重启" });
  await expect(install).toBeVisible();
  await page.evaluate(() => { window.fixture.updateActiveTasks = 1; });

  await install.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("后台任务尚未结束，请稍后安装更新。")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "放弃未保存的改动并安装" })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.fixture.updateInstallCalls ?? 0)).toBe(0);
  await dialog.getByRole("button", { name: "继续使用" }).click();

  await page.evaluate(() => { window.fixture.updateActiveTasks = 0; });
  await install.click();
  await expect.poll(() => page.evaluate(() => window.fixture.updateInstallCalls ?? 0)).toBe(1);
});
