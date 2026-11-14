import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("narrow-panel-return", async ({ flowBrowser: browser }) => {
try {
  for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) {
    const en = locale === "en";
    const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
    page.setDefaultTimeout(30000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&locale=${locale}&theme=${theme}`);
    const main = page.getByRole("main", { name: en ? "Chapter workspace" : "章节工作台" });
    await main.waitFor();
    for (const label of en ? ["Check chapters", "Analyze chapter", "Generate chapter audio"] : ["检查分章", "分析本章", "生成本章音频"]) {
      const action = page.getByRole("button", { name: label, exact: true });
      await action.waitFor();
      assert.ok((await action.innerText()).trim().length > 0, `${label} has visible text`);
    }
    await page.getByRole("button", { name: en ? "Analyze chapter" : "分析本章", exact: true }).click();
    const segment = page.locator("[data-segment-id]").nth(1); await segment.waitFor(); await segment.click();
    const field = page.getByLabel(en ? "Type" : "类型", { exact: true }); await field.focus();
    const before = await field.inputValue();
    const directory = page.getByRole("button", { name: en ? "Directory" : "目录", exact: true });
    await directory.click();
    assert.equal(await page.getByRole("heading", { name: en ? "Clip properties" : "片段属性", exact: true }).isVisible(), false);
    await directory.click();
    await field.waitFor();
    await page.waitForFunction(node => node === document.activeElement, await field.elementHandle());
    assert.equal(await field.inputValue(), before);
    assert.equal(await field.evaluate(node => node === document.activeElement), true, "focus returns to the inspected control");
    const inspectorToggle = page.locator('[data-slot="desktop-bar"]').getByRole("button", { name: en ? "Clip properties" : "片段属性", exact: true });
    assert.equal(await inspectorToggle.getAttribute("aria-expanded"), "true");
    await page.getByRole("button", { name: en ? "Back to AI assistant" : "返回 AI 助手", exact: true }).click();
    const input = page.getByRole("textbox", { name: en ? "Project question or additional details" : "工程问题或补充说明" });
    await input.fill("draft survives directory"); await input.focus();
    await directory.click(); await directory.click(); await input.waitFor();
    await page.waitForFunction(node => node === document.activeElement, await input.elementHandle());
    assert.equal(await input.inputValue(), "draft survives directory");
    assert.equal(await input.evaluate(node => node === document.activeElement), true, "focus returns to assistant draft");
    const send = page.getByRole("button", { name: en ? "Send" : "发送", exact: true });
    const bounds = await send.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1024 && bounds.y + bounds.height <= 680, "send button stays visible inside the window");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `src-tauri/target/workbench-acceptance/narrow-panels-${locale}-${theme}.png`, animations: "disabled" });
    await page.close();
  }
  console.log("PASS narrow directory return, panel target, focus, draft, visible actions and locale/theme matrix");
} finally { await browser.close(); }
});
