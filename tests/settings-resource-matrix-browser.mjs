import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const errors = [];
try {
  for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
    page.on("pageerror", error => errors.push(error.message));
    const en = locale === "en";
    await page.goto(`http://localhost:1437/project/fixture-project?fixture=desktop&storageFixture=1&locale=${locale}&theme=${theme}`);
    const chapter = page.locator('main[data-chapter-id="chapter-0"]'); await chapter.waitFor();
    const trigger = page.getByRole("button", { name: en ? "Settings" : "设置", exact: true });
    await trigger.focus(); await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: en ? "Settings" : "设置" }); await dialog.waitFor();
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).padding), "0px");
    const storage = dialog.getByRole("button", { name: en ? "Storage" : "存储位置", exact: true });
    await storage.focus(); await storage.press("Enter");
    assert.equal(await storage.getAttribute("aria-current"), "page");
    assert.deepEqual(await storage.evaluate(el => { const style = getComputedStyle(el); return [style.height, style.paddingLeft, style.borderRadius]; }), ["32px", "8px", "8px"]);
    for (const name of en ? ["Choose model cache directory", "Choose application data directory", "Choose application cache directory"] : ["选择模型缓存目录", "选择应用数据目录", "选择应用缓存目录"]) {
      const control = dialog.getByRole("button", { name, exact: true });
      assert.equal(await control.isVisible(), true); assert.equal(await control.isEnabled(), true);
    }
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), theme === "dark");
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(el => document.activeElement === el, await trigger.elementHandle());
    await chapter.waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls.some(call => call.command === "update_engine_settings")), false);
    await page.close();
    const voices = await browser.newPage({ viewport: { width: 1024, height: 680 } });
    voices.on("pageerror", error => errors.push(error.message));
    await voices.goto(`http://localhost:1437/voices?fixture=desktop&locale=${locale}&theme=${theme}`);
    const select = voices.getByRole("combobox", { name: en ? "Select model" : "选择模型" });
    await select.focus(); await select.press("Enter");
    await voices.getByRole("option", { name: "Kokoro", exact: true }).click();
    assert.equal(new URL(voices.url()).searchParams.get("model"), "kokoro/kokoro");
    assert.equal(await voices.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await voices.evaluate(() => window.fixture.calls.some(call => /prepare_model|start_voice_job/.test(call.command))), false);
    await voices.close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS settings and voice resource keyboard flows in four locale/theme combinations");
} finally { await browser.close(); }
