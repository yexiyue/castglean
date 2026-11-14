import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(20000);
try {
  await page.goto("http://localhost:1437/voices/new?fixture=desktop&voiceAudition=1");
  await page.getByLabel("音色名称").fill("公开音色");
  await page.getByLabel("声音描述").fill("柔和的声音");
  await page.evaluate(() => { window.fixture.failDesignRead = true; });
  await page.getByRole("button", { name: "生成音色候选" }).click();
  await page.getByText("无法读取声音工作室状态").waitFor();
  assert.equal(await page.getByRole("button", { name: "生成音色候选" }).isDisabled(), true);
  assert.equal(await page.getByLabel("声音描述").inputValue(), "柔和的声音");
  await page.evaluate(() => { window.fixture.failDesignRead = false; });
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByText("无法读取声音工作室状态").waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "生成音色候选" }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "start_voice_job").length), 1);
  await page.goto("http://localhost:1437/voices/new?fixture=desktop&designListenFailure=1");
  await page.getByText("无法读取声音工作室状态").waitFor();
  const attempts = await page.evaluate(() => window.fixture.designListenAttempts);
  await page.evaluate(() => { window.fixture.failDesignListen = false; });
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByText("无法读取声音工作室状态").waitFor({ state: "hidden" });
  assert.ok(await page.evaluate(() => window.fixture.designListenAttempts) > attempts);
  await page.getByLabel("设计引擎").waitFor();
  console.log("PASS failed engine catalog refresh blocks stale selection and retries read only");
} finally { await browser.close(); }
