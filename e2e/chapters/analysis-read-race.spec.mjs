import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("analysis-read-race", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
try {
  await page.goto("http://localhost:1437/tests/analysis-read-race-fixture.html");
  await page.waitForFunction(() => typeof window.fixture.release === "function");
  await page.evaluate(() => { window.fixture.fail = true; });
  await page.getByRole("button", { name: "reload" }).click();
  await page.getByLabel("failure").getByText("true").waitFor();
  await page.evaluate(() => window.fixture.release());
  await page.waitForTimeout(100);
  assert.equal(await page.getByLabel("failure").innerText(), "true");
  await page.evaluate(() => { window.fixture.fail = false; });
  await page.getByRole("button", { name: "reload" }).click();
  await page.getByLabel("failure").getByText("false").waitFor();
  console.log("PASS late segment read cannot clear a failed analysis snapshot");
} finally { await browser.close(); }
});
