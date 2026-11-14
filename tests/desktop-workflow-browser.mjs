import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const errors = [];
async function open(path, width = 1024) {
 const page = await browser.newPage({ viewport: { width, height: 680 } });
 page.setDefaultTimeout(10000);
 page.on("pageerror", e => errors.push(e.message));
 await page.goto(`http://localhost:1437${path}${path.includes("?") ? "&" : "?"}fixture=desktop`);
 await page.locator("main").first().waitFor();
 return page;
}
async function close(page) {
 assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
 await page.close();
}
const calls = (page, command) => page.evaluate(command => window.fixture.calls.filter(c => c.command === command).length, command);
try {
 for (const fail of [false, true]) {
  const page = await open("/new?empty=1");
  await page.evaluate(fail => { window.fixture.failSelect = fail; }, fail);
  const choose = page.getByRole("button", { name: "选择 TXT 文件", exact: true });
  await choose.click();
  await page.waitForFunction(() => window.fixture.calls.some(c => c.command === "local_source_select"));
  assert.equal(await calls(page, "local_project_create"), 0);
  assert.equal(await calls(page, "local_project_import"), 0);
  if (fail) await page.getByRole("alert").waitFor();
  await page.evaluate(() => { window.fixture.failSelect = false; window.fixture.selectionResult = "file"; });
  await choose.click();
  await page.getByText("公开样本.txt", { exact: true }).waitFor();
  await page.getByRole("button", { name: "导入并开始制作", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "工程名称", exact: true }).inputValue(), "公开样本");
  await page.getByRole("textbox", { name: "工程名称", exact: true }).fill(" ");
  await page.getByRole("button", { name: "导入并开始制作", exact: true }).click();
  await page.getByText("请输入工程名称。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "工程名称", exact: true }).evaluate(el => el === document.activeElement), true);
  await page.getByRole("textbox", { name: "工程名称", exact: true }).fill("公开样本");
  assert.equal(await calls(page, "local_project_create"), 0);
  assert.equal(await calls(page, "local_project_import"), 0);
  await page.getByRole("button", { name: "移除 公开样本.txt", exact: true }).click();
  assert.equal(await calls(page, "local_source_release"), 1);
  assert.equal(await calls(page, "local_project_import"), 0);
  await close(page);
 }
 console.log("PASS cancel/error/retry without premature project creation, encoding preview and handle release");
 let page = await open("/models");
 const row = page.getByRole("button", { name: "Kokoro", exact: true });
 await row.focus(); await row.press("Enter");
 await page.getByRole("dialog").waitFor();
 await page.keyboard.press("Escape");
 await page.getByRole("dialog").waitFor({ state: "hidden" });
 assert.equal(await row.evaluate(el => el === document.activeElement), true);
 assert.equal(await calls(page, "prepare_model"), 0);
 const header = page.locator('[data-slot="page-heading"]');
 assert.ok(await header.evaluate(el => el.getBoundingClientRect().height) <= 56);
 assert.equal(await header.getByRole("tab", { name: "语音合成", exact: true }).count(), 1);
 await close(page);
 page = await open("/voices?library=mine");
 assert.equal(await page.getByRole("button", { name: "导出所选音色", exact: true }).count(), 0);
 await page.getByRole("button", { name: "全选搜索结果", exact: true }).click();
 await page.getByRole("button", { name: "导出所选音色", exact: true }).waitFor();
 await page.getByRole("button", { name: "取消全选", exact: true }).click();
 assert.equal(await page.getByRole("button", { name: "导出所选音色", exact: true }).count(), 0);
 await close(page);
 page = await open("/voices/new");
 await page.getByRole("combobox", { name: "设计引擎", exact: true }).waitFor();
 assert.equal(await page.getByRole("region", { name: "音色设计引擎", exact: true }).count(), 0);
 await page.getByRole("textbox", { name: "音色名称", exact: true }).fill("创作草稿");
 await page.locator('[data-slot="page-heading"]').getByRole("link", { name: "音色中心", exact: true }).click();
 await page.getByRole("link", { name: "创建音色", exact: true }).click();
 assert.equal(await page.getByRole("textbox", { name: "音色名称", exact: true }).inputValue(), "创作草稿");
 await close(page);
 page = await open("/voices/new?unready=1");
 await page.getByRole("region", { name: "音色设计引擎", exact: true }).waitFor();
 assert.equal(await page.getByRole("button", { name: "生成音色候选", exact: true }).isDisabled(), true);
 await page.getByRole("button", { name: /Qwen Voice Design/ }).click();
 await page.getByRole("button", { name: "准备资源", exact: true }).waitFor();
 assert.equal(await calls(page, "start_voice_job"), 0);
 await close(page);
 assert.deepEqual(errors, []);
 console.log("PASS compact context bar, full-row keyboard/focus, contextual export, ready/unready resource access and creation draft");
} finally { await browser.close(); }
