// Run against tests/helpers/serve-workbench.mjs. All desktop data is synthetic.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const errors = [], unexpected = [];
const output = "src-tauri/target/workbench-acceptance";
await mkdir(output, { recursive: true });
async function open(path, options = {}) {
  const page = await browser.newPage({ viewport: { width: options.width || 1024, height: 680 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  const url = new URL(path, "http://localhost:1437");
  url.searchParams.set("fixture", options.mode || "desktop");
  url.searchParams.set("locale", options.locale || "zh");
  url.searchParams.set("theme", options.theme || "light");
  await page.goto(url.href);
  await page.locator("main").first().waitFor();
  await page.locator("h1,h2,h3,[data-slot=empty-title],[data-slot=card-title]").first().waitFor();
  return page;
}
async function finish(page) {
  unexpected.push(...await page.evaluate(() => window.fixture?.unexpected || []));
  await page.close();
}
async function radius(locator, expected) {
  assert.equal(await locator.evaluate(el => getComputedStyle(el).borderTopLeftRadius), `${expected}px`);
}
async function clearSearch(page, name) {
  const input = page.getByRole("searchbox", { name, exact: true });
  await input.fill("NO-MATCH-XYZ");
  await page.getByRole("button", { name: "清除搜索", exact: true }).first().waitFor();
  await input.press("Escape");
  assert.equal(await input.inputValue(), "");
  assert.equal(await input.evaluate(el => el === document.activeElement), true);
  await input.fill("another");
  await page.getByRole("button", { name: "清除搜索", exact: true }).first().click();
  assert.equal(await input.inputValue(), "");
  assert.equal(await input.evaluate(el => el === document.activeElement), true);
}
try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:1437/__geometry?theme=${theme}`);
    await page.getByRole("textbox", { name: "Input", exact: true }).waitFor();
    for (const slot of ["input", "textarea", "native-select", "select-trigger"])
      await radius(page.locator(`[data-slot="${slot}"]`), 10);
    for (const button of await page.locator('[data-slot="button"]').all()) await radius(button, 10);
    await radius(page.locator('[data-slot="card"]'), 12);
    await page.getByRole("combobox", { name: "Select", exact: true }).click();
    await radius(page.locator('[data-slot="select-content"]'), 12);
    await radius(page.locator('[data-slot="select-item"]'), 8);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Popover", exact: true }).click();
    await radius(page.locator('[data-slot="popover-content"]'), 12);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Dialog", exact: true }).click();
    await radius(page.getByRole("dialog"), 16);
    assert.equal(await page.locator('[data-slot="dialog-footer"]').evaluate(el => getComputedStyle(el).borderBottomLeftRadius), "16px");
    await page.close();
  }
  console.log("PASS semantic radii in both themes, including small buttons, menu items and dialog footer");
  let page = await open("/");
  await clearSearch(page, "搜索工程");
  await page.getByRole("button", { name: "导入小说", exact: true }).waitFor();
  await finish(page);
  page = await open("/models");
  await clearSearch(page, "搜索模型");
  await page.getByRole("button", { name: "Kokoro", exact: true }).first().click();
  await page.getByRole("dialog").waitFor(); await radius(page.getByRole("dialog"), 16);
  await page.keyboard.press("Escape");
  await finish(page);
  page = await open("/voices");
  await clearSearch(page, "搜索预置音色");
  await page.getByRole("button", { name: /Heart/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "我的音色", exact: true }).click();
  await clearSearch(page, "搜索我的音色");
  assert.equal(await page.getByText(/已选择 0/).count(), 0);
  await page.getByRole("button", { name: "全选搜索结果", exact: true }).click();
  await page.getByText("已选择 1 个音色", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消全选", exact: true }).click();
  await page.getByRole("button", { name: /山风/ }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "导入音色包", exact: true }).first().click();
  await page.getByRole("dialog").waitFor(); await radius(page.getByRole("dialog"), 16);
  await finish(page);
  page = await open("/voices?library=mine&empty=1");
  await page.getByText("还没有自己的音色", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "全选搜索结果", exact: true }).count(), 0);
  await finish(page);
  page = await open("/voices/new");
  await page.getByRole("textbox", { name: "音色名称", exact: true }).fill("保留草稿");
  await page.getByRole("textbox", { name: "声音描述", exact: true }).fill("温柔的讲述声音");
  assert.equal(await page.getByRole("combobox", { name: "计算设备", exact: true }).isVisible(), false);
  await page.getByText("高级选项", { exact: true }).click();
  const seed = page.getByRole("textbox", { name: "随机种子（可选）", exact: true });
  await seed.fill("-1"); await page.getByRole("alert").filter({ hasText: "随机种子请输入" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "生成音色候选", exact: true, includeHidden: true }).isDisabled(), true);
  await seed.fill("42");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "参考录音", exact: true }).click();
  await page.getByRole("textbox", { name: "准确转写", exact: true }).fill("山风穿过松林");
  await page.getByRole("tab", { name: "文字设计", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "声音描述", exact: true }).inputValue(), "温柔的讲述声音");
  await page.locator('a[href="/models"]').first().click();
  await page.locator('a[href="/voices"]').first().click();
  await page.getByRole("button", { name: "创建音色", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "音色名称", exact: true }).inputValue(), "保留草稿");
  await page.getByRole("tab", { name: "参考录音", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "准确转写", exact: true }).inputValue(), "山风穿过松林");
  await page.screenshot({ path: `${output}/desktop-voice-recording.png`, animations: "disabled" });
  assert.equal(await page.evaluate(() => window.fixture.calls.some(c => /start_voice_job|select_voice_reference|delete_library_voice|prepare_model/.test(c.command))), false);
  await finish(page);
  page = await open("/?settings=general");
  await page.getByRole("dialog").waitFor();
  const search = page.getByRole("searchbox", { name: "搜索设置分类", exact: true });
  await search.fill("NO-MATCH"); await search.press("Escape");
  assert.equal(await search.inputValue(), ""); assert.equal(await page.getByRole("dialog").isVisible(), true);
  await search.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
  await finish(page);
  console.log("PASS searches, detail overlays, batch selection, creation drafts, validation and settings Escape");
  let count = 0;
  for (const mode of ["browser", "desktop"]) for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) {
    for (const path of ["/", "/new", "/start", "/models", "/voices", "/voices/new", "/project/sample", "/project/sample?section=characters", "/project/sample?section=results", ...["general", "models", "storage", "language", "shortcuts", "about"].map(section => `/?settings=${section}`), "/missing"]) {
      console.log(`Checking ${mode} ${locale} ${theme} ${path}`);
      const page = await open(path, { mode, locale, theme });
      if (path.includes("settings=")) await page.getByRole("dialog").waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${mode} ${locale} ${theme} ${path} overflows`);
      assert.equal(await page.getByText("Something went wrong", { exact: false }).count(), 0);
      if (mode === "desktop" && theme === "light" && locale === "zh" && ["/", "/models", "/voices", "/voices/new", "/project/sample?section=characters", "/?settings=general", "/?settings=storage"].includes(path)) await page.screenshot({ path: `${output}/desktop-${path.replace(/[^a-z]+/g, "-") || "home"}.png`, animations: "disabled" });
      await finish(page); count++;
    }
  }
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  console.log(`PASS ${count} page/theme/locale/runtime combinations at 1024×680; no page errors or unexpected IPC`);
} finally { await browser.close(); }
