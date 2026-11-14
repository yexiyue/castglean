import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("design-preparation-recovery", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
page.setDefaultTimeout(20000);
try {
  await page.goto("http://localhost:1437/voices/new?fixture=desktop&unready=1&voiceAudition=1");
  await page.getByLabel("音色名称").fill("准备时保留的草稿");
  await page.getByRole("button", { name: /Qwen Voice Design/ }).click();
  await page.getByRole("button", { name: "准备资源", exact: true }).click();
  await page.getByRole("dialog", { name: "准备音色设计资源" }).waitFor();
  await page.evaluate(() => { window.fixture.loseAuditionReply = true; });
  await page.getByRole("button", { name: "确认准备" }).click();
  await page.getByText("请求尚未确认；重试会沿用原请求，停止恢复不会撤销可能已开始的任务。").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('[data-slot="page-heading"]').getByRole("link", { name: "音色中心" }).click();
  await page.getByRole("button", { name: "重试「qwen-design」的原请求" }).click();
  await page.getByText("准备设计引擎：qwen-design").waitFor({ state: "hidden" });
  const calls = await page.evaluate(() => window.fixture.calls.filter(call => call.command === "start_voice_job"));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, calls[1].args);
  assert.deepEqual(calls[0].args.request, { kind: "prepare_design", engine: "qwen-design" });
  assert.equal(await page.evaluate(() => window.fixture.auditionStarts), 1);
  await page.getByRole("link", { name: "创建音色", exact: true }).click();
  assert.equal(await page.getByLabel("音色名称").inputValue(), "准备时保留的草稿");
  console.log("PASS preparation recovery preserves request and creation draft");
} finally { await browser.close(); }
});
