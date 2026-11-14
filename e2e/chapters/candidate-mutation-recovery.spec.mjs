import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("candidate-mutation-recovery", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
page.setDefaultTimeout(15000);
try {
  await page.goto("http://localhost:1437/voices/new?fixture=desktop&voiceAudition=1&designCandidate=1&windowFixture=1");
  const create = async (name) => {
    await page.getByLabel("音色名称").fill(name);
    await page.getByLabel("声音描述").fill("公开描述");
    await page.getByRole("button", { name: "生成音色候选" }).click();
    const card = page.getByRole("article", { name });
    await card.waitFor();
    return card;
  };
  let card = await create("保存候选");
  await page.evaluate(() => { window.fixture.loseCandidateSave = true; });
  await card.getByRole("button", { name: "保存到音色库" }).click();
  await page.getByRole("button", { name: "读取候选「保存候选 · design-1」状态" }).waitFor();
  await page.locator('[data-slot="page-heading"]').getByRole("link", { name: "音色中心" }).click();
  await page.getByRole("button", { name: "读取候选「保存候选 · design-1」状态" }).click();
  await page.getByText("当前候选已在音色库中，请核对后继续。").waitFor();
  await page.getByRole("button", { name: "重试候选「保存候选 · design-1」的原操作" }).click();
  await page.getByText("保存候选：保存候选 · design-1").waitFor({ state: "hidden" });
  const saves = await page.evaluate(() => window.fixture.calls.filter(call => call.command === "save_voice_candidate"));
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[0].args, saves[1].args);
  await page.getByRole("link", { name: "创建音色", exact: true }).click();
  card = await create("移除候选");
  await page.evaluate(() => { window.fixture.loseCandidateRemove = true; });
  await card.getByRole("button", { name: "移除候选" }).click();
  await page.getByRole("button", { name: "确认移除" }).click();
  await page.getByRole("button", { name: "读取候选「移除候选 · design-2」状态" }).click();
  await page.getByText("当前列表中没有此候选；原操作结果可能无法确认。").waitFor();
  assert.equal(await page.getByRole("button", { name: "重试候选「移除候选 · design-2」的原操作" }).count(), 0);
  await page.getByRole("button", { name: "停止恢复候选「移除候选 · design-2」" }).click();
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "discard_voice_candidate").length), 1);
  card = await create("只读候选");
  await page.evaluate(() => { window.fixture.failReadAfterCandidate = true; });
  await card.getByRole("button", { name: "保存到音色库" }).click();
  await page.getByText("操作已确认，读取候选状态失败。").waitFor();
  await page.evaluate(() => { window.fixture.failReadAfterCandidate = false; window.fixture.failStudioRead = false; });
  await page.getByRole("button", { name: "重新读取候选「只读候选 · design-3」" }).click();
  await page.getByText("保存候选：只读候选 · design-3").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "save_voice_candidate" && call.args.id === "design-3").length), 1);
  console.log("PASS candidate save and removal recovery across routes");
} finally { await browser.close(); }
});
