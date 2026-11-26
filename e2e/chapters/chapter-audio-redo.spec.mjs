import { expect, test } from "@playwright/test";

import { expandChapterTrack } from "../chapter-task.mjs";

const workspace = "/project/fixture-project?fixture=desktop&analysis=1&audio=1";

async function stubAudio(page) {
  await page.addInitScript(() => {
    window.testAudio = [];
    window.Audio = class extends EventTarget {
      paused = true; currentTime = 0; src = "";
      constructor() { super(); window.testAudio.push(this); }
      load() { this.paused = true; this.currentTime = 0; }
      play() { this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); }
      pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
      removeAttribute() {}
    };
  });
}

async function startNarration(page) {
  const bar = page.getByRole("region", { name: "章节播放控制", exact: true });
  await bar.getByRole("button", { name: "制作本章音频", exact: true }).click();
  await page.getByRole("radio", { name: "单音色旁白" }).check();
  await page.getByRole("combobox", { name: "选择音色", exact: true }).click();
  await page.getByRole("option", { name: /Heart/ }).click();
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "生成旁白音频" }).click();
  return bar;
}

/** 把最近建立的任务标记为全部单元成功，相当于引擎完成了这次合成。 */
async function finish(page) {
  await page.evaluate(() => {
    const { run, units } = window.fixture.audio;
    for (const unit of units) {
      if (unit.status !== "done") Object.assign(unit, { status: "done", mediaId: `unit-${unit.index}`, durationMs: 1000 });
    }
    Object.assign(run, { status: "succeeded", completedUnits: units.length, finalDurationMs: 4000, currentIndex: null, revision: run.revision + 1 });
  });
}

const lastStart = (page) => page.evaluate(() =>
  window.fixture.calls.filter((call) => call.command === "chapter_audio_start").at(-1)?.args.request);
const decisions = (page) => page.evaluate(() =>
  window.fixture.calls.filter((call) => ["chapter_audio_adopt", "chapter_audio_reject"].includes(call.command))
    .map(({ command, args }) => [command, args.runId]));

test("a changed plan offers a partial redo that keeps the unchanged units", async ({ page }) => {
  await stubAudio(page);
  await page.goto(workspace);
  const bar = await startNarration(page);
  await finish(page);
  await expect(bar.getByRole("button", { name: "导出 WAV", exact: true })).toBeEnabled();
  await expandChapterTrack(page);
  await page.getByRole("button", { name: "片段 1 后的停顿", exact: true }).click();
  await page.getByRole("button", { name: "添加停顿", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.audio.arrangement.revision)).toBe(1);

  await page.evaluate(() => {
    window.fixture.audio.arrangement.stale = true;
    window.fixture.redo = { inheritable: 3, units: [2] };
  });
  const redo = bar.getByRole("button", { name: "重做 1 段", exact: true });
  await expect(redo).toBeEnabled();
  await expect(page.getByText("旧版本的停顿已只读。重做后可继续调整。", { exact: true })).toBeVisible();
  await expect(page.getByText("正在保存…", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "chapter_audio_check").at(-1).args.inheritFrom)).toBe("narrator-run");
  await redo.click();
  await expect.poll(() => lastStart(page)).toEqual({ kind: "fresh", inherit_from: "narrator-run" });
  await expect(bar.getByText("重做中 0/1", { exact: true })).toBeVisible();
  const progress = bar.getByRole("progressbar", { name: "生成进度" });
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  await expect(progress).toHaveAttribute("aria-valuetext", "重做中 0/1");
  expect(await page.evaluate(() => {
    const { run, units } = window.fixture.audio;
    return {
      id: run.id, kind: run.kind, parent: run.parentRunId, inherited: run.inheritedUnits, redone: run.redoIndexes,
      kept: units.filter((unit) => unit.mediaId).map((unit) => unit.index),
    };
  })).toEqual({ id: "redo-1", kind: "redo", parent: "narrator-run", inherited: 3, redone: [2], kept: [0, 1, 3] });
  await expect(bar.getByRole("button", { name: "导出 WAV", exact: true })).toBeDisabled();

  // 重做失败：失败位置可定位，重试沿用同一任务；当前版本保持可播、不会被采用提示打断。
  await page.evaluate(() => {
    const { run, units } = window.fixture.audio;
    Object.assign(run, { status: "failed", currentIndex: null, failedIndex: 2, error: "unit_synthesis_failed", revision: run.revision + 1 });
    units[2].status = "failed";
  });
  const retry = bar.getByRole("button", { name: "重试", exact: true });
  await expect(retry).toBeEnabled();
  await expect(page.locator('[data-slot="chapter-audio-pending"]')).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "播放旧版本", exact: true })).toBeEnabled();
  await bar.getByRole("button", { name: "第 3 段失败", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.calls.some((call) =>
    call.command === "chapter_analysis_excerpt" &&
    call.args.range.start === window.fixture.audio.units[2].range.start))).toBe(true);
  await retry.click();
  await expect.poll(() => lastStart(page)).toEqual({ kind: "resume", run_id: "redo-1" });
  await expect(bar.getByText("重做中 0/1", { exact: true })).toBeVisible();
  await finish(page);
  await expect(bar.getByRole("button", { name: "播放整章", exact: true })).toBeEnabled();
  await expect(bar.getByRole("button", { name: "导出 WAV", exact: true })).toBeEnabled();
  await expect(bar.getByRole("button", { name: /重做 \d+ 段/ })).toHaveCount(0);
  expect(await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "agent_start"))).toEqual([]);
});

