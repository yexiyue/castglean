import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("assistant-send-session-race", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
try {
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1");
  await page.getByRole("button", { name: "返回 AI 助手", exact: true }).click();
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  await input.fill("旧会话延迟失败");
  await page.evaluate(() => { window.fixture.delayFailAiStart = true; });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => typeof window.fixture.rejectDelayedAiStart === "function");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="工程问题或补充说明"]')?.value === "");
  await page.evaluate(() => window.fixture.rejectDelayedAiStart());
  await page.waitForTimeout(150);
  assert.equal(await page.getByText("助手请求未完成，已有结果保留；请在助手中查看并选择后续操作。").count(), 0);
  await input.fill("新会话消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => window.fixture.calls.filter(call => call.command === "ai_start").length === 2);
  await page.getByRole("button", { name: "会话历史", exact: true }).click();
  await page.getByRole("dialog", { name: "会话历史" }).getByRole("button", { name: "旧会话延迟失败" }).click();
  await page.getByRole("button", { name: "核对原请求" }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="工程问题或补充说明"]')?.value === "旧会话延迟失败");
  console.log("PASS late start failure remains with its original session");
} finally { await browser.close(); }
});
