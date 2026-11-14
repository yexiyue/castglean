import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("resource-states", async ({ flowBrowser: browser }) => {
try {
  for (const [path, error] of [["voices", "预置音色读取失败"], ["models", "模型目录读取失败"]]) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:1437/${path}?fixture=desktop&modelListFailure=1`);
    await page.getByText(error, { exact: true }).waitFor();
    assert.equal(await page.getByText("没有可用的预置音色", { exact: true }).count(), 0);
    assert.equal(await page.getByText("resource_read_failed").count(), 0);
    await page.evaluate(() => { window.fixture.failModelRead = false; });
    await page.getByRole("button", { name: "重试读取", exact: true }).click();
    await page.getByText(path === "voices" ? "Heart" : "Kokoro", { exact: true }).first().waitFor();
    await page.evaluate(() => {
      window.fixture.failModelRead = true;
      window.fixture.modelChannel.onmessage({ type: "update", update: { backend: "kokoro", model: "kokoro", task_id: 1, sequence: 1, state: "Ready" } });
    });
    await page.getByText(error, { exact: true }).waitFor();
    assert.equal(await page.getByText(path === "voices" ? "Heart" : "Kokoro", { exact: true }).count(), 0);
    await page.evaluate(() => { window.fixture.failModelRead = false; });
    await page.getByRole("button", { name: "重试读取", exact: true }).click();
    await page.getByText(path === "voices" ? "Heart" : "Kokoro", { exact: true }).first().waitFor();
    await page.close();
  }
  const loading = await browser.newPage();
  await loading.goto("http://localhost:1437/voices?fixture=desktop&guideLoading=1");
  await loading.getByText("正在读取预置音色…", { exact: true }).waitFor();
  assert.equal(await loading.getByText("没有可用的预置音色").count(), 0);
  await loading.close();
  const empty = await browser.newPage();
  await empty.goto("http://localhost:1437/voices?fixture=desktop&emptyModelCatalog=1");
  await empty.getByText("没有可用的预置音色", { exact: true }).waitFor();
  await empty.getByRole("combobox", { name: "选择模型" }).click();
  await empty.getByRole("option", { name: "Kokoro", exact: true }).click();
  await empty.getByText("没有匹配的音色", { exact: true }).waitFor();
  await empty.getByRole("button", { name: "清除筛选" }).click();
  await empty.getByText("没有可用的预置音色", { exact: true }).waitFor();
  await empty.close();
  const filtered = await browser.newPage();
  await filtered.goto("http://localhost:1437/voices?fixture=desktop");
  await filtered.getByText("Heart", { exact: true }).first().waitFor();
  await filtered.getByRole("searchbox", { name: "搜索预置音色" }).fill("不存在");
  await filtered.getByText("没有匹配的音色", { exact: true }).waitFor();
  await filtered.locator('[data-app-state="search"]').getByRole("button", { name: "清除搜索" }).click();
  await filtered.getByText("Heart", { exact: true }).first().waitFor();
  await filtered.close();
  const long = await browser.newPage({ viewport: { width: 1024, height: 680 } });
  await long.goto("http://localhost:1437/voices?fixture=desktop&longVoiceNames=1");
  const row = long.getByRole("button", { name: "打开音色「公开音色」的试听配置，模型：非常长的公开模型名称用于键盘识别和窄窗口完整展示" });
  await row.focus();
  assert.equal(await row.evaluate((element) => element === document.activeElement), true);
  assert.equal(await row.getByText("公开音色", { exact: true }).count(), 1);
  assert.equal(await long.evaluate(() => window.fixture.calls.some((call) => /start_voice_job|audition/.test(call.command))), false);
  await row.press("Enter");
  await long.getByRole("dialog").waitFor();
  assert.equal(await long.evaluate(() => window.fixture.calls.some((call) => /start_voice_job|audition/.test(call.command))), false);
  await long.close();
  console.log("PASS resource loading, failure/retry, empty and search states");
} finally { await browser.close(); }
});
