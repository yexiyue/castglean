import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("import-drop", async ({ flowBrowser: browser }) => {
const errors = [];
const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
page.setDefaultTimeout(10000);
page.on("pageerror", (error) => errors.push(error.message));
const calls = (command) => page.evaluate((command) => window.fixture.calls.filter((call) => call.command === command).length, command);
try {
  await page.goto("http://localhost:1437/new?empty=1&fixture=desktop");
  const importer = page.getByRole("region", { name: "导入小说" });
  const mode = importer.getByRole("combobox", { name: "TXT 导入方式", exact: true });
  const pick = importer.getByRole("button", { name: "选择 TXT 文件", exact: true });
  await mode.waitFor();
  await pick.waitFor();
  assert.equal(await mode.inputValue(), "book");
  assert.equal(await mode.getByRole("option", { name: "每个文件作为一章" }).count(), 1);
  assert.equal((await mode.boundingBox()).y, (await pick.boundingBox()).y);
  await importer.getByText("自动检测编码，导入前逐文件确认。", { exact: true }).waitFor();

  // 拖入 → 全窗口提示；离开 → 提示消失。
  await page.evaluate(() => window.fixture.fireDragEvent("enter", ["/tmp/公开样本.txt"]));
  await page.getByText("松开以导入 TXT", { exact: true }).waitFor();
  await page.evaluate(() => window.fixture.fireDragEvent("over", []));
  await page.getByText("松开以导入 TXT", { exact: true }).waitFor();
  await page.evaluate(() => window.fixture.fireDragEvent("leave", []));
  assert.equal(await page.getByText("松开以导入 TXT", { exact: true }).count(), 0);
  assert.equal(await calls("local_source_accept"), 0);

  // 松开 TXT → 与按钮选择同链路：待确认文件 + 工程名自动填充。
  await page.evaluate(() => window.fixture.fireDragEvent("enter", ["/tmp/公开样本.txt"]));
  await page.evaluate(() => window.fixture.fireDragEvent("drop", ["/tmp/公开样本.txt"]));
  await page.getByText("公开样本.txt", { exact: true }).waitFor();
  await page.getByRole("button", { name: "导入并开始制作", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "工程名称", exact: true }).inputValue(), "公开样本");
  assert.equal(await page.getByText("松开以导入 TXT", { exact: true }).count(), 0);
  assert.equal(await calls("local_source_accept"), 1);

  // 非 TXT → 明确错误，不产生新的待确认条目。
  await page.evaluate(() => window.fixture.fireDragEvent("drop", ["/tmp/小册子.pdf"]));
  await page.getByText("仅支持 TXT 文件，请检查拖入或选择的文件。", { exact: true }).waitFor();
  assert.equal(await page.getByText("公开样本.txt", { exact: true }).count(), 1);
  assert.equal(await calls("local_source_accept"), 2);
  assert.deepEqual(errors, []);
  console.log("PASS drag-drop import overlay, acceptance path and format rejection");
} finally {
  await browser.close();
}
});
