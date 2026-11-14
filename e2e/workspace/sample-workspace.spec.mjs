import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("sample-workspace", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
page.setDefaultTimeout(15000);
try {
  await page.goto("http://localhost:1437/?fixture=desktop");
  await page.getByRole("link", { name: "打开示例" }).click();
  await page.waitForURL(/\/project\/sample/);
  await page.getByText("示例工程 · 只读预览。可浏览章节；分析、编辑、声音与导出需要真实工程。").waitFor();
  const workspace = page.getByRole("main", { name: "章节工作台" });
  await workspace.getByText("夜潮退去后，渡口的石阶露出一线湿亮的青色。", { exact: true }).waitFor();
  assert.equal(await workspace.getAttribute("data-chapter-id"), "sample-chapter-1");
  await workspace.getByRole("button", { name: "下一章" }).click();
  await workspace.getByText("天将亮时，阿岚带着旧航海图走向渡口。", { exact: true }).waitFor();
  assert.equal(await workspace.getAttribute("data-chapter-id"), "sample-chapter-2");
  assert.equal(await workspace.getByRole("button", { name: "编辑章节" }).count(), 0);
  assert.equal(await workspace.getByRole("button", { name: "分析本章" }).count(), 0);
  assert.equal(await workspace.getByRole("button", { name: "生成本章音频" }).count(), 0);
  await page.getByRole("button", { name: "工程角色", exact: true }).click();
  await page.getByText("示例工程仅供阅读；在真实工程中可管理角色与声音。").waitFor();
  await page.getByRole("button", { name: "制作结果", exact: true }).click();
  await page.getByText("示例不含音频；请在真实工程中生成、试听并导出。").waitFor();
  assert.equal(await page.getByRole("main").filter({ hasText: "示例不含音频" }).isVisible(), true);
  await page.getByText("示例工程 · 只读预览。可浏览章节；分析、编辑、声音与导出需要真实工程。").waitFor();
  await page.getByRole("button", { name: "返回章节制作" }).click();
  await workspace.waitFor();
  const calls = await page.evaluate(() => window.fixture.calls);
  assert.deepEqual(calls.filter((call) => JSON.stringify(call.args ?? {}).includes("sample")), []);
  assert.deepEqual(calls.filter((call) => /(?:edit|start|create|save|delete|remove|import|export|update|bind|adopt|discard|undo|cancel)/.test(call.command)), []);
  assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
  for (const section of ["chapters", "characters", "results"]) {
    const direct = await browser.newPage({ viewport: { width: 1024, height: 680 } });
    await direct.goto(`http://localhost:1437/project/sample?fixture=desktop&section=${section}`);
    await direct.getByText("示例工程 · 只读预览。可浏览章节；分析、编辑、声音与导出需要真实工程。").waitFor();
    if (section === "characters") await direct.getByText("示例工程仅供阅读；在真实工程中可管理角色与声音。").waitFor();
    if (section === "results") await direct.getByText("示例不含音频；请在真实工程中生成、试听并导出。").waitFor();
    assert.deepEqual(await direct.evaluate(() => window.fixture.calls.filter((call) => JSON.stringify(call.args ?? {}).includes("sample"))), []);
    await direct.close();
  }
  for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) {
    const preview = await browser.newPage({ viewport: { width: 1024, height: 680 } });
    await preview.goto(`http://localhost:1437/project/sample?fixture=browser&locale=${locale}&theme=${theme}`);
    await preview.getByText(locale === "zh" ? "示例工程 · 只读预览。可浏览章节；分析、编辑、声音与导出需要真实工程。" : "Sample project · Read-only preview. Browse chapters here; analysis, editing, voices and export require a real project.").waitFor();
    assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await preview.close();
  }
  console.log("PASS sample workbench navigation, read-only controls and no sample host calls");
} finally { await browser.close(); }
});
