import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(15000);
try {
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&duplicateCharacters=1");
  await page.getByRole("button", { name: "工程角色", exact: true }).click();
  await page.getByRole("button", { name: /阿岚/ }).first().click();
  await page.getByRole("tab", { name: "身份" }).click();
  await page.getByLabel("复用已有角色").selectOption("character-b");
  await page.getByRole("button", { name: /旁白/ }).first().click();
  await page.getByRole("button", { name: /阿岚/ }).first().click();
  await page.getByRole("tab", { name: "身份" }).click();
  assert.equal(await page.getByLabel("复用已有角色").inputValue(), "character-b");
  await page.evaluate(() => { window.fixture.loseCharacterReply = true; });
  await page.getByRole("button", { name: "在本章复用" }).click();
  await page.getByRole("button", { name: "重试原身份操作" }).click();
  await page.getByRole("button", { name: "重试原身份操作" }).waitFor({ state: "hidden" });
  const calls = await page.evaluate(() => window.fixture.calls.filter(call => call.command === "chapter_analysis_character_edit"));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, calls[1].args);
  assert.equal(calls[0].args.edit.existing_id, "character-b");
  assert.equal(calls[0].args.characterId, "character-a");
  assert.equal(await page.evaluate(() => window.fixture.characterWrites), 1);
  console.log("PASS reuse selection and original identity recovery");
} finally { await browser.close(); }
