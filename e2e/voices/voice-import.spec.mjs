import assert from "node:assert/strict";
import { test } from "@playwright/test";

test("import result identifies source package", async ({ page }) => {
  await page.goto("/voices?fixture=desktop&library=mine&inspectors=1");
  await page.getByRole("button", { name: "查看每个音色的结果" }).click();
  const dialog = page.getByRole("dialog", { name: "查看每个音色的结果" });
  assert.equal(await dialog.getByText("来源文件：公开样本.voice", { exact: true }).count(), 1);
});

test("import recovery keeps request identity and drafts", async ({ page }) => {
  await page.goto("/voices?fixture=desktop&voiceImportForm=1&loseVoiceImport=1&library=mine");
  const open = () => page.getByRole("button", { name: "导入音色包", exact: true }).first().click();
  await open();
  let dialog = page.getByRole("dialog", { name: "导入音色包" });
  await dialog.getByRole("button", { name: "选择音色包" }).click();
  await dialog.getByRole("combobox", { name: "处理方式：山风" }).selectOption("ImportAsNew");
  await dialog.getByRole("textbox", { name: "声音描述：山风" }).fill("公开描述");
  await dialog.getByRole("button", { name: "导入所选音色" }).click();
  await dialog.getByRole("button", { name: "重试原导入请求" }).waitFor();
  await page.evaluate(() => { history.pushState({}, "", "/"); dispatchEvent(new PopStateEvent("popstate")); });
  await dialog.waitFor({ state: "hidden" });
  await page.goBack();
  await open();
  dialog = page.getByRole("dialog", { name: "导入音色包" });
  await dialog.getByRole("button", { name: "重试原导入请求" }).click();
  await dialog.waitFor({ state: "hidden" });
  const calls = await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "import_voice_entries").map((call) => call.args));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  await page.goto("/voices?fixture=desktop&voiceImportForm=1&rejectVoiceImport=1&library=mine");
  await open();
  dialog = page.getByRole("dialog", { name: "导入音色包" });
  await dialog.getByRole("button", { name: "选择音色包" }).click();
  await dialog.getByRole("combobox", { name: "处理方式：山风" }).selectOption("ImportAsNew");
  await dialog.getByRole("textbox", { name: "声音描述：山风" }).fill("第一次描述");
  await dialog.getByRole("button", { name: "导入所选音色" }).click();
  await dialog.getByRole("button", { name: "停止恢复原请求" }).click();
  assert.equal(await dialog.getByRole("textbox", { name: "声音描述：山风" }).inputValue(), "第一次描述");
  await dialog.getByRole("textbox", { name: "声音描述：山风" }).fill("修改后描述");
  await dialog.getByRole("button", { name: "导入所选音色" }).click();
  await dialog.waitFor({ state: "hidden" });
  const rejectedCalls = await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "import_voice_entries").map((call) => call.args));
  assert.equal(rejectedCalls[1].decisions[0].description, "修改后描述");
});
