import { expect, test } from "@playwright/test";

test("actual workspace shows the latest provider usage", async ({ page }) => {
  await page.goto("/project/fixture-project?fixture=desktop&analysis=1");
  await page.getByRole("button", { name: "返回 AI 助手", exact: true }).click();
  await page.getByRole("textbox", { name: "工程问题或补充说明" }).fill("查看上下文用量");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("log").getByText("这是解释建议，没有修改已保存分析。").waitFor();
  await page.getByRole("button", { name: "上下文用量", exact: true }).click();
  const usage = page.locator('[data-slot="context-usage"]');
  await expect(usage.getByText("100", { exact: true })).toBeVisible();
  await expect(usage.getByText("50", { exact: true })).toBeVisible();
  await expect(usage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(150 / 8192 * 100));
});
