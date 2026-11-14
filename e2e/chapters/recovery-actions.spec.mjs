import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("recovery-actions", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
try {
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&issues-fail=1");
  await page.getByText("无法读取章节分析或待检查项，已有结果保留。").waitFor();
  const startCount = () => page.evaluate(() => window.fixture.calls.filter((call) => ["chapter_analysis_start", "ai_start"].includes(call.command)).length);
  assert.equal(await startCount(), 0);
  await page.evaluate(() => { window.fixture.recoveredIssues = true; });
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await page.getByText("无法读取章节分析或待检查项，已有结果保留。").waitFor({ state: "hidden" });
  assert.equal(await startCount(), 0);
  await page.evaluate(() => { window.fixture.failAiStart = true; });
  await page.getByRole("button", { name: "分析本章", exact: true }).click();
  await page.getByText("助手请求未完成，已有结果保留；请在助手中查看并选择后续操作。").waitFor();
  assert.equal(await page.getByRole("button", { name: "重试读取", exact: true }).count(), 0);
  const failedStartCount = await startCount();
  await page.getByRole("button", { name: "查看助手", exact: true }).click();
  assert.equal(await startCount(), failedStartCount);
  await page.getByRole("button", { name: "服务连接", exact: true }).click();
  await page.getByRole("dialog", { name: "设置" }).getByRole("region", { name: "文本模型连接", exact: true }).waitFor();
  assert.equal(await startCount(), failedStartCount);
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&audio=1");
  await page.evaluate(() => { window.fixture.noAnalysis = true; });
  await page.getByRole("button", { name: "生成本章音频", exact: true }).click();
  await page.getByText("本章尚未分析，请先完成归属分析").waitFor();
  const before = await startCount();
  await page.getByRole("button", { name: "前往分析", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "分析本章", exact: true }).evaluate((node) => document.activeElement === node), true);
  assert.equal(await startCount(), before);
  assert.equal(await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "chapter_audio_start").length), 1);
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&audio=1&no-default=1");
  await page.evaluate(() => { window.fixture.noAnalysis = true; });
  await page.getByRole("button", { name: "生成本章音频", exact: true }).click();
  await page.getByRole("button", { name: "前往分析", exact: true }).click();
  await page.getByRole("dialog", { name: "设置" }).getByRole("region", { name: "文本模型连接", exact: true }).waitFor();
  assert.equal(await startCount(), 0);
  console.log("PASS read retry and analysis blocker navigation do not start tasks");
} finally { await browser.close(); }
});
