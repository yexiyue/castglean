import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("design-resource-selection", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
page.setDefaultTimeout(20000);
try {
  await page.goto("http://localhost:1437/voices/new?fixture=desktop&designAvailability=1");
  await page.getByLabel("设计引擎").selectOption("other-design");
  await page.getByLabel("音色名称").fill("公开测试");
  await page.getByLabel("声音描述").fill("清晰的声音");
  await page.getByRole("button", { name: "高级选项" }).click();
  await page.getByLabel("计算设备").selectOption("Metal");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "生成音色候选" }).isEnabled(), true);
  const returnToCreation = async () => {
    await page.locator('[data-slot="page-heading"]').getByRole("link", { name: "音色中心" }).click();
    await page.getByRole("link", { name: "创建音色", exact: true }).click();
  };
  await page.evaluate(() => window.fixture.setDesignDeviceAvailable(false));
  await returnToCreation();
  await page.getByText("已选设备不可用，请在高级选项中重新选择或等待其恢复。").waitFor();
  assert.equal(await page.getByRole("button", { name: "生成音色候选" }).isDisabled(), true);
  await page.evaluate(() => window.fixture.setDesignDeviceAvailable(true));
  await returnToCreation();
  assert.equal(await page.getByRole("button", { name: "生成音色候选" }).isEnabled(), true);
  await page.evaluate(() => window.fixture.setDesignAvailable(false));
  await returnToCreation();
  await page.getByText("已选引擎不可用，请重新选择或等待其恢复。").waitFor();
  assert.equal(await page.getByRole("button", { name: "生成音色候选" }).isDisabled(), true);
  await page.evaluate(() => window.fixture.setDesignAvailable(true));
  await returnToCreation();
  assert.equal(await page.getByLabel("设计引擎").inputValue(), "other-design");
  assert.equal(await page.getByRole("button", { name: "生成音色候选" }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "start_voice_job").length), 0);
  console.log("PASS design engine and device selection survives availability changes without implicit generation");
} finally { await browser.close(); }
});
