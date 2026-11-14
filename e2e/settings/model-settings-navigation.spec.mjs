import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("model-settings-navigation", async ({ flowBrowser: browser }) => {
try {
  for (const surface of ["analysis", "assistant"]) for (const activation of ["mouse", "Enter", "Space"]) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
    await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop");
    if (surface === "assistant") await page.getByRole("button", { name: "返回 AI 助手" }).click();
    const label = surface === "assistant" ? "下次请求使用的模型" : "分析使用的模型";
    const trigger = page.getByRole("button", { name: label });
    if (activation === "mouse") await trigger.click();
    else { await trigger.focus(); await page.keyboard.press("Enter"); }
    const item = page.getByRole("menuitem", { name: "服务连接", exact: true });
    await item.waitFor();
    await page.getByText("无可用模型，先在服务连接中配置。").waitFor();
    if (activation === "mouse") await item.click();
    else { await item.focus(); await page.keyboard.press(activation); }
    const dialog = page.getByRole("dialog", { name: "设置" });
    await dialog.waitFor();
    assert.equal(new URL(page.url()).searchParams.get("settings"), "models");
    await dialog.getByText("文本模型连接", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction((name) => document.activeElement?.getAttribute("aria-label") === name, label);
    assert.equal(await page.getByRole("main", { name: "章节工作台" }).getAttribute("data-chapter-id"), "chapter-0");
    assert.equal(new URL(page.url()).searchParams.has("settings"), false);
    assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
    await page.close();
  }
  console.log("PASS model menu settings activation, chapter and focus restoration (mouse, Enter, Space)");
} finally { await browser.close(); }
});
