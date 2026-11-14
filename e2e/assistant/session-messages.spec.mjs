import { expect, test } from "@playwright/test";

test("history, interruption and streaming keep the reader's position", async ({ page }) => {
  await page.goto("/tests/session-messages-fixture.html");
  const log = page.getByRole("log", { name: "会话" });
  await expect(log.getByText("此回复已中断，内容尚未完成。")).toBeVisible();
  await log.evaluate((element) => { element.scrollTop = 0; });
  await expect(page.getByRole("button", { name: "回到最新" })).toBeVisible();
  await page.getByRole("button", { name: "追加消息" }).click();
  await expect(log.getByText("新消息")).toBeAttached();
  expect(await log.evaluate((element) => element.scrollTop)).toBeLessThan(100);
  await log.getByRole("button", { name: "更早的消息" }).click();
  await expect(log.getByText("更早的内容")).toBeAttached();
  await page.getByRole("button", { name: "回到最新" }).click();
  await expect.poll(() => log.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(64);
});
