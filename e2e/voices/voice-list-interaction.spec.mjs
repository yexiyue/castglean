import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("voice-list-interaction", async ({ flowBrowser: browser }) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(15000);
  try {
    await page.goto("http://localhost:1437/voices?fixture=desktop&manyVoices=1&library=mine");
    await page.getByRole("searchbox", { name: "搜索我的音色" }).waitFor();
    // 勾选框是行内控件：只切换选择，不打开音色详情。
    await page.getByRole("checkbox", { name: "选择音色「海潮」" }).check();
    assert.equal(await page.getByRole("dialog").count(), 0);
    // 整行可点：点非按钮单元格同样打开该音色的详情。
    await page.locator("tbody tr").first().locator("td").nth(2).click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    // 行外区域（搜索框、批量操作）不触发详情弹窗。
    await page.getByRole("searchbox", { name: "搜索我的音色" }).click();
    await page.getByRole("button", { name: "全选搜索结果" }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    console.log("PASS row click opens detail, row controls and outside areas stay inert");
  } finally { await browser.close(); }
});
