import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("settings-guide", async ({ flowBrowser: browser }) => {
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

  // 首启引导：没有工程时出现，跳过后不再出现，完成标记由宿主持有。
  const firstRun = await browser.newPage();
  await firstRun.goto("http://localhost:1437/?fixture=desktop&empty=1");
  const guide = firstRun.getByRole("region", { name: "首次使用引导" });
  await guide.waitFor();
  assert.equal(await firstRun.getByText("还没有工程", { exact: true }).count(), 0);
  await guide.getByRole("button", { name: "跳过", exact: true }).click();
  await guide.waitFor({ state: "hidden" });
  assert.equal(await firstRun.evaluate(() => window.fixture.calls.some((call) => call.command === "app_state_complete_onboarding")), true);
  await firstRun.reload();
  assert.equal(await firstRun.getByRole("region", { name: "首次使用引导" }).count(), 0);
  await firstRun.close();
  // 只有未完成导入的草案时，引导指向继续导入而不是新建工程。
  const draft = await browser.newPage();
  await draft.goto("http://localhost:1437/?fixture=desktop&unfinishedProject=1");
  const draftGuide = draft.getByRole("region", { name: "首次使用引导" });
  await draftGuide.waitFor();
  await draftGuide.getByRole("link", { name: "继续导入", exact: true }).waitFor();
  assert.equal(await draftGuide.getByRole("link", { name: "新建工程", exact: true }).count(), 0);
  await draft.close();
  // 使用指南常驻设置内，与首启状态无关。
  const usage = await browser.newPage();
  await usage.goto("http://localhost:1437/?fixture=desktop&settings=guide");
  const usageDialog = usage.getByRole("dialog", { name: "设置" });
  await usageDialog.waitFor();
  await usageDialog.getByRole("link", { name: "新建工程", exact: true }).waitFor();
  await usageDialog.getByRole("link", { name: "模型中心", exact: true }).waitFor();
  await usageDialog.getByRole("link", { name: "音色中心", exact: true }).waitFor();
  await usage.close();
  console.log("PASS named directory actions, cancellation, theme/language chapter retention, first-run guide and usage guide");
} finally { await browser.close(); }
});
