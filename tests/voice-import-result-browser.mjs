import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const page = await browser.newPage();
try {
  await page.goto("http://localhost:1437/voices?fixture=desktop&library=mine&inspectors=1");
  await page.getByRole("button", { name: "查看每个音色的结果" }).click();
  const dialog = page.getByRole("dialog", { name: "查看每个音色的结果" });
  assert.equal(await dialog.getByText("来源文件：公开样本.voice", { exact: true }).count(), 1);
  console.log("PASS import result identifies its source package");
} finally { await browser.close(); }
