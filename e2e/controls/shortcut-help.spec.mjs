import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("shortcut-help", async ({ flowBrowser: browser }) => {
try {
  for (const platform of ["mac", "windows"]) for (const locale of ["zh", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 680 }, userAgent: platform === "mac" ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    await context.addInitScript((value) => Object.defineProperty(navigator, "platform", { get: () => value }), platform === "mac" ? "MacIntel" : "Win32");
    const page = await context.newPage();
    await page.goto(`http://localhost:1437/project/fixture-project?fixture=desktop&settings=shortcuts&locale=${locale}`);
    const dialog = page.getByRole("dialog", { name: locale === "zh" ? "设置" : "Settings" });
    const rows = dialog.locator("dl > div");
    await rows.first().waitFor();
    assert.equal(await rows.count(), 5);
    const keys = await rows.locator("kbd").allTextContents();
    assert.deepEqual(keys, platform === "mac" ? ["⌘ ↵", "⌘ B", "⌥ ⌘ B", "⌘ G", "Esc"] : ["Ctrl+↵", "Ctrl+B", "Ctrl+Alt+B", "Ctrl+G", "Esc"]);
    assert.ok((await rows.allTextContents()).every((text) => text.trim().length > 8));
    const directory = page.getByRole("button", { name: locale === "zh" ? "目录" : "Directory", exact: true, includeHidden: true });
    const expanded = await directory.getAttribute("aria-expanded");
    await page.keyboard.press(platform === "mac" ? "Meta+B" : "Control+B");
    assert.equal(await directory.getAttribute("aria-expanded"), expanded, "background shortcuts do not act through settings");
    const search = dialog.getByRole("searchbox");
    await search.fill("xxx");
    await search.press("Escape");
    assert.equal(await search.inputValue(), "");
    assert.equal(await dialog.isVisible(), true);
    await search.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.keyboard.press(platform === "mac" ? "Meta+B" : "Control+B");
    await page.waitForFunction((previous) => document.querySelector('[aria-controls$="-directory"]')?.getAttribute("aria-expanded") !== previous, expanded);
    const inspector = page.locator('[aria-controls$="-assistant"]');
    const inspectorExpanded = await inspector.getAttribute("aria-expanded");
    await page.keyboard.press(platform === "mac" ? "Meta+Alt+B" : "Control+Alt+B");
    await page.waitForFunction((previous) => document.querySelector('[aria-controls$="-assistant"]')?.getAttribute("aria-expanded") !== previous, inspectorExpanded);
    await context.close();
  }
  const mac = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
  await mac.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }));
  const page = await mac.newPage();
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop");
  const go = page.getByRole("button", { name: "转到行", exact: true });
  const dialog = page.getByRole("dialog", { name: "转到行" });
  await go.waitFor();
  await go.focus();
  await page.keyboard.press("Control+g");
  assert.equal(await dialog.isVisible(), false, "macOS Control+G does not invoke the workspace shortcut");
  await page.keyboard.press("Meta+g");
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction((el) => el === document.activeElement, await go.elementHandle());
  await mac.close();
  console.log("PASS shortcut descriptions, platform keys and search Escape priority");
} finally { await browser.close(); }
});
