import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("sample-hooks", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
try {
  await page.goto("http://localhost:1437/tests/sample-hooks-fixture.html");
  await page.getByLabel("analysis").getByText("sample-chapter-1").waitFor();
  await page.getByLabel("ai").getByText("ready").waitFor();
  assert.equal(await page.getByLabel("audio").innerText(), "false");
  assert.equal(await page.getByLabel("issues").innerText(), "0");
  for (const name of ["start audio", "cancel audio", "send", "refresh"]) await page.getByRole("button", { name }).click();
  assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
  console.log("PASS sample analysis reads and unsupported audio/AI calls avoid desktop IPC");
} finally { await browser.close(); }
});
