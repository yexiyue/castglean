import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:1437/__wave-player");
  const progress = page.getByRole("slider", { name: "播放进度" });
  const volume = page.getByRole("slider", { name: "音量" });
  await page.waitForFunction(() => !document.querySelector('input[aria-label="音量"]')?.disabled);
  assert.equal(await progress.getAttribute("min"), "0");
  assert.equal(await progress.getAttribute("max"), "1");
  assert.equal(await progress.getAttribute("step"), "0.001");
  assert.match(await progress.getAttribute("aria-valuetext"), /0:0[0-2] \/ 0:02/);
  assert.equal(await volume.getAttribute("aria-valuetext"), "80%");
  await volume.press("ArrowRight");
  assert.equal(await volume.getAttribute("aria-valuetext"), "81%");
  await progress.press("Home");
  assert.equal(await progress.getAttribute("aria-valuenow"), "0");
  assert.equal(await page.locator("body").getAttribute("data-error"), null);
  console.log("PASS actual wave player slider names, values and keyboard control with synthetic audio");
} finally { await browser.close(); }