test("nothing to inherit is reported as a full new version", async ({ page }) => {
  await stubAudio(page);
  await page.goto(workspace);
  const bar = await startNarration(page);
  await finish(page);
  await page.evaluate(() => { window.fixture.audio.arrangement.stale = true; });
  const fresh = bar.getByRole("button", { name: "生成新版本", exact: true });
  await expect(fresh).toBeEnabled();
  await fresh.click();
  await expect.poll(() => lastStart(page)).toEqual({ kind: "fresh", inherit_from: "narrator-run" });
  await expect(bar.getByText("生成中 2/4", { exact: true })).toBeVisible();
});

test("retakes wait for an explicit decision and are adopted or discarded in place", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubAudio(page);
  await page.goto(workspace);
  const bar = await startNarration(page);
  await finish(page);
  await expandChapterTrack(page);
  const track = page.getByRole("region", { name: "章节音频轨道" });
  const properties = page.getByRole("button", { name: "片段属性", exact: true });
  if ((await properties.count()) > 0 && (await properties.getAttribute("aria-expanded")) !== "true") await properties.click();

  await track.locator("[data-unit-index]").nth(2).click();
  const retake = page.getByRole("button", { name: "重录此段", exact: true });
  await expect(retake).toBeEnabled();
  await retake.click();
  await expect.poll(() => lastStart(page)).toEqual({ kind: "retake", run_id: "narrator-run", units: [2] });
  await expect(bar.getByText("重做中 0/1", { exact: true })).toBeVisible();
  await finish(page);

  // 重录完成后就地等待决定：当前版本保持可播、可导出，新版本不可导出。
  const pending = page.locator('[data-slot="chapter-audio-pending"]');
  await expect(bar.getByRole("button", { name: "待采用", exact: true })).toBeVisible();
  await expect(pending).toHaveCount(0);
  await bar.getByRole("button", { name: "播放当前版本", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.calls.filter((call) => call.command === "chapter_audio_playback").at(-1)?.args.runId)).toBe("narrator-run");
  await bar.getByRole("button", { name: "导出 WAV", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.calls.filter((call) => call.command === "chapter_audio_export").at(-1)?.args.runId)).toBe("narrator-run");
  await bar.getByRole("button", { name: "版本", exact: true }).click();
  await page.getByRole("menuitem", { name: /待采用/ }).click();
  await bar.getByRole("button", { name: "待采用", exact: true }).click();
  await expect(pending.getByText("已重录 1 段，等待决定", { exact: true })).toBeVisible();
  await expect(page.locator('[data-action="chapter-audio-adopt"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="chapter-audio-history"]')).toHaveCount(0);
  await pending.getByRole("button", { name: "试听当前片段", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.calls.filter((call) => call.command === "chapter_audio_playback").at(-1)?.args))
    .toMatchObject({ runId: "narrator-run", fromIndex: 2 });
  await page.evaluate(() => window.testAudio.find((audio) => !audio.paused)?.dispatchEvent(new Event("ended")));
  await expect(bar.getByRole("button", { name: "播放此版本", exact: true })).toBeVisible();
  await pending.getByRole("button", { name: "试听重录片段", exact: true }).click();
  await expect(bar.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "chapter_audio_playback").at(-1).args)).toMatchObject({ runId: "retake-1", fromIndex: 2 });

  await pending.getByRole("button", { name: "放弃", exact: true }).click();
  await expect(pending).toHaveCount(0);
  expect(await decisions(page)).toEqual([["chapter_audio_reject", "retake-1"]]);
  // 放弃正在试听的重录版本后停止播放，回到当前版本。
  await expect(bar.getByRole("button", { name: "播放整章", exact: true })).toBeEnabled();
  await expect(bar.getByRole("button", { name: "导出 WAV", exact: true })).toBeEnabled();
  await expect(track).toHaveAttribute("data-run-id", "narrator-run");

  // 再次重录并采用：播放与导出切换到新版本。
  await track.locator("[data-unit-index]").nth(2).click();
  await retake.click();
  await expect.poll(() => lastStart(page)).toEqual({ kind: "retake", run_id: "narrator-run", units: [2] });
  await finish(page);
  await bar.getByRole("button", { name: "待采用", exact: true }).click();
  await pending.getByRole("button", { name: "采用", exact: true }).click();
  await expect(pending).toHaveCount(0);
  expect(await decisions(page)).toEqual([
    ["chapter_audio_reject", "retake-1"],
    ["chapter_audio_adopt", "retake-2"],
  ]);
  await expect(bar.getByRole("button", { name: "播放整章", exact: true })).toBeEnabled();
  await expect(bar.getByRole("button", { name: "导出 WAV", exact: true })).toBeEnabled();
  await expect(track).toHaveAttribute("data-run-id", "retake-2");
  expect(await page.evaluate(() => window.fixture.audio.run.adoption)).toBe("adopted");
});

