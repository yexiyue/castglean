import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("character-name-draft", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
page.setDefaultTimeout(15000);
try {
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&windowFixture=1");
  await page.getByRole("button", { name: "工程角色", exact: true }).click();
  await page.evaluate(() => { window.fixture.failCharacterUsage = true; });
  await page.getByRole("button", { name: /阿岚/ }).first().click();
  await page.getByRole("tab", { name: "身份" }).click();
  await page.getByText("无法读取角色出现记录与别名。").waitFor();
  await page.evaluate(() => { window.fixture.failCharacterUsage = false; });
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await page.getByText("当前分析中没有出现记录").waitFor();
  await page.getByRole("button", { name: "重命名" }).click();
  const input = page.getByLabel("共享显示名称");
  await input.fill("长".repeat(121));
  await page.getByRole("button", { name: "确认更名" }).click();
  await page.getByText("请输入不超过 120 个字符且不含空字符的名称。").waitFor();
  assert.equal(await input.evaluate(element => element === document.activeElement), true);
  await input.fill("新名称草稿");
  assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);
  await page.getByRole("button", { name: /旁白/ }).first().click();
  await page.getByRole("button", { name: /阿岚/ }).first().click();
  await page.getByRole("tab", { name: "身份" }).click();
  await page.getByRole("button", { name: "重命名" }).click();
  assert.equal(await page.getByLabel("共享显示名称").inputValue(), "新名称草稿");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), false);
  assert.equal(await page.evaluate(() => window.fixture.calls.some(call => call.command === "chapter_analysis_character_edit")), false);
  console.log("PASS character rename draft isolation, validation and explicit discard");
} finally { await browser.close(); }
});
