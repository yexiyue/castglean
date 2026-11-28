import { chapterTask, rightPanelToggle } from "../chapter-task.mjs";
import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("recovery-actions", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
try {
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&issues-fail=1");
  await page.getByText("无法读取章节分析或待检查项，已有结果保留。").waitFor();
  const startCount = () => page.evaluate(() => window.fixture.calls.filter((call) => ["chapter_analysis_start", "agent_start"].includes(call.command)).length);
  assert.equal(await startCount(), 0);
  await page.evaluate(() => { window.fixture.recoveredIssues = true; });
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await page.getByText("无法读取章节分析或待检查项，已有结果保留。").waitFor({ state: "hidden" });
  assert.equal(await startCount(), 0);
  await page.evaluate(() => { window.fixture.failAiStart = true; });
  await (await chapterTask(page, "分析本章角色")).click();
  await page.getByRole("button", { name: "重试执行", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "重试读取", exact: true }).count(), 0);
  const failedStartCount = await startCount();
  await rightPanelToggle(page).click();
  assert.equal(await startCount(), failedStartCount);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "服务连接", exact: true }).click();
  await page.locator('[data-slot="settings-page"]').getByRole("region", { name: "文本模型连接", exact: true }).waitFor();
  assert.equal(await startCount(), failedStartCount);
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&audio=1");
  await page.getByRole("button", { name: "制作本章音频", exact: true }).click();
  const before = await startCount();
  await page.getByRole("button", { name: "分析本章角色", exact: true }).waitFor();
  assert.equal(await startCount(), before);
  assert.equal(await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "chapter_audio_start").length), 0);
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&audio=1&no-default=1");
  await page.getByRole("button", { name: "制作本章音频", exact: true }).click();
  assert.equal(await page.getByText("配置文本模型即可分析，阅读不受影响。", { exact: true }).count(), 0);
  await page.getByRole("heading", { name: "本章音频设置", exact: true }).waitFor();
  await page.getByRole("dialog", { name: "本章音频设置" }).getByRole("button", { name: "选择模型", exact: true }).click();
  await page.locator('[data-slot="settings-page"]').getByRole("region", { name: "文本模型连接", exact: true }).waitFor();
  assert.equal(await startCount(), 0);
  console.log("PASS read retry and analysis blocker navigation do not start tasks");
} finally { await browser.close(); }
});
