import { inspectSegment, chapterTask } from "../chapter-task.mjs";
import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("chapter-voice-picker", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
page.setDefaultTimeout(10000);
async function selectCharacter(analysisLabel = "分析本章角色", speakerLabel = "说话人", saveLabel = "已保存") {
  await (await chapterTask(page, analysisLabel)).click();
  await inspectSegment(page, page.locator("[data-segment-id]").nth(1));
  await page.getByLabel(speakerLabel, { exact: true }).selectOption("character-a");
  await page.getByRole("status").filter({ hasText: new RegExp(`^${saveLabel}$`) }).waitFor();
}
try {
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&manyPresetVoices=1&voiceAudition=1&queuedAuditions=1");
  const panel = page.getByRole("region", { name: "本章声音设置" });
  const inspector = page.getByRole("complementary", { name: "AI 助手与检查器" });
  const hint = inspector.getByText("选择正文片段", { exact: true });
  await hint.waitFor();
  assert.equal(await inspector.locator('[data-slot="separator"]:visible').count(), 0);
  assert.equal(await panel.count(), 0);
  await (await chapterTask(page, "分析本章角色")).click();
  const rows = page.locator("[data-segment-id]");
  await rows.first().waitFor();
  await page.getByRole("button", { name: "片段属性", exact: true }).click();
  await hint.waitFor();
  assert.equal(await panel.count(), 0);
  await inspectSegment(page, rows.first());
  await inspector.getByRole("heading", { name: "角色归属", exact: true }).waitFor();
  await panel.getByText("旁白", { exact: true }).waitFor();
  assert.equal(await hint.count(), 0);
  assert.equal(await inspector.locator('[data-slot="separator"]:visible').count(), 1);
  assert.equal(await panel.getByRole("combobox", { name: "选择音色", exact: true }).count(), 0);
  await inspectSegment(page, rows.nth(1));
  await page.getByLabel("说话人", { exact: true }).selectOption("character-a");
  await page.getByRole("status").filter({ hasText: /^已保存$/ }).waitFor();
  const chooseVoice = panel.getByRole("combobox", { name: "选择音色", exact: true });
  await chooseVoice.waitFor();
  assert.equal(await chooseVoice.getAttribute("aria-expanded"), "false");
  const options = page.getByRole("option").and(page.locator('[data-slot="combobox-item"]'));
  assert.equal(await options.count(), 0);
  await chooseVoice.press("Enter");
  await options.first().waitFor();
  const popup = page.locator('[data-slot="combobox-content"]:visible');
  const popupWidth = await popup.evaluate((element) => element.offsetWidth);
  assert.ok(popupWidth >= 320);
  assert.ok(popupWidth > (await chooseVoice.boundingBox()).width);
  assert.equal(await options.count(), 150);
  assert.equal(await page.locator('[data-slot="combobox-label"] [data-slot="model-logo"]').count(), 1);
  assert.equal(await panel.getByRole("button", { name: /绑定给/ }).count(), 0);
  const search = page.getByRole("combobox", { name: "搜索音色" });
  assert.equal(await search.evaluate((element) => element === document.activeElement), true);
  await search.fill("voice-149");
  assert.equal(await options.count(), 1);
  await search.press("ArrowDown");
  await search.press("Enter");
  await search.waitFor({ state: "hidden" });
  const bind = panel.getByRole("button", { name: /将「公开音色 149 .*绑定给「阿岚」.*很长的模型名称/ });
  const preview = panel.getByRole("button", { name: /试听音色「公开音色 149 / });
  await bind.waitFor();
  await page.screenshot({ path: "src-tauri/target/workbench-acceptance/voice-picker-narrow.png" });
  assert.equal(await preview.isEnabled(), true);
  assert.equal(await page.evaluate(() => window.fixture.calls.some((c) => /voice_binding_edit|start_voice_job/.test(c.command))), false);
  await preview.click();
  await page.waitForFunction(() => window.fixture.calls.some((c) => c.command === "start_voice_job"));
  const audition = await page.evaluate(() => window.fixture.calls.find((c) => c.command === "start_voice_job").args.request);
  assert.equal(audition.kind, "audition");
  assert.equal(audition.voice.voice, "voice-149");
  assert.match(audition.text, /^阿岚说/);
  assert.equal(await page.evaluate(() => window.fixture.calls.some((c) => c.command === "voice_binding_edit")), false);
  const cards = panel.locator("[data-slot=chapter-audition]");
  const firstAudition = panel.getByRole("group", { name: /公开音色 149 / });
  await firstAudition.getByRole("status").filter({ hasText: "生成音频中" }).waitFor();
  await chooseVoice.click();
  await search.fill("voice-148");
  await options.first().click();
  await search.waitFor({ state: "hidden" });
  await panel.getByRole("button", { name: /试听音色「公开音色 148」/ }).click();
  const secondAudition = panel.getByRole("group", { name: "公开音色 148" });
  await secondAudition.getByRole("status").filter({ hasText: "排队中" }).waitFor();
  assert.equal(await cards.count(), 2);
  assert.equal(await secondAudition.getByRole("button", { name: "绑定", exact: true }).count(), 0);
  await page.evaluate(() => window.fixture.finishAudition(1));
  await firstAudition.getByRole("button", { name: "播放结果" }).waitFor();
  await panel.screenshot({ path: "src-tauri/target/workbench-acceptance/chapter-auditions.png" });
  await firstAudition.getByRole("button", { name: "绑定", exact: true }).click();
  await page.waitForFunction(() => window.fixture.calls.some((c) => c.command === "voice_binding_edit"));
  const call = await page.evaluate(() => window.fixture.calls.find((c) => c.command === "voice_binding_edit"));
  assert.deepEqual(call.args.target, { kind: "character", character_id: "character-a" });
  assert.equal(call.args.edit.voice.voice, "voice-149");
  assert.equal(await cards.count(), 2);
  await firstAudition.getByRole("button", { name: "关闭结果" }).click();
  await firstAudition.waitFor({ state: "hidden" });
  await secondAudition.waitFor();
  await panel.getByRole("button", { name: "更换音色", exact: true }).click();
  await search.fill("no-such-voice");
  await popup.locator('[data-app-state="search"]').getByText("没有匹配的音色。", { exact: true }).waitFor();
  await search.fill("");
  assert.equal(await options.count(), 150);
  await search.press("Escape");
  await search.waitFor({ state: "hidden" });
  assert.equal(await chooseVoice.evaluate((element) => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&duplicateCharacters=1&duplicateVoiceNames=1&voiceAudition=1");
  await (await chapterTask(page, "分析本章角色")).click();
  await inspectSegment(page, page.locator("[data-segment-id]").nth(1));
  const speaker = page.getByLabel("说话人", { exact: true });
  await speaker.selectOption("unknown");
  await panel.getByText("确定说话人后可设置声音。", { exact: true }).waitFor();
  assert.equal(await chooseVoice.count(), 0);
  await speaker.selectOption("character-b");
  await panel.getByText("阿岚 (character-b)", { exact: true }).waitFor();
  await chooseVoice.click();
  const sameName = page.getByRole("option", { name: "选择音色「同名声音」，来源：Kokoro，ID：two" });
  await sameName.click();
  await page.getByRole("button", { name: "将「同名声音」绑定给「阿岚 (character-b)」，来源：Kokoro，ID：two" }).click();
  await page.waitForFunction(() => window.fixture.calls.some((c) => c.command === "voice_binding_edit"));
  const duplicateCall = await page.evaluate(() => window.fixture.calls.find((c) => c.command === "voice_binding_edit"));
  assert.equal(duplicateCall.args.target.character_id, "character-b");
  assert.equal(duplicateCall.args.edit.voice.voice, "two");
  await panel.getByRole("button", { name: "生成试听", exact: true }).click();
  await panel.getByRole("group", { name: "同名声音" }).getByRole("button", { name: "播放结果" }).waitFor();
  const boundAudition = await page.evaluate(() => window.fixture.calls.find((c) => c.command === "start_voice_job").args.request);
  assert.equal(boundAudition.voice.voice, "two");
  assert.match(boundAudition.text, /^阿岚说/);
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1");
  await page.evaluate(() => {
    window.fixture.castSuggestion = {
      runId: "fixture-cast", createdAt: "", charactersStale: false, catalogStale: false,
      targets: [{
        target: { kind: "narrator" }, profile: "", design: null,
        voiceCandidates: [{ voice: { kind: "library", id: "fixture-voice" }, label: "山风", reason: "声音稳定", validity: "valid" }],
      }],
      rejected: [], previews: [],
    };
  });
  await page.getByRole("button", { name: "工程角色", exact: true }).click();
  const rolePicker = page.locator('[data-slot="character-detail"]').getByRole("combobox", { name: "选择音色", exact: true });
  await rolePicker.click();
  await options.and(page.getByRole("option", { name: "选择音色「山风」，来源：本地音色库，ID：fixture-voice" })).click();
  assert.equal(await rolePicker.getAttribute("aria-expanded"), "false");
  assert.equal(await rolePicker.innerText(), "山风");
  assert.equal(await page.evaluate(() => window.fixture.calls.some((c) => /voice_binding_edit|voice_reference_audio|start_voice_job/.test(c.command))), false);
  await page.getByRole("button", { name: "将「山风」绑定给「旁白」，来源：本地音色库，ID：fixture-voice" }).click();
  await page.waitForFunction(() => window.fixture.calls.some((c) => c.command === "voice_binding_edit"));
  const libraryBind = await page.evaluate(() => window.fixture.calls.find((c) => c.command === "voice_binding_edit").args);
  assert.equal(libraryBind.target.kind, "narrator");
  assert.deepEqual(libraryBind.edit.voice, { kind: "library", id: "fixture-voice" });
  const suggestions = page.getByRole("heading", { name: /选角建议.*与当前绑定一致/ })
    .getByRole("button");
  await suggestions.waitFor();
  assert.equal(await suggestions.getAttribute("aria-expanded"), "false");
  await suggestions.press("Enter");
  await page.getByText("声音稳定", { exact: true }).waitFor();
  assert.equal(await suggestions.getAttribute("aria-expanded"), "true");
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&modelListFailure=1");
  await selectCharacter();
  const failedPanel = page.getByRole("region", { name: "本章声音设置" });
  await failedPanel.getByRole("alert").filter({ hasText: "模型目录读取失败" }).waitFor();
  assert.equal(await failedPanel.getByText("没有可选择的音色", { exact: false }).count(), 0);
  await page.evaluate(() => { window.fixture.failModelRead = false; });
  await failedPanel.getByRole("button", { name: "重试读取模型" }).click();
  await chooseVoice.click();
  await page.getByRole("option", { name: /选择音色「Heart」/ }).waitFor();
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&locale=en&theme=dark");
  await selectCharacter("Analyze chapter characters", "Speaker", "Saved");
  const englishPanel = page.getByRole("region", { name: "Chapter voices" });
  await englishPanel.getByRole("combobox", { name: "Choose voice", exact: true }).click();
  await page.getByRole("option", { name: "Select voice “Heart”, source: Kokoro, ID: af_heart" }).click();
  await englishPanel.getByRole("button", { name: "Bind “Heart” to “阿岚”, source: Kokoro, ID: af_heart" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log("PASS large searchable voice picker, keyboard selection, explicit target binding and no implicit audition");
} catch (error) { console.error((await page.locator("body").innerText()).slice(0, 3000)); console.error(await page.evaluate(() => window.fixture?.unexpected)); throw error; } finally { await browser.close(); }
});

test("catalog audition results belong to the selected voice and role", async ({ flowBrowser }, testInfo) => {
  const page = await flowBrowser.newPage({ viewport: { width: 1360, height: 820 } });
  page.setDefaultTimeout(12000);
  try {
    await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&duplicateVoiceNames=1&voiceAudition=1");
    await page.getByRole("button", { name: "工程角色", exact: true }).click();
    const directory = page.locator('[data-slot="character-directory"]');
    const detail = page.locator('[data-slot="character-detail"]');
    const rows = directory.locator('[data-character-directory-row]');
    const results = detail.locator('[data-slot="voice-operation-results"]');
    async function chooseVoice(id) {
      await detail.getByRole("combobox", { name: "选择音色", exact: true }).click();
      await page.getByRole("option", { name: `选择音色「同名声音」，来源：Kokoro，ID：${id}`, exact: true }).click();
    }
    await rows.nth(1).click();
    await chooseVoice("one");
    await detail.getByRole("button", { name: "试听音色「同名声音」，来源：Kokoro，ID：one" }).click();
    await results.getByRole("button", { name: "播放结果" }).waitFor();
    assert.equal(await directory.locator('[data-slot="voice-operation-results"]').count(), 0);
    await page.screenshot({ path: testInfo.outputPath("character-audition-inline.png"), animations: "disabled" });
    await chooseVoice("two");
    await results.waitFor({ state: "hidden" });
    await chooseVoice("one");
    await results.getByRole("button", { name: "播放结果" }).waitFor();
    await rows.first().click();
    await chooseVoice("one");
    await results.waitFor({ state: "hidden" });
    await rows.nth(1).click();
    await results.getByRole("button", { name: "播放结果" }).waitFor();
  } finally {
    await page.close();
  }
});