test("the version list opens earlier versions and returns to the current one", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubAudio(page);
  await page.goto(workspace);
  const bar = await startNarration(page);
  await finish(page);
  await expect(bar.getByRole("button", { name: "版本", exact: true })).toHaveCount(0);

  await expandChapterTrack(page);
  const track = page.getByRole("region", { name: "章节音频轨道" });
  const properties = page.getByRole("button", { name: "片段属性", exact: true });
  if ((await properties.count()) > 0 && (await properties.getAttribute("aria-expanded")) !== "true") await properties.click();
  await track.locator("[data-unit-index]").nth(2).click();
  await page.getByRole("button", { name: "重录此段", exact: true }).click();
  await expect.poll(() => lastStart(page)).toEqual({ kind: "retake", run_id: "narrator-run", units: [2] });
  await finish(page);
  await bar.getByRole("button", { name: "待采用", exact: true }).click();
  await page.locator('[data-slot="chapter-audio-pending"]').getByRole("button", { name: "采用", exact: true }).click();
  await expect(page.locator('[data-slot="chapter-audio-pending"]')).toHaveCount(0);

  // 两个版本：当前采用的重录版本与先前的整章版本。
  const versions = bar.getByRole("button", { name: "版本", exact: true });
  await expect(versions).toBeVisible();
  await bar.getByRole("button", { name: "播放整章", exact: true }).click();
  await expect(bar.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await versions.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: /当前版本/ })).toHaveAttribute("aria-current", "true");
  const earlier = menu.getByRole("menuitem").filter({ hasNotText: "当前版本" });
  await expect(earlier).toHaveCount(1);
  await earlier.click();
  const history = page.locator('[data-slot="chapter-audio-history"]');
  const historyTrigger = bar.getByRole("button", { name: "历史版本", exact: true });
  await historyTrigger.click();
  await expect(history.getByText("正在查看历史版本", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "播放此版本", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.calls.filter((call) => call.command === "chapter_audio_playback").at(-1)?.args.runId)).toBe("narrator-run");
  await bar.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(bar.getByRole("button", { name: "采用后可导出 WAV", exact: true })).toBeDisabled();
  await expect(track).toHaveAttribute("data-run-id", "narrator-run");

  // 重新采用先前版本：当前版本让位，章节状态与导出都回到它。
  await historyTrigger.click();
  await history.getByRole("button", { name: "采用此版本", exact: true }).click();
  await expect(history).toHaveCount(0);
  expect(await decisions(page)).toEqual([
    ["chapter_audio_adopt", "retake-1"],
    ["chapter_audio_adopt", "narrator-run"],
  ]);
  await expect(bar.getByRole("button", { name: "导出 WAV", exact: true })).toBeEnabled();
  await expect(track).toHaveAttribute("data-run-id", "narrator-run");
  await versions.click();
  await earlier.click();
  await historyTrigger.click();
  await history.getByRole("button", { name: "返回当前版本", exact: true }).click();
  await expect(history).toHaveCount(0);
  await expect(track).toHaveAttribute("data-run-id", "narrator-run");
  await expect(bar.getByRole("button", { name: "导出 WAV", exact: true })).toBeEnabled();
});

