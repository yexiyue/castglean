import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("llm-model-array", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
page.setDefaultTimeout(15000);
try {
  await page.goto("http://localhost:1437/?fixture=desktop&llmFixture=1&settings=models&locale=zh");
  await page.getByRole("button", { name: "编辑连接" }).click();
  await page.getByRole("button", { name: "添加模型", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "添加模型" });
  await addDialog.getByLabel("模型 ID").fill("example-model");
  await addDialog.getByRole("button", { name: "添加", exact: true }).click();
  await addDialog.getByText("此模型 ID 已在连接中。").waitFor();
  assert.equal(await addDialog.getByLabel("模型 ID").inputValue(), "example-model");
  assert.equal(await addDialog.getByLabel("模型 ID").evaluate((element) => document.activeElement === element), true);
  await addDialog.getByLabel("模型 ID").fill("x".repeat(121));
  await addDialog.getByRole("button", { name: "添加", exact: true }).click();
  await addDialog.getByText("请输入有效的显示名称，最多 120 个字符。").waitFor();
  await addDialog.getByLabel("模型 ID").fill("new-a");
  await addDialog.getByLabel("模型显示名称").fill("模型甲");
  await addDialog.getByRole("button", { name: "添加", exact: true }).click();
  await addDialog.waitFor({ state: "hidden" });
  // 回归：弹窗提交不得沿 React 树冒泡触发外层连接表单保存。
  assert.equal(await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "llm_update_connection").length), 0);
  await page.getByRole("button", { name: "添加模型", exact: true }).click();
  await addDialog.getByLabel("模型 ID").fill("new-b");
  await addDialog.getByLabel("模型显示名称").fill("模型乙");
  await addDialog.getByRole("button", { name: "添加", exact: true }).click();
  await addDialog.waitFor({ state: "hidden" });
  const context = page.getByLabel("上下文窗口（tokens，可选）").last();
  const output = page.getByLabel("输出上限（tokens，可选）").last();
  await context.fill("12345");
  await output.fill("0");
  await page.evaluate(() => { window.fixture.failLlmList = true; });
  await page.getByRole("button", { name: "获取模型列表" }).click();
  await page.getByText("无法连接服务，请检查网络和地址。").waitFor();
  assert.equal(await context.inputValue(), "12345");
  assert.equal(await output.inputValue(), "0");
  assert.equal(await page.getByText("模型甲", { exact: true }).count(), 1);
  assert.equal(await page.getByText("new-a", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "移除模型 模型甲" }).click();
  assert.equal(await page.getByLabel("上下文窗口（tokens，可选）").last().inputValue(), "12345");
  assert.equal(await page.getByLabel("输出上限（tokens，可选）").last().inputValue(), "0");
  await page.getByRole("button", { name: "保存连接" }).click();
  await page.getByText("请输入 1 至 4294967295 的整数，或留空。").waitFor();
  assert.equal(await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "llm_update_connection").length), 0);
  const activeOutput = page.getByLabel("输出上限（tokens，可选）").last();
  assert.equal(await activeOutput.getAttribute("aria-invalid"), "true");
  await activeOutput.evaluate((element) => new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000;
    const check = () => document.activeElement === element ? resolve() : Date.now() > deadline ? reject(new Error("invalid field was not focused")) : requestAnimationFrame(check);
    check();
  }));
  await activeOutput.fill("");
  await page.getByRole("button", { name: "保存连接" }).click();
  await page.getByRole("button", { name: "添加连接", exact: true }).waitFor();
  const change = await page.evaluate(() => window.fixture.calls.find((call) => call.command === "llm_update_connection").args.change);
  assert.deepEqual(change.models.map((model) => model.modelId), ["example-model", "new-b"]);
  assert.equal(change.models[0].id, "model-1");
  assert.notEqual(change.models[1].id, "model-1");
  assert.equal(change.models[1].contextWindow, 12345);
  assert.equal(change.models[1].maxOutputTokens, null);
  assert.equal("rowKey" in change.models[1], false);
  assert.deepEqual(change.credential, { kind: "keep" });
  console.log("PASS model row identity, validation and optional numeric values");
} finally { await browser.close(); }
});
