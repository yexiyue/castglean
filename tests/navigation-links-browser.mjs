import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
try {
  await page.goto("http://localhost:1437/start?fixture=desktop");
  const sample = page.getByRole("link", { name: "打开示例", exact: true });
  assert.equal(await sample.getAttribute("role"), null);
  await sample.focus();
  await page.keyboard.press("Space");
  assert.equal(new URL(page.url()).pathname, "/start");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/project\/sample/);

  await page.goto("http://localhost:1437/new?fixture=browser");
  const guide = page.getByRole("region", { name: "浏览器预览说明" });
  const guideLink = guide.getByRole("link", { name: "快速上手" });
  assert.equal(await guideLink.getAttribute("role"), null);
  await guideLink.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/start/);

  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop");
  const home = page.locator('[data-slot="desktop-bar"]').getByRole("link", { name: "工程首页" });
  assert.equal(await home.getAttribute("role"), null);
  await home.focus();
  await page.keyboard.press("Space");
  assert.equal(new URL(page.url()).pathname, "/project/fixture-project");
  await page.keyboard.press("Enter");
  await page.waitForURL(url => url.pathname === "/");

  await page.goto("http://localhost:1437/?fixture=desktop&unfinishedProject=1");
  const unfinished = page.getByRole("link", { name: /山海之间.*继续导入/ });
  await unfinished.waitFor();
  await page.keyboard.press("Tab");
  await unfinished.focus();
  assert.equal(await unfinished.evaluate(el => el.matches(":focus-visible") && getComputedStyle(el).boxShadow !== "none"), true);
  await page.keyboard.press("Enter");
  await page.waitForURL(url => url.pathname === "/new" && url.searchParams.get("draft") === "fixture-project");
  console.log("PASS guide navigation retains native link semantics and keyboard behavior");
} finally {
  await browser.close();
}
