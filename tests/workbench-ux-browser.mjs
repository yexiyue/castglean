// User-facing interaction regression; requires the explicit synthetic fixture server.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const errors = [];
async function open(query = "", width = 1024) {
  const page = await browser.newPage({ viewport: { width, height: 680 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://localhost:1437/__workbench${query}`, { timeout: 60000 });
  await page.getByRole("textbox", { name: "分章问题或补充说明" }).waitFor();
  return page;
}
try {
  let page = await open();
  const composer = page.getByRole("textbox", { name: "分章问题或补充说明" }).locator("xpath=ancestor::form[1]");
  assert.equal(await composer.getByRole("combobox", { name: "诊断模型" }).count(), 1);
  assert.equal(await page.getByText("0/2000", { exact: true }).count(), 0);
  assert.equal(await page.getByText("发送目录摘要及按需正文，方案经确认后采用。", { exact: true }).count(), 0);
  const info = page.getByRole("button", { name: "会话信息", exact: true });
  await info.focus(); await info.press("Enter");
  await page.getByText("累计请求 2 次", { exact: false }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "会话信息");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "分章规则", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "追加文件", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "撤销调整", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "询问选中的原文", exact: true }).count(), 0);
  const reads = await page.evaluate(() => window.fixture.calls.filter(call => call.command === "local_project_text").length);
  await page.getByRole("button", { name: "转到行", exact: true }).click();
  const jump = page.getByRole("spinbutton", { name: "转到行" });
  await jump.fill("11");
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "local_project_text").length), reads);
  await jump.press("Enter");
  await page.waitForFunction(count => window.fixture.calls.filter(call => call.command === "local_project_text").length > count, reads);
  await page.locator('[data-source-line="10"]').waitFor();
  await page.getByRole("button", { name: "转到行", exact: true }).click();
  assert.equal(await jump.inputValue(), "11");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "询问此行" }).first().click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "分章问题或补充说明");
  assert.equal(await page.getByRole("textbox", { name: "分章问题或补充说明" }).evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "移除原文引用" }).click();
  await page.getByRole("button", { name: "新建诊断", exact: true }).click();
  const check = page.getByRole("button", { name: "检查当前分章", exact: true });
  await check.waitFor();
  const input = page.getByRole("textbox", { name: "分章问题或补充说明" });
  await input.fill("请保留我的草稿");
  assert.equal(await check.count(), 0);
  await input.fill("");
  await check.evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "ai_start"));
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "ai_start").length), 1);
  assert.match(await page.evaluate(() => window.fixture.calls.find(call => call.command === "ai_start").args.request.trigger.message), /请检查当前分章/);
  await page.close();

  page = await open("?unready=1");
  await page.getByRole("button", { name: "新建诊断", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "检查当前分章", exact: true }).isDisabled(), true);
  await page.getByText("请先选择模型并完成连接与工具测试。人工分章仍可使用。", { exact: true }).waitFor();
  await page.close();

  page = await open("?rebind=1");
  await page.getByRole("textbox", { name: "分章问题或补充说明" }).fill("换模型后继续");
  assert.equal(await page.getByRole("button", { name: "发送", exact: true }).isDisabled(), true);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "ai_start"));
  assert.equal(await page.evaluate(() => window.fixture.calls.find(call => call.command === "ai_start").args.request.confirmRebind), true);
  await page.close();

  page = await open("?status=running&markdown=1", 1440);
  const log = page.getByRole("log");
  await page.evaluate(() => window.fixture.streamText("长对话\n\n" + Array.from({length: 60}, (_, i) => `${i + 1}. 正在检查第 ${i + 1} 处标题`).join("\n")));
  await log.getByText("正在检查第 60 处标题", { exact: false }).waitFor();
  await log.evaluate(element => { element.scrollTop = 0; });
  await page.getByRole("button", { name: "回到最新", exact: true }).waitFor();
  await page.evaluate(() => window.fixture.streamText("长对话\n\n" + Array.from({length: 61}, (_, i) => `${i + 1}. 正在检查第 ${i + 1} 处标题`).join("\n")));
  await log.getByText("正在检查第 61 处标题", { exact: false }).waitFor();
  assert.ok(await log.evaluate(element => element.scrollTop < 100));
  await page.getByRole("button", { name: "回到最新", exact: true }).click();
  assert.ok(await log.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop < 64));
  assert.equal(await log.evaluate(element => element === document.activeElement), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.close();
  assert.deepEqual(errors, []);
  console.log("PASS: compact discoverable controls, keyboard info/menu, submit-only jump, contextual focus, one-click/no-overwrite/no-duplicate check, setup/rebind safety, reading anchor/jump to latest.");
} finally { await browser.close(); }
