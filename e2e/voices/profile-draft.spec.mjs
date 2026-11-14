import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("profile-draft", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
page.setDefaultTimeout(15000);
try {
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&windowFixture=1");
  await page.getByRole("button", { name: "工程角色", exact: true }).click();
  const narrator = page.getByLabel("旁白 的声音画像");
  await narrator.fill("长".repeat(2001));
  await page.getByRole("button", { name: "保存画像" }).click();
  await page.getByText("声音画像最多 2000 个字符。").waitFor();
  assert.equal(await narrator.evaluate((element) => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.fixture.calls.some(call => call.command === "voice_binding_profile_set")), false);
  await narrator.fill("旁白草稿");
  assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);
  await page.getByRole("button", { name: /阿岚/ }).first().click();
  const character = page.getByLabel("阿岚 的声音画像");
  await character.fill("角色草稿");
  await page.getByRole("button", { name: /旁白/ }).first().click();
  assert.equal(await narrator.inputValue(), "旁白草稿");
  await page.evaluate(() => window.fixture.setProfile({ kind: "narrator" }, "后台画像"));
  await page.getByRole("link", { name: "工程首页" }).click();
  await page.goBack();
  await page.getByRole("button", { name: "工程角色", exact: true }).click();
  await page.getByText("已保存的画像发生变化，草稿仍保留；请先核对或采用当前画像。").waitFor();
  assert.equal(await page.getByLabel("旁白 的声音画像").inputValue(), "旁白草稿");
  assert.equal(await page.getByRole("button", { name: "保存画像" }).isDisabled(), true);
  await page.getByRole("button", { name: "采用当前画像" }).click();
  assert.equal(await page.getByLabel("旁白 的声音画像").inputValue(), "后台画像");
  await page.getByRole("button", { name: /阿岚/ }).first().click();
  assert.equal(await page.getByLabel("阿岚 的声音画像").inputValue(), "角色草稿");
  await page.getByRole("button", { name: "采用当前画像" }).click();
  assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), false);
  console.log("PASS target-scoped profile drafts and changed-host conflict");
} finally { await browser.close(); }
});
