import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("audition-isolation", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(12000);
try {
  await page.goto("http://localhost:1437/voices?fixture=desktop&auditionForm=1");
  const preset = page.getByRole("button", { name: "打开音色「Heart」的试听配置，模型：Kokoro" });
  await preset.click();
  let dialog = page.getByRole("dialog", { name: "Heart" });
  await dialog.getByRole("textbox", { name: "试听文本" }).fill("预置声音草稿");
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "我的音色" }).click();
  await page.getByRole("button", { name: "查看音色「山风」" }).click();
  dialog = page.getByRole("dialog", { name: "山风" });
  const libraryText = dialog.getByRole("textbox", { name: "试听文本" });
  assert.notEqual(await libraryText.inputValue(), "预置声音草稿");
  await libraryText.fill("库音色草稿");
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "预置音色" }).click();
  await preset.click();
  dialog = page.getByRole("dialog", { name: "Heart" });
  assert.equal(await dialog.getByRole("textbox", { name: "试听文本" }).inputValue(), "预置声音草稿");
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "我的音色" }).click();
  await page.getByRole("button", { name: "查看音色「山风」" }).click();
  assert.equal(await page.getByRole("dialog", { name: "山风" }).getByRole("textbox", { name: "试听文本" }).inputValue(), "库音色草稿");
  assert.equal(await page.evaluate(() => window.fixture.calls.some((call) => call.command === "start_voice_job")), false);
  console.log("PASS audition drafts are isolated by voice and retained across target switches");
} finally { await browser.close(); }
});
