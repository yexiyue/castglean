import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop");
  const checks = await page.evaluate(async () => (await import("/tests/helpers/hotkeys-fixture.tsx")).checkHotkeys());
  assert.ok(checks.includes("holding send shortcut emits only one message"));
  assert.ok(checks.includes("two mounted inputs remain isolated"));
  console.log(`PASS ${checks.length} synthetic shortcut and composition checks`);
} finally { await browser.close(); }
