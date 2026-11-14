import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&storageFixture=1");
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await page.locator('main[data-chapter-id="chapter-1"]').waitFor();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("button", { name: "存储位置", exact: true }).click();
  const names = ["选择模型缓存目录", "选择应用数据目录", "选择应用缓存目录"];
  await page.evaluate(() => { window.fixture.cancelDirectory = true; });
  for (const name of names) await dialog.getByRole("button", { name, exact: true }).click();
  assert.equal(await dialog.getByRole("button", { name: "保存设置", exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "plugin:dialog|open").length), 3);
  assert.equal(await page.evaluate(() => window.fixture.calls.some((call) => call.command === "update_engine_settings")), false);
  await page.evaluate(() => { window.fixture.cancelDirectory = false; });
  for (const name of names) await dialog.getByRole("button", { name, exact: true }).click();
  for (const name of ["恢复默认模型缓存目录", "恢复默认应用数据目录", "恢复默认应用缓存目录"]) await dialog.getByRole("button", { name, exact: true }).click();
  assert.equal(await dialog.getByRole("button", { name: "保存设置", exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.fixture.calls.some((call) => call.command === "update_engine_settings")), false);
  await dialog.getByRole("button", { name: "通用", exact: true }).click();
  await dialog.getByRole("combobox", { name: "主题" }).click();
  await page.getByRole("option", { name: "深色" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
  await dialog.getByRole("button", { name: "语言", exact: true }).click();
  await dialog.getByRole("combobox", { name: "界面语言" }).click();
  await page.getByRole("option", { name: "English" }).click();
  await page.getByRole("dialog", { name: "Settings" }).waitFor();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close", exact: true }).click();
  await page.locator('main[data-chapter-id="chapter-1"]').waitFor();
  await page.close();

  const models = await browser.newPage();
  await models.goto("http://localhost:1437/voices?fixture=desktop");
  await models.getByRole("combobox", { name: "选择模型" }).click();
  await models.getByRole("option", { name: "Kokoro", exact: true }).click();
  assert.equal(new URL(models.url()).searchParams.get("model"), "kokoro/kokoro");
  assert.equal(await models.evaluate(() => window.fixture.calls.some((call) => /prepare_model|start_voice_job|update_engine_settings/.test(call.command))), false);
  await models.close();

  const english = await browser.newPage();
  await english.goto("http://localhost:1437/project/fixture-project?fixture=desktop&storageFixture=1&settings=storage&locale=en");
  const englishDialog = english.getByRole("dialog", { name: "Settings" });
  for (const name of ["Choose model cache directory", "Choose application data directory", "Choose application cache directory"]) await englishDialog.getByRole("button", { name, exact: true }).waitFor();
  await english.close();

  for (const failure of [false, true]) {
    const p = await browser.newPage();
    await p.goto(`http://localhost:1437/start?fixture=desktop${failure ? "&projectListFailure=1&modelListFailure=1" : ""}`);
    const steps = p.locator("ol > li");
    if (failure) {
      await steps.nth(0).getByRole("status").getByText("无法读取状态").waitFor();
      await steps.nth(1).getByRole("status").getByText("无法读取状态").waitFor();
      assert.equal(await p.getByText("已完成", { exact: true }).count(), 0);
    } else {
      await steps.nth(0).getByRole("status").getByText("已完成").waitFor();
      await steps.nth(1).getByRole("status").getByText("已完成").waitFor();
    }
    await p.close();
  }
  const loading = await browser.newPage();
  await loading.goto("http://localhost:1437/start?fixture=desktop&guideLoading=1");
  await loading.getByRole("status").getByText("正在检查状态…").first().waitFor();
  assert.equal(await loading.getByRole("status").getByText("正在检查状态…").count(), 2);
  assert.equal(await loading.getByText("已完成", { exact: true }).count(), 0);
  await loading.close();
  console.log("PASS named directory actions, cancellation, theme/language chapter retention and guide statuses");
} finally { await browser.close(); }
