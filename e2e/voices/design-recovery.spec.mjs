import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("design-recovery", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
page.setDefaultTimeout(20000);
try {
  await page.goto("http://localhost:1437/voices/new?fixture=desktop&voiceAudition=1&windowFixture=1");
  await page.getByLabel("音色名称").fill("公开音色");
  await page.getByLabel("声音描述").fill("柔和的声音");
  await page.evaluate(() => { window.fixture.loseAuditionReply = true; });
  await page.getByRole("button", { name: "生成音色候选" }).click();
  await page.getByText("请求尚未确认；重试会沿用原请求，停止恢复不会撤销可能已开始的任务。").waitFor();
  assert.equal(await page.evaluate(() => window.fixture.auditionStarts), 1);
  await page.locator('[data-slot="page-heading"]').getByRole("link", { name: "音色中心" }).click();
  await page.waitForFunction(() => typeof window.fixture.fireWindowClose === "function");
  await page.evaluate(() => window.fixture.fireWindowClose());
  await page.getByText("声音配置草稿或任务请求尚未完成，关闭后草稿及原请求身份可能丢失。").waitFor();
  await page.getByRole("button", { name: "继续使用" }).click();
  await page.getByRole("button", { name: "重试「公开音色」的原请求" }).click();
  await page.getByText("音色设计：公开音色").waitFor({ state: "hidden" });
  const calls = await page.evaluate(() => window.fixture.calls.filter(call => call.command === "start_voice_job"));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, calls[0].args);
  assert.equal(await page.evaluate(() => window.fixture.auditionStarts), 1);
  await page.getByRole("link", { name: "创建音色", exact: true }).click();
  assert.equal(await page.getByLabel("声音描述").inputValue(), "柔和的声音");
  await page.evaluate(() => { window.fixture.failStudioReadAfterStart = true; });
  await page.getByRole("button", { name: "生成音色候选" }).click();
  await page.getByText("任务已创建，读取状态失败。").waitFor();
  assert.equal(await page.evaluate(() => window.fixture.auditionStarts), 2);
  await page.evaluate(() => { window.fixture.failStudioRead = false; window.fixture.failStudioReadAfterStart = false; });
  await page.getByRole("button", { name: "重新读取「公开音色」任务" }).click();
  await page.getByText("音色设计：公开音色").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.fixture.auditionStarts), 2);
  console.log("PASS design request recovery preserves identity across routes");
} finally { await browser.close(); }
});
