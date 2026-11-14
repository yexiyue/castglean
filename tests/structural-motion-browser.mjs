import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
try {
  for (const motion of ["no-preference", "reduce"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: motion });
    await page.goto("http://localhost:1437/__geometry?structural=1");
    const skeleton = page.getByLabel("Loading placeholder");
    const gap = page.locator('[data-slot="sidebar-gap"]');
    const container = page.locator('[data-slot="sidebar-container"]');
    const trace = page.locator('[data-slot="trace-collapsible-trigger"]');
    const icon = trace.locator('[data-slot="trace-icon"]');
    const transition = el => el.evaluate(node => getComputedStyle(node).transitionProperty);
    const animation = await skeleton.evaluate(node => getComputedStyle(node).animationName);
    const shimmer = await page.getByText("Running trace").evaluate(node => getComputedStyle(node).animationName);
    if (motion === "reduce") {
      assert.equal(animation, "none");
      assert.equal(shimmer, "none");
      for (const el of [gap, container, icon]) assert.equal(await transition(el), "none");
    } else {
      assert.notEqual(animation, "none");
      assert.notEqual(shimmer, "none");
      for (const el of [gap, container, icon]) assert.notEqual(await transition(el), "none");
    }
    await page.getByRole("button", { name: "切换侧栏" }).click();
    assert.equal(await page.locator('[data-slot="sidebar"]').getAttribute("data-state"), "collapsed");
    await trace.click();
    const content = page.locator('[data-slot="trace-collapsible-content"]');
    await page.getByText("Trace details").waitFor({ state: "visible" });
    if (motion === "reduce") assert.equal(await transition(content), "none");
    else assert.notEqual(await transition(content), "none");
    await trace.click();
    await page.getByText("Trace details").waitFor({ state: "hidden" });
    await page.close();
  }
  console.log("PASS sidebar, trace and skeleton motion preferences with working controls");
} finally { await browser.close(); }