test("the playback bar stays fixed and its review popover works at 1024×680", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await stubAudio(page);
  await page.goto(`${workspace}&locale=en&theme=dark`);
  const bar = page.getByRole("region", { name: "Chapter playback controls", exact: true });
  await bar.getByRole("button", { name: "Produce chapter audio", exact: true }).click();
  await page.getByRole("radio", { name: "Single narrator" }).check();
  await page.getByRole("combobox", { name: "Choose voice", exact: true }).click();
  await page.getByRole("option", { name: /Heart/ }).click();
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "Generate narration", exact: true }).click();
  await finish(page);
  await expandChapterTrack(page);
  const track = page.locator('[data-slot="chapter-audio-track"]');
  const properties = page.getByRole("button", { name: "Clip properties", exact: true });
  if ((await properties.count()) > 0 && (await properties.getAttribute("aria-expanded")) !== "true") await properties.click();
  await track.locator("[data-unit-index]").nth(2).click();
  const retake = page.getByRole("button", { name: "Retake this segment", exact: true });
  await expect(retake).toBeEnabled();
  const measure = () => bar.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const play = node.querySelector("button.rounded-full").getBoundingClientRect();
    return {
      height: box.height,
      top: box.top,
      playX: play.x,
      playY: play.y,
      centerOffset: Math.abs(play.x + play.width / 2 - box.x - box.width / 2),
    };
  });
  const base = await measure();
  expect(base.height).toBe(44);
  expect(base.centerOffset).toBeLessThanOrEqual(1);
  await retake.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => lastStart(page)).toEqual({ kind: "retake", run_id: "narrator-run", units: [2] });
  await expect(bar.getByRole("progressbar")).toBeVisible();
  expect(await measure()).toEqual(base);
  await finish(page);

  const trigger = bar.getByRole("button", { name: "Awaiting decision", exact: true });
  const pending = page.locator('[data-slot="chapter-audio-pending"]');
  await expect(trigger).toBeVisible();
  await expect(pending).toHaveCount(0);
  expect(await measure()).toEqual(base);
  await expect(bar.getByRole("button", { name: "Export WAV", exact: true })).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(pending.getByText("Redid 1 unit, awaiting your decision", { exact: true })).toBeVisible();
  expect(await measure()).toEqual(base);
  const popup = await pending.boundingBox();
  expect(popup.y + popup.height).toBeLessThan(base.top);
  await page.screenshot({ path: testInfo.outputPath("playback-review-popover.png") });
  await page.keyboard.press("Escape");
  await expect(pending).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const adopt = pending.getByRole("button", { name: "Adopt", exact: true });
  await adopt.focus();
  await page.keyboard.press("Enter");
  await expect(pending).toHaveCount(0);
  expect(await decisions(page)).toEqual([["chapter_audio_adopt", "retake-1"]]);
  await expect(bar.getByRole("button", { name: "Export WAV", exact: true })).toBeEnabled();
  await expect(bar.getByRole("button", { name: "Version", exact: true })).toBeVisible();
  expect(await measure()).toEqual(base);
  await properties.click();
  await expect(properties).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await measure()).centerOffset).toBeLessThanOrEqual(1);
  await properties.click();
  await expect(properties).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => (await measure()).centerOffset).toBeLessThanOrEqual(1);
  const directory = page.getByRole("button", { name: "Directory", exact: true });
  await directory.click();
  await expect(directory).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => (await measure()).centerOffset).toBeLessThanOrEqual(1);
  await directory.click();
  await expect(directory).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => Math.abs((await measure()).playX - base.playX)).toBeLessThanOrEqual(1);
  expect((await measure()).centerOffset).toBeLessThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);
});
