import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("chapter-cross-navigation", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30000);
await page.addInitScript(() => {
  window.testAudio = [];
  window.Audio = class extends EventTarget {
    paused = true; currentTime = 0; src = ""; preload = "";
    constructor() { super(); window.testAudio.push(this); }
    load() { this.paused = true; this.currentTime = 0; }
    play() { this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); }
    pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
    removeAttribute(name) { if (name === "src") this.src = ""; }
  };
});
const errors = []; page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&audio=1");
  await page.getByRole("button", { name: "分析本章", exact: true }).click();
  await page.locator("[data-segment-id]").first().waitFor();
  await page.getByRole("button", { name: "生成本章音频", exact: true }).click();
  const track = page.getByRole("region", { name: "章节音频轨道" });
  await track.waitFor();
  await page.evaluate(() => { window.__TAURI_INTERNALS__.convertFileSrc = id => `https://chapter-audio.localhost/${id}`; });
  await track.getByRole("button", { name: "从所选片段播放" }).click();
  const bar = page.getByRole("region", { name: "章节播放控制" });
  await bar.getByRole("button", { name: "暂停", exact: true }).waitFor();
  await page.setViewportSize({ width: 1024, height: 680 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok((await bar.boundingBox()).y + (await bar.boundingBox()).height <= 680);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "暂停此片段", exact: true }).click();
  await page.getByRole("button", { name: "继续播放此片段", exact: true }).click();
  await page.getByRole("button", { name: "暂停此片段", exact: true }).waitFor();
  await track.locator('[data-unit-index="1"]').click();
  assert.match(await bar.innerText(), /片段 1/);
  assert.match(await page.evaluate(() => window.testAudio[0].src), /unit-0/);
  await page.evaluate(() => { window.fixture.audio.run.currentIndex = 3; window.fixture.audio.run.revision++; });
  await page.waitForTimeout(2200);
  assert.match(await bar.innerText(), /片段 1/);
  assert.match(await bar.innerText(), /山海之间.*山雨/);
  assert.equal(await page.getByRole("slider", { name: "播放进度" }).count(), 1);
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "chapter_audio_status" && call.args.chapterId === "chapter-1"));
  assert.equal(await bar.isVisible(), true);
  assert.equal(await page.evaluate(() => window.testAudio[0].paused), false);
  await page.evaluate(() => { window.fixture.failAudioRead = true; });
  await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(() => window.testAudio[0].paused), false);
  await page.evaluate(() => { window.fixture.failAudioRead = false; });
  await page.getByRole("link", { name: "工程首页", exact: true }).click();
  assert.equal(await bar.isVisible(), true);
  await page.getByRole("navigation", { name: "应用导航" }).getByRole("link", { name: "音色中心", exact: true }).click();
  await page.getByRole("tab", { name: "我的音色" }).click();
  await page.getByRole("button", { name: "查看音色「山风」" }).click();
  await page.getByRole("button", { name: "播放原始录音" }).click();
  await page.waitForFunction(() => typeof window.fixture.releaseVoiceLease === "function");
  assert.equal(await page.evaluate(() => window.testAudio[0].paused), true);
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "继续播放", exact: true }).click();
  await page.evaluate(() => window.fixture.releaseVoiceLease());
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "voice_audio_lease" && !call.args.playing));
  assert.equal(await page.evaluate(() => window.testAudio[0].paused), false);
  const excerptsBefore = await page.evaluate(() => window.fixture.calls.filter(call => call.command === "chapter_analysis_excerpt").length);
  await bar.getByRole("button", { name: "返回播放位置" }).click();
  await page.waitForURL(/\/project\/fixture-project/);
  await page.locator('[data-segment-id]').first().waitFor();
  await page.waitForFunction(count => window.fixture.calls.filter(call => call.command === "chapter_analysis_excerpt").length > count, excerptsBefore);
  const located = await page.evaluate(() => ({ call: window.fixture.calls.filter(call => call.command === "chapter_analysis_excerpt").at(-1).args, range: window.fixture.audio.units[0].range }));
  assert.equal(located.call.chapterId, "chapter-0");
  assert.deepEqual(located.call.range, located.range);
  await page.locator('[data-source-row="0"]').first().waitFor({ state: "visible" });
  assert.equal(await bar.getByRole("button", { name: "暂停", exact: true }).isVisible(), true);
  await bar.getByRole("button", { name: "暂停", exact: true }).click();
  assert.equal(await page.evaluate(() => window.testAudio[0].paused), true);
  await bar.getByRole("button", { name: "继续播放", exact: true }).click();
  assert.equal(await page.evaluate(() => window.testAudio[0].paused), false);
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await page.evaluate(() => { window.fixture.audio.units[0].mediaId = null; });
  await bar.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.testAudio[0].src), "");
  await page.evaluate(() => { window.fixture.audio.units[0].mediaId = "unit-0"; });
  await page.getByRole("button", { name: "上一章", exact: true }).click();
  await track.getByRole("button", { name: "从所选片段播放" }).click();
  await bar.getByRole("button", { name: "暂停", exact: true }).waitFor();
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await page.evaluate(() => { window.fixture.audio.run.id = "replacement-run"; });
  await bar.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.testAudio[0].src), "");
  await page.evaluate(() => { window.fixture.audio.run.id = "audio-run"; });
  await page.getByRole("button", { name: "上一章", exact: true }).click();
  await track.getByRole("button", { name: "从所选片段播放" }).click();
  await bar.getByRole("button", { name: "暂停", exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭工程标签：山海之间" }).click();
  await bar.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.testAudio[0].src), "");
  await page.setViewportSize({ width: 1024, height: 680 });
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&audio=1&locale=en&theme=dark");
  await page.getByRole("button", { name: "Analyze chapter", exact: true }).click();
  await page.getByRole("button", { name: "Generate chapter audio", exact: true }).click();
  await page.getByRole("button", { name: "Play from selected segment" }).waitFor();
  await page.evaluate(() => { window.__TAURI_INTERNALS__.convertFileSrc = id => `https://chapter-audio.localhost/${id}`; });
  await page.getByRole("button", { name: "Play from selected segment" }).click();
  const englishBar = page.getByRole("region", { name: "Chapter playback controls" });
  await englishBar.getByRole("button", { name: "Pause", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok((await englishBar.boundingBox()).y + (await englishBar.boundingBox()).height <= 680);
  assert.deepEqual(errors, []);
  console.log("PASS cross-chapter and cross-route playback, return, read failure and project close");
} catch (error) {
  console.error("STATE", await page.locator("body").innerText(), await page.evaluate(() => ({ errors: window.fixture?.unexpected, calls: window.fixture?.calls.slice(-12), audio: window.testAudio?.map(item => ({ src: item.src, paused: item.paused })) })));
  throw error;
} finally { await browser.close(); }
});
