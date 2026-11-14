import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("voice-batch-selection", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
try {
  await page.goto("http://localhost:1437/voices?fixture=desktop&manyVoices=1&library=mine");
  const search = page.getByRole("searchbox", { name: "搜索我的音色" });
  await search.waitFor();
  await page.getByRole("checkbox", { name: "选择音色「海潮」" }).check();
  await search.fill("山");
  await page.getByRole("button", { name: "全选搜索结果" }).click();
  assert.equal(await page.getByRole("checkbox", { name: "选择音色「山风」" }).isChecked(), true);
  assert.equal(await page.getByRole("checkbox", { name: "选择音色「山雨」" }).isChecked(), true);
  await page.getByRole("button", { name: "导出所选音色" }).click();
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "export_voice_entries"));
  assert.deepEqual(await page.evaluate(() => window.fixture.calls.find(call => call.command === "export_voice_entries").args.ids), ["fixture-voice", "fixture-voice-2", "fixture-voice-3"]);
  await search.fill("");
  assert.equal(await page.getByRole("checkbox", { name: "选择音色「海潮」" }).isChecked(), true);
  await page.getByRole("checkbox", { name: "选择音色「海潮」" }).focus();
  await page.keyboard.press("Space");
  assert.equal(await page.getByRole("checkbox", { name: "选择音色「海潮」" }).isChecked(), false);
  await page.getByRole("button", { name: "取消全选" }).click();
  assert.equal(await page.getByRole("checkbox", { checked: true }).count(), 0);
  console.log("PASS filtered bulk selection, stable export identities and keyboard checkbox");
} finally { await browser.close(); }
});
