import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("llm-list-race", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
page.setDefaultTimeout(15000);
try {
  await page.goto("http://localhost:1437/?fixture=desktop&llmFixture=1&settings=models&locale=zh");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.evaluate(() => { window.fixture.delayLlmList = true; });
  await page.getByRole("button", { name: "获取模型列表" }).click();
  await page.waitForFunction(() => typeof window.fixture.releaseLlmList === "function");
  assert.equal(await page.getByLabel("服务地址").isDisabled(), true);
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("button", { name: "通用", exact: true }).click();
  await dialog.getByRole("button", { name: "服务连接", exact: true }).click();
  assert.equal(await page.getByLabel("服务地址").isDisabled(), true);
  await page.evaluate(() => window.fixture.releaseLlmList());
  await page.getByText("Remote model").waitFor();
  await page.getByText("模型参数", { exact: true }).click();
  const reasoning = page.getByRole("combobox", { name: "思考强度" });
  await reasoning.selectOption("high");
  await page.getByLabel("服务地址").fill("https://other.example/v1");
  assert.equal(await reasoning.isDisabled(), true);
  assert.equal(await reasoning.inputValue(), "lowest");
  assert.equal(await page.getByText("Remote model").count(), 0);
  await page.getByRole("button", { name: "保存连接" }).click();
  await page.getByRole("button", { name: "添加连接", exact: true }).waitFor();
  const change = await page.evaluate(() => window.fixture.calls.find((entry) => entry.command === "llm_update_connection").args.change);
  assert.equal(change.endpoint, "https://other.example/v1");
  assert.equal(change.models[0].reasoning, "lowest");
  assert.equal(change.models[0].advertisedReasoning, null);
  console.log("PASS delayed model list and capability invalidation after endpoint change");
} finally { await browser.close(); }
});
