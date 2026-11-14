import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("assistant-recovery-session-race", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
try {
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1");
  await page.getByRole("button", { name: "返回 AI 助手", exact: true }).click();
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  await input.fill("旧会话待确认内容");
  await page.evaluate(() => { window.fixture.failAiStart = true; });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "核对原请求" }).waitFor();
  await page.evaluate(() => { window.fixture.delayAiStatus = true; });
  await page.getByRole("button", { name: "核对原请求" }).click();
  await page.waitForFunction(() => typeof window.fixture.releaseAiStatus === "function");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="工程问题或补充说明"]')?.value === "");
  await page.evaluate(() => window.fixture.releaseAiStatus());
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("button", { name: "重试原请求" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "核对原请求" }).count(), 0);
  await page.getByRole("button", { name: "会话历史", exact: true }).click();
  await page.getByRole("dialog", { name: "会话历史" }).getByRole("button", { name: "旧会话待确认内容" }).click();
  await page.getByRole("button", { name: "核对原请求" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "重试原请求" }).count(), 0);
  assert.equal(await input.inputValue(), "旧会话待确认内容");
  await page.evaluate(() => { window.fixture.delayAiStatus = true; delete window.fixture.rejectAiStatus; });
  await page.getByRole("button", { name: "核对原请求" }).click();
  await page.waitForFunction(() => typeof window.fixture.rejectAiStatus === "function");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page.evaluate(() => window.fixture.rejectAiStatus());
  await page.waitForTimeout(100);
  assert.equal(await page.getByText("助手请求未完成，已有结果保留；请在助手中查看并选择后续操作。").count(), 0);
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "ai_start").length), 1);
  console.log("PASS late recovery lookup is isolated and the pending session remains discoverable");
} finally { await browser.close(); }
});
