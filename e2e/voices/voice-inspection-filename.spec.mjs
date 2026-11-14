import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("voice-inspection-filename", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
try {
  await page.goto("http://localhost:1437/voices?fixture=desktop&voiceInspect=1&library=mine");
  await page.getByRole("button", { name: "导入音色包", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "导入音色包" });
  await dialog.getByRole("button", { name: "选择音色包" }).click();
  await dialog.getByRole("alert").filter({ hasText: "坏.voice" }).waitFor();
  await dialog.getByRole("checkbox", { name: "坏.voice", exact: true }).uncheck();
  await dialog.getByRole("button", { name: "重新检查所选文件" }).click();
  await dialog.getByRole("alert").filter({ hasText: "另一坏.voice" }).waitFor();
  const calls = await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "inspect_voice_packages").map((call) => call.args.indices));
  assert.deepEqual(calls, [[0, 1, 2], [0, 2]]);
  console.log("PASS inspection error filename follows submitted file order after exclusion");
} finally { await browser.close(); }
});
