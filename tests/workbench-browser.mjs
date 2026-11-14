// Run after `node tests/helpers/serve-workbench.mjs`.
// PLAYWRIGHT_MODULE may point to an externally installed Playwright ESM module.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const output = "src-tauri/target/workbench-acceptance";
await mkdir(output, { recursive: true });
const errors = [];
const editorText = locator => locator.inputValue();
const open = async (query = "", width = 1440, height = 900) => {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://localhost:1437/__workbench${query}`);
  await page.getByRole("log").getByRole("button").first().waitFor();
  return page;
};
const noOverflow = async page => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const send = page.getByRole("button", { name: /^(发送|Send)$/ });
  const box = await send.boundingBox();
  assert.ok(box && box.y + box.height <= page.viewportSize().height, "composer stays in viewport");
};
try {
  let page = await open();
  const input = page.getByRole("textbox", { name: "分章问题或补充说明" });
  await input.fill("当前会话的未发送说明");
  const starts = () => page.evaluate(() => window.fixture.calls.filter(call => call.command === "ai_start").length);
  assert.equal(await starts(), 0);
  await page.getByRole("button", { name: "新建诊断", exact: true }).click();
  assert.equal(await editorText(input), "");
  await input.fill("新会话的草稿");
  await page.getByRole("button", { name: "诊断历史", exact: true }).click();
  await page.getByRole("button", { name: /检查遗漏的章节标题/ }).click();
  assert.equal(await editorText(input), "当前会话的未发送说明");
  assert.equal(await starts(), 0);
  assert.equal(await page.evaluate(() => window.fixture.calls.some(call => call.command === "ai_cancel")), false);
  await page.screenshot({ animations: "disabled", path: `${output}/source-zh-light.png` });
  await page.getByRole("button", { name: /提交候选方案/ }).click();
  await page.getByRole("button", { name: /查看方案/ }).click();
  const review = page.getByRole("region", { name: "候选分章方案" });
  await review.getByRole("button", { name: "采用整套方案" }).waitFor();
  assert.ok((await review.innerText()).includes("新增 1 · 移除 0 · 调整 1"));
  await page.screenshot({ animations: "disabled", path: `${output}/review-zh-light.png` });
  await review.getByRole("button", { name: /新增.*第 11 行/ }).click();
  await page.locator('[data-source-line="10"]').waitFor();
  assert.ok((await page.locator('[data-source-line="10"]').innerText()).includes("第二章"));
  await page.getByRole("button", { name: "方案审阅", exact: true }).click();
  await page.evaluate(() => { window.fixture.failAdopt = true; });
  await page.getByRole("button", { name: "采用整套方案" }).click();
  const confirmation = page.getByRole("dialog", { name: "确认采用分章方案" });
  await confirmation.getByRole("button", { name: "确认采用" }).click();
  await confirmation.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "split_adopt").length), 1);
  await page.evaluate(() => { window.fixture.failAdopt = false; });
  await confirmation.getByRole("button", { name: "确认采用" }).click();
  await page.getByRole("status").filter({ hasText: "已采用" }).waitFor();
  const adoption = await page.evaluate(() => window.fixture.calls.filter(call => call.command === "split_adopt"));
  assert.equal(adoption[0].args.commandId, adoption[1].args.commandId, "adoption retry retains command identity");
  await noOverflow(page); await page.close();

  page = await open();
  await page.getByRole("treeitem", { name: /第一章 山雨/ }).first().click();
  await page.getByRole("button", { name: "编辑章节", exact: true }).click();
  await page.getByRole("textbox", { name: "章节标题", exact: true }).fill("人工修正标题");
  await page.getByRole("button", { name: "保存标题与分卷" }).click();
  await page.getByRole("button", { name: /提交候选方案/ }).click();
  await page.getByRole("button", { name: /查看方案/ }).click();
  await page.getByText("目录已变化，此方案已过期。请让助手重新检查。").waitFor();
  assert.equal(await page.getByRole("button", { name: "采用整套方案" }).isDisabled(), true);
  await page.close();

  page = await open();
  await page.evaluate(() => { window.fixture.failSend = true; });
  const failedInput = page.getByRole("textbox", { name: "分章问题或补充说明" });
  await failedInput.fill("失败后仍保留的输入");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await editorText(failedInput), "失败后仍保留的输入");
  await page.evaluate(() => { window.fixture.failSend = false; });
  await page.getByRole("button", { name: "询问此行" }).first().click();
  await page.getByRole("button", { name: "移除原文引用" }).waitFor();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await failedInput.fill("发送期间的新草稿");
  await page.waitForFunction(() => window.fixture.calls.filter(call => call.command === "ai_start").length === 2);
  await page.waitForFunction(() => !document.querySelector('button[type="button"]')?.textContent?.includes("正在停止"));
  const trigger = await page.evaluate(() => window.fixture.calls.filter(call => call.command === "ai_start").at(-1).args.request.trigger);
  assert.ok(trigger.message.includes("source_id=source; line=0"));
  assert.equal(await editorText(failedInput), "发送期间的新草稿");
  await page.close();

  page = await open();
  await page.evaluate(() => {
    const first = document.querySelector('[data-source-line="0"]').firstChild;
    const second = document.querySelector('[data-source-line="1"]').firstChild;
    getSelection().setBaseAndExtent(second, 12, first, 0);
  });
  await page.getByRole("button", { name: "询问选中的原文", exact: true }).click();
  await page.getByRole("button", { name: "移除原文引用" }).waitFor();
  await page.getByRole("textbox", { name: "分章问题或补充说明" }).fill("核对选中的标题");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "ai_start"));
  assert.ok((await page.evaluate(() => window.fixture.calls.find(call => call.command === "ai_start").args.request.trigger.message)).includes("line=0"));
  await page.close();

  page = await open("?long=1");
  await page.getByRole("button", { name: "更早的消息" }).click();
  await page.getByText("Earlier discussion 1", { exact: true }).waitFor();
  assert.equal(await page.getByRole("log").locator('[data-role="user"]').count(), 21);
  await noOverflow(page); await page.close();

  page = await open();
  const keyboardInput = page.getByRole("textbox", { name: "分章问题或补充说明" });
  await keyboardInput.fill("输入法组合不应发送");
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await keyboardInput.dispatchEvent("keydown", { key: "Enter", metaKey: mac, ctrlKey: !mac, isComposing: true, keyCode: 229 });
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "ai_start").length), 0);
  await keyboardInput.press(mac ? "Meta+Enter" : "Control+Enter");
  await page.waitForFunction(() => window.fixture.calls.filter(call => call.command === "ai_start").length === 1);
  const separator = page.getByRole("separator", { name: "调整目录宽度" });
  await separator.focus(); await separator.press("ArrowRight");
  assert.equal(await separator.getAttribute("aria-valuenow"), "320");
  await page.close();

  page = await open();
  await page.getByRole("button", { name: "分卷设置", exact: true }).click();
  await page.getByRole("textbox", { name: "新卷标题", exact: true }).fill("第一卷 山海");
  await page.getByRole("button", { name: "设置卷", exact: true }).click();
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "local_project_edit"));
  assert.deepEqual(await page.evaluate(() => window.fixture.calls.find(call => call.command === "local_project_edit").args.edit), { kind: "volume", sourceId: "source", line: 0, title: "第一卷 山海" });
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "分章规则", exact: true }).click();
  await page.getByRole("button", { name: "添加规则", exact: true }).click();
  await page.getByRole("button", { name: "应用规则并检查目录", exact: true }).click();
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "local_project_edit" && call.args.edit.kind === "rules"));
  await page.getByRole("button", { name: "撤销结构调整", exact: true }).click();
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "local_project_undo"));
  await page.close();

  page = await open("?textfail=1");
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator("[data-source-line]").count(), 0);
  await page.evaluate(() => { window.fixture.failText = false; });
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await page.locator('[data-source-line="0"]').waitFor();
  await page.close();

  page = await open("?status=interrupted");
  await page.getByText("此回复已中断，内容尚未完成。").waitFor();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "ai_start"));
  assert.equal(await page.evaluate(() => window.fixture.calls.find(call => call.command === "ai_start").args.request.trigger.type), "retry");
  await page.close();

  page = await open("?status=running");
  await page.getByRole("button", { name: "停止", exact: true }).waitFor();
  await page.getByRole("button", { name: "分章助手", exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixture.calls.some(call => call.command === "ai_cancel")), false);
  await page.getByRole("button", { name: "分章助手", exact: true }).click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已停止" }).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "ai_cancel").length), 1);
  await page.close();

  page = await open("?directory=1");
  const directory = page.getByRole("complementary", { name: "章节目录" });
  await directory.getByRole("tab", {name:"目录",exact:true}).hover();
  await page.locator('[data-slot="tooltip-content"]').filter({hasText:"10000"}).waitFor();
  assert.ok(await directory.getByRole("treeitem").count() < 50);
  await directory.getByRole("searchbox", { name: "搜索章节或目录序号", exact: true }).fill("101");
  await directory.getByRole("searchbox", { name: "搜索章节或目录序号", exact: true }).press("Enter");
  await directory.getByRole("treeitem", { name: /第 101 章$/ }).waitFor();
  await page.close();
  for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) {
    page = await open(`?locale=${locale}&theme=${theme}`, 1024, 680);
    await noOverflow(page);
    assert.equal(await page.getByRole("complementary", { name: locale === "zh" ? "章节目录" : "Chapter list" }).isVisible(), false);
    await page.getByRole("button", { name: locale === "zh" ? /提交候选方案/ : /Submit a proposal/ }).click();
    await page.getByRole("button", { name: locale === "zh" ? "查看方案" : "Review proposal", exact: false }).click();
    await page.getByRole("button", { name: locale === "zh" ? "采用整套方案" : "Adopt entire proposal" }).waitFor();
    await noOverflow(page);
    await page.screenshot({ animations: "disabled", path: `${output}/review-${locale}-${theme}-1024.png` });
    await page.getByRole("button", { name: locale === "zh" ? "目录" : "Directory", exact: true }).click();
    await page.getByRole("complementary", { name: locale === "zh" ? "章节目录" : "Chapter list" }).waitFor();
    await noOverflow(page);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS: review/location/adoption retry/stale/manual edits, drafts/failure/context/IME, interruption/retry/cancel, 10000 chapters/history, 1024px × two languages × two themes; no browser errors.");
} finally { await browser.close(); }
