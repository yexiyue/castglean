import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("directory-inspectors", async ({ flowBrowser: browser }) => {
const errors = [];
async function open(path, width = 1440) {
 const page = await browser.newPage({ viewport: { width, height: 780 } });
 page.setDefaultTimeout(30000); page.on("pageerror", e => errors.push(e.message));
 await page.goto(`http://localhost:1437${path}`, { timeout: 60000 });
 await page.locator("main").first().waitFor();
 return page;
}
const top = locator => locator.evaluate(el => el.getBoundingClientRect().top);
try {
 let page;
 for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) {
  page = await open(`/new?fixture=desktop&empty=1&locale=${locale}&theme=${theme}`, 1024);
  const trigger = page.getByRole("button", { name: locale === "zh" ? "选择 TXT 文件" : "Choose TXT files", exact: true });
  await page.evaluate(() => { window.fixture.selectionResult = "file"; });
  await trigger.click();
  const title = page.getByRole("textbox", { name: locale === "zh" ? "工程名称" : "Project name", exact: true });
  await title.fill("Shared draft");
  assert.equal(await title.inputValue(), "Shared draft");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("button", { name: locale === "zh" ? "移除 公开样本.txt" : "Remove 公开样本.txt", exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.command === "local_source_release").length), 1);
  assert.equal(await page.evaluate(() => window.fixture.calls.some(c => c.command === "local_project_create")), false);
  assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
  await page.close();
 }
 page = await open("/voices/new?fixture=desktop", 1024);
 const advanced = page.getByRole("button", { name: "高级选项", exact: true });
 await advanced.waitFor();
 const generate = page.getByRole("button", { name: "生成音色候选", exact: true, includeHidden: true });
 const generateTop = await top(generate);
 await advanced.click();
 await page.getByRole("textbox", { name: "随机种子（可选）", exact: true }).fill("42");
 assert.equal(await top(generate), generateTop);
 await page.keyboard.press("Escape");
 await page.getByRole("dialog").waitFor({ state: "hidden" });
 await advanced.click(); assert.equal(await page.getByRole("textbox", { name: "随机种子（可选）", exact: true }).inputValue(), "42");
 await page.keyboard.press("Escape");
 await page.getByRole("dialog").waitFor({ state: "hidden" });
 assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
 await page.close();

 page = await open("/voices?fixture=desktop&library=mine&inspectors=1", 1024);
 const results = page.getByRole("button", { name: "查看每个音色的结果", exact: true });
 await results.click();
 await page.getByRole("dialog", { name: "查看每个音色的结果", exact: true }).getByText("山风", { exact: false }).waitFor();
 await page.getByRole("dialog", { name: "查看每个音色的结果", exact: true }).getByText("来源文件：公开样本.voice", { exact: true }).waitFor();
 await page.keyboard.press("Escape");
 await page.getByRole("dialog").waitFor({ state: "hidden" });
 await page.getByRole("button", { name: "查看导入预览", exact: true }).click();
 const parent = page.getByRole("dialog", { name: "导入音色包", exact: true });
 await parent.waitFor();
 const reference = parent.getByRole("button", { name: "查看参考信息", exact: true });
 await reference.click();
 const child = page.getByRole("dialog", { name: "查看参考信息", exact: true });
 await child.getByText("包内参考文本：山风穿过松林。", { exact: true }).waitFor();
 await page.keyboard.press("Escape");
 await child.waitFor({ state: "hidden" });
 assert.equal(await parent.isVisible(), true);
 assert.equal(await reference.evaluate(el => el === document.activeElement), true);
 await page.keyboard.press("Escape");
 await parent.waitFor({ state: "hidden" });
 assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
 await page.close();
 page = await open("/voices?fixture=desktop&library=mine", 1024);
 await page.getByRole("button", { name: /山风/ }).first().click();
 const management = page.getByRole("button", { name: "管理音色", exact: true });
 await management.waitFor();
 await management.click();
 const editor = page.getByRole("dialog", { name: "管理音色", exact: true });
 await editor.waitFor();
 await page.keyboard.press("Escape");
 await editor.waitFor({ state: "hidden" });
 assert.equal(await page.getByRole("dialog").isVisible(), true);
 assert.equal(await management.evaluate(el => el === document.activeElement), true);
 assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
 await page.close();
 console.log("PASS actual voice transfer results, nested import references and management: Escape closes only top inspector and restores focus");

 for (const [width, theme] of [[1440, "light"], [1024, "dark"]]) {
  page = await open(`/project/fixture-project?fixture=desktop&largeDirectory=1&grouped=1&theme=${theme}`, width);
  const tree = page.getByRole("tree", { name: "章节树", exact: true });
  if (!await tree.isVisible()) await page.getByRole("button", { name: "目录", exact: true }).click();
  await tree.waitFor();
  await page.screenshot({ path: `src-tauri/target/workbench-acceptance/directory-route-${width}-${theme}.png`, animations: "disabled" });
  await tree.focus(); await tree.press("End"); await tree.press("Enter");
  await page.waitForFunction(() => window.fixture.calls.some(c => c.command === "local_project_text" && c.args.line === 23340));
  await page.getByRole("tab", { name: /待检查/ }).click();
  await page.getByRole("region", { name: "待检查", exact: true }).getByRole("button").first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
  await page.close();
 }
 console.log("PASS actual splitting route: grouped 2335 chapters, fixed issues, keyboard End, wide/light and narrow/dark without overflow");

 page = await open("/voices/new?fixture=desktop&inspectors=1", 1024);
 const candidate = page.getByRole("article", { includeHidden: true }).filter({ hasText: "山风候选" });
 const audition = candidate.getByRole("button", { name: "打开试听配置", exact: true });
 await audition.waitFor();
 const candidateBox = () => candidate.evaluate(el => ({ top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height }));
 const candidateBefore = await candidateBox();
 await audition.click();
 await page.getByRole("dialog", { name: "打开试听配置", exact: true }).waitFor();
 await page.getByRole("textbox", { name: "试听文本", exact: true }).fill("保留候选试听草稿");
 assert.deepEqual(await candidateBox(), candidateBefore);
 await page.keyboard.press("Escape");
 await page.getByRole("dialog").waitFor({ state: "hidden" });
 assert.equal(await audition.evaluate(el => el === document.activeElement), true);
 await audition.click();
 assert.equal(await page.getByRole("textbox", { name: "试听文本", exact: true }).inputValue(), "保留候选试听草稿");
 await page.keyboard.press("Escape");
 await page.getByRole("dialog").waitFor({ state: "hidden" });
 assert.equal(await page.evaluate(() => window.fixture.calls.some(c => c.command === "start_voice_job")), false);
 assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
 await page.close();
 console.log("PASS candidate audition inspector retains geometry and focus without starting jobs");
 assert.deepEqual(errors, []);
 console.log("PASS actual import route in 4 locale/theme layouts and voice advanced settings: no background shift, retained input, Escape/focus, no unintended save");
} finally { await browser.close(); }
});
