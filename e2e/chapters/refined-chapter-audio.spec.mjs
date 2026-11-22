import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { chapterTask, expandChapterTrack } from "../chapter-task.mjs";

test("unanalysed chapters can explicitly select narration and collapse the active timeline", async ({ page }) => {
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
  await page.goto("/project/fixture-project?fixture=desktop&analysis=1&audio=1");
  const bar = page.getByRole("region", { name: "章节播放控制", exact: true });
  const produce = bar.getByRole("button", { name: "制作本章音频", exact: true });
  await expect(produce).toBeVisible();
  await expect(bar.getByRole("button", { name: "本章音频设置", exact: true })).toHaveCount(0);
  await produce.click();
  await expect(page.getByRole("button", { name: "分析本章角色", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "单音色旁白" }).check();
  const picker = page.getByRole("combobox", { name: "选择音色", exact: true });
  await picker.click();
  await page.getByRole("option", { name: /Heart/ }).click();
  await page.waitForFunction(() => window.fixture.calls.some((call) =>
    call.command === "chapter_audio_check" && call.args.input.mode === "narrator"));
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "生成旁白音频" }).click();
  await expandChapterTrack(page);
  const track = page.getByRole("region", { name: "章节音频轨道" });
  await expect(track.locator("[data-unit-index]").first()).toBeVisible();
  await expect(track.locator("[data-unit-index] svg").first()).toBeVisible();
  await track.locator("[data-unit-index]").first().click();
  const starts = await page.evaluate(() => window.fixture.calls.filter((x) => x.command === "chapter_audio_start").map((x) => x.args.input.mode));
  expect(starts).toEqual(["narrator"]);
  expect(await page.evaluate(() => window.fixture.calls.filter((x) => x.command === "agent_start"))).toEqual([]);
  await bar.getByRole("button", { name: "试听已生成片段" }).click();
  await expect(bar.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await bar.getByRole("button", { name: "收起轨道" }).click();
  await expect(track.locator("[data-unit-index]").first()).toBeHidden();
  await expect(bar.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await page.evaluate(() => window.testAudio[0].dispatchEvent(new Event("error")));
  const playbackError = page.getByRole("alert").filter({ hasText: "音频无法播放" });
  await expect(playbackError).toBeVisible();
  await playbackError.getByRole("button", { name: "关闭" }).click();
  await bar.getByRole("button", { name: "试听已生成片段" }).click();
  await expect(bar.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 680 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);
  await bar.getByRole("button", { name: "展开轨道" }).click();
  await expect(track.locator("[data-unit-index]").first()).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.testAudio.filter((item) => !item.paused).length)).toBe(1);

  const settings = bar.getByRole("button", { name: "本章音频设置", exact: true });
  await settings.click();
  await page.getByRole("radio", { name: "多角色" }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible();

  await page.evaluate(() => {
    const { run, units } = window.fixture.audio;
    for (const unit of units) {
      unit.status = "done";
      unit.mediaId = `narration-${unit.index}`;
      unit.durationMs = 1000;
    }
    Object.assign(run, { status: "succeeded", completedUnits: 4, finalDurationMs: 4000, currentIndex: null, revision: run.revision + 1 });
  });
  await expect(bar.getByRole("button", { name: "导出 WAV" })).toBeEnabled();
  await settings.click();
  await expect(page.getByRole("radio", { name: "单音色旁白" })).toBeChecked();
  await page.getByRole("radio", { name: "多角色" }).check();
  await page.keyboard.press("Escape");
  await expect(bar.getByRole("button", { name: "Analyze chapter characters" }).or(bar.getByRole("button", { name: "分析本章角色" }))).toBeEnabled();
  await settings.click();
  await page.getByRole("radio", { name: "单音色旁白" }).check();
  await page.keyboard.press("Escape");
  await expect(track).toHaveAttribute("data-run-id", "narrator-run");
  await expect(bar.getByRole("button", { name: "播放整章" })).toBeEnabled();
  expect(await page.evaluate(() => window.fixture.calls.filter((x) => x.command === "chapter_audio_start").length)).toBe(1);
});

test("generation recovery stays in the playback bar with the track collapsed", async ({ page }) => {
  await page.goto("/project/fixture-project?fixture=desktop&analysis=1&audio=1");
  const bar = page.getByRole("region", { name: "章节播放控制" });
  await bar.getByRole("button", { name: "制作本章音频", exact: true }).click();
  await page.getByRole("radio", { name: "单音色旁白" }).check();
  await page.getByRole("combobox", { name: "选择音色", exact: true }).click();
  await page.getByRole("option", { name: /Heart/ }).click();
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "生成旁白音频" }).click();
  await expandChapterTrack(page);

  const progress = bar.getByRole("progressbar", { name: "生成进度" });
  await expect(progress).toHaveAttribute("aria-valuenow", "50");
  await expect(bar.getByText("生成中 2/4", { exact: true })).toBeVisible();
  await expect(bar.getByText("50%", { exact: true })).toHaveCount(0);
  const rail = page.locator('[data-slot="audio-track-scroll"]');
  await expect(rail.getByText("0:01", { exact: true })).toBeVisible();
  await expect(rail.getByText("0:02", { exact: true })).toBeVisible();
  await expect(rail.getByText("0:03", { exact: true })).toHaveCount(0);
  await bar.getByRole("button", { name: "收起轨道" }).click();
  await bar.getByRole("button", { name: "停止生成" }).click();
  const resume = bar.getByRole("button", { name: "继续生成", exact: true });
  await expect(resume).toBeVisible();
  await expect(page.getByRole("button", { name: "生成新版本", exact: true }).and(bar.getByRole("button"))).toHaveCount(0);
  await resume.click();
  await expect(progress).toBeVisible();
  await expect(bar.getByRole("button", { name: "展开轨道" })).toBeVisible();
  expect(await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "chapter_audio_start").at(-1).args.resumeRunId)).toBe("narrator-run");

  await page.evaluate(() => {
    const { run, units } = window.fixture.audio;
    Object.assign(run, { status: "failed", currentIndex: null, failedIndex: 2, error: "unit_synthesis_failed", revision: run.revision + 1 });
    units[2].status = "failed";
  });
  const retry = bar.getByRole("button", { name: "重试", exact: true });
  await expect(retry).toBeVisible();
  const failedClip = bar.getByRole("button", { name: "第 3 段失败" });
  await failedClip.click();
  await expect.poll(() => page.evaluate(() => window.fixture.calls.some((call) => call.command === "chapter_analysis_excerpt" && call.args.range.start === window.fixture.audio.units[2].range.start))).toBe(true);

  await page.evaluate(() => { window.fixture.audio.arrangement.stale = true; });
  await expect(bar.getByRole("button", { name: "生成新版本", exact: true })).toBeVisible();
  await expect(retry).toHaveCount(0);
});

test("short tracks fit on resize and label compressed clips with real boundary times", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/project/fixture-project?fixture=desktop&analysis=1&audio=1");
  const bar = page.getByRole("region", { name: "章节播放控制" });
  await bar.getByRole("button", { name: "制作本章音频" }).click();
  await page.getByRole("radio", { name: "单音色旁白" }).check();
  await page.getByRole("combobox", { name: "选择音色" }).click();
  await page.getByRole("option", { name: /Heart/ }).click();
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "生成旁白音频" }).click();
  await expandChapterTrack(page);

  const rail = page.locator('[data-slot="audio-track-scroll"]');
  const clips = rail.locator("[data-unit-index]");
  await page.evaluate(() => {
    const { run, units } = window.fixture.audio;
    for (const index of [4, 5]) units.push({ ...units[3], index });
    Object.assign(run, { unitCount: units.length, revision: run.revision + 1 });
  });
  await expect(clips).toHaveCount(6);
  const generating = rail.getByRole("button", { name: "正在生成…", exact: true });
  await expect(generating.getByText("正在生成…", { exact: true })).toBeVisible();
  expect((await generating.boundingBox()).width).toBeGreaterThanOrEqual(128);
  const geometry = () => clips.evaluateAll((nodes) => nodes.map((node) => {
    const { left, width } = node.getBoundingClientRect();
    return { left, width };
  }));
  const initial = await geometry();
  await page.evaluate(() => {
    const { run, units } = window.fixture.audio;
    Object.assign(units[2], { status: "done", mediaId: "unit-2", durationMs: 30000 });
    Object.assign(run, { completedUnits: 3, currentIndex: 3, revision: run.revision + 1 });
  });
  await expect(rail.getByText("0:32", { exact: true })).toBeVisible();
  expect(await geometry()).toEqual(initial);

  await page.evaluate(() => {
    const { run, units } = window.fixture.audio;
    const durations = [100, 1600, 30000, 2200, 2200, 2200];
    for (const unit of units) {
      Object.assign(unit, { status: "done", mediaId: `unit-${unit.index}`, durationMs: durations[unit.index] });
    }
    Object.assign(run, { status: "succeeded", completedUnits: units.length, currentIndex: null, revision: run.revision + 1 });
  });
  await expect(rail.getByText("0:00.1", { exact: true })).toBeVisible();
  await expect(rail.getByText("0:31.7", { exact: true })).toBeVisible();
  const wide = await geometry();
  expect(wide[0].width).toBe(68);
  expect(wide[2].width).toBe(240);
  await page.setViewportSize({ width: 1024, height: 680 });
  await expect.poll(async () => (await geometry())[3].width).toBeLessThan(wide[3].width);
  await expect.poll(() => rail.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
  await expect(rail.getByText("0:31.7", { exact: true })).toBeVisible();
});

test("generation checks group host blockers in a narrow workspace", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 680 });
  await page.goto("/project/fixture-project?fixture=desktop&analysis=1&audio=1&locale=en&theme=dark");
  await page.evaluate(() => {
    const item = {
      count: 1, line: 1, range: { start: 0, end: 1 },
      characterId: null, characterName: null, segmentId: "segment-1", detail: null,
    };
    window.fixture.generationBlockers = [
      { ...item, kind: "missing_binding" },
      { ...item, kind: "missing_binding", characterId: "character-a", characterName: "A Lan" },
      { ...item, kind: "unknown_attribution", count: 2 },
      { ...item, kind: "resource_not_ready", range: null },
    ];
  });
  await (await chapterTask(page, "Analyze chapter characters")).click();
  const bar = page.getByRole("region", { name: "Chapter playback controls" });
  const check = bar.getByRole("button", { name: "Resolve 4 generation issues" });
  await expect(check).toBeVisible();
  await expect(bar.locator('[role="status"]').filter({ hasText: "4 issues before generation" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Generation check" })).toBeHidden();
  await check.click();
  const inspector = page.getByRole("dialog", { name: "Generation check" });
  await expect.poll(async () => {
    const box = await inspector.boundingBox();
    return box ? Math.max(Math.abs(box.x + box.width / 2 - 450), Math.abs(box.y + box.height / 2 - 340)) : Infinity;
  }).toBeLessThan(2);
  await expect(inspector.getByRole("heading", { name: "Missing voices 2" })).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Choose a voice for A Lan" })).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "Speaker attribution 1" })).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Locate and fix" })).toBeVisible();
  await expect(inspector.getByRole("link", { name: "Model Center" })).toHaveAttribute("href", "/models");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
  expect(await page.evaluate(() => window.fixture.calls.filter(({ command }) => command === "chapter_audio_start"))).toEqual([]);
  await page.mouse.move(0, 0);
  await mkdir("src-tauri/target/workflow-simplification", { recursive: true });
  await page.screenshot({ path: "src-tauri/target/workflow-simplification/generation-check-small-en-dark.png" });
});

for (const [locale, theme] of [["zh", "light"], ["en", "dark"]]) {
  test(`the assistant stays usable with the track open at 1024×680 (${locale})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 680 });
    await page.goto(`/project/fixture-project?fixture=desktop&analysis=1&audio=1&locale=${locale}&theme=${theme}`);
    const en = locale === "en";
    await (await chapterTask(page, en ? "Analyze chapter characters" : "分析本章角色")).click();
    await (await chapterTask(page, en ? "Generate chapter audio" : "生成本章音频")).click();
    const back = page.getByRole("button", { name: en ? "Back to AI assistant" : "返回 AI 助手", exact: true });
    const assistant = page.getByRole("button", { name: en ? "AI assistant" : "AI 助手", exact: true });
    if (await back.isVisible()) await back.click();
    else if (await assistant.getAttribute("aria-expanded") === "false") await assistant.click();

    const bar = page.locator('[data-slot="chapter-playback-bar"]');
    const rail = page.locator('[data-slot="audio-track-scroll"]');
    const play = bar.getByRole("button", { name: en ? "Play available clips" : "试听已生成片段" });
    const reader = page.locator('[data-slot="chapter-reader"]');
    const log = page.getByRole("log");
    const input = page.getByRole("textbox", { name: en ? "Project question or additional details" : "工程问题或补充说明" });
    const send = page.getByRole("button", { name: en ? "Send" : "发送", exact: true });
    const draft = "Review the chapter\nCheck the narrator\nKeep the original wording";
    await expect(play).toBeVisible();
    await expect(rail).toHaveCount(0);
    const reply = log.locator('[data-slot="aui_assistant-message-root"]').first();
    await expect(reply).toBeVisible();
    await input.fill(draft);
    const centerOffset = async () => {
      const [button, source] = await Promise.all([play.boundingBox(), reader.boundingBox()]);
      return Math.abs(button.x + button.width / 2 - source.x - source.width / 2);
    };
    await expect.poll(centerOffset).toBeLessThan(2);
    const composer = input.locator("xpath=ancestor::form");
    const chatHeight = async () => (await composer.boundingBox()).y - (await log.boundingBox()).y;
    const collapsed = await chatHeight();
    const collapsedBar = await bar.boundingBox();
    await page.screenshot({ path: testInfo.outputPath("collapsed.png") });

    await expandChapterTrack(page);
    await expect(rail).toBeVisible();
    await expect.poll(async () => collapsedBar.y - (await bar.boundingBox()).y).toBeCloseTo(80, 0);
    await expect(input).toHaveValue(draft);
    await expect(input).toBeInViewport({ ratio: 1 });
    await expect(send).toBeInViewport({ ratio: 1 });
    await expect(send).toBeEnabled();
    await expect.poll(centerOffset).toBeLessThan(2);
    const expanded = await chatHeight();
    const [inputBox, sendBox, timeline, logBox] = await Promise.all(
      [input, send, rail, log].map((item) => item.boundingBox()),
    );
    const barBox = await bar.boundingBox();
    expect(expanded).toBeGreaterThan(260);
    expect(collapsed - expanded).toBeLessThanOrEqual(84);
    expect(logBox.y + logBox.height).toBeLessThanOrEqual(barBox.y + 1);
    expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(barBox.y);
    expect(timeline.height).toBeLessThanOrEqual(84);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);
    console.log(`1024×680 ${locale}/${theme}: chat ${Math.round(collapsed)} → ${Math.round(expanded)}px, input ${Math.round(inputBox.height)}px, track ${timeline.height}px`);
    await page.screenshot({ path: testInfo.outputPath("expanded.png") });
    await bar.getByRole("button", { name: en ? "Collapse track" : "收起轨道" }).click();
    await expect(rail).toHaveCount(0);
    await expect(input).toHaveValue(draft);
  });
}

for (const [locale, theme, rolesLabel] of [
  ["zh", "light", "工程角色"],
  ["en", "dark", "Project characters"],
]) {
  test(`character directory and production footer align with their panes (${locale})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 820 });
    await page.goto(`/project/fixture-project?fixture=desktop&analysis=1&audio=1&locale=${locale}&theme=${theme}`);
    await page.getByRole("button", { name: rolesLabel, exact: true }).click();
    const directory = page.locator('[data-slot="character-directory"]');
    const detail = page.locator('[data-slot="character-detail"]');
    const footer = page.locator('[data-slot="chapter-audio-footer"]');
    const narrator = directory.locator('[data-character-directory-row]').first();
    await expect(narrator).toHaveAttribute("aria-current", "true");
    await expect.poll(async () => {
      const [tree, body, bar, workspaceLeft] = await Promise.all([
        directory.boundingBox(),
        detail.boundingBox(),
        footer.boundingBox(),
        page.locator('[data-slot="chapter-reader"]').evaluate(
          (reader) => reader.parentElement.getBoundingClientRect().left,
        ),
      ]);
      return Math.max(
        Math.abs(tree.x - workspaceLeft),
        Math.abs(tree.x + tree.width - body.x),
        Math.abs(body.x - bar.x),
        Math.abs(body.x + body.width - bar.x - bar.width),
      );
    }).toBeLessThan(2);
    const textAlignment = await narrator.evaluate((row) => {
      const [title, binding] = row.querySelectorAll(".truncate");
      return {
        delta: Math.abs(title.getBoundingClientRect().left - binding.getBoundingClientRect().left),
        fits: binding.getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom,
      };
    });
    expect(textAlignment).toEqual({ delta: 0, fits: true });
    await directory.locator('[data-character-directory-row]').nth(1).click();
    const chooseVoice = detail.getByRole("combobox", {
      name: locale === "zh" ? "选择音色" : "Choose voice",
      exact: true,
    });
    const profile = detail.getByRole("textbox");
    await expect(chooseVoice).not.toHaveClass(/\bbg-primary\b/);
    const [action, field] = await Promise.all([chooseVoice.boundingBox(), profile.boundingBox()]);
    const design = await detail.getByRole("button", {
      name: locale === "zh" ? "设计新音色" : "Design a new voice",
      exact: true,
    }).boundingBox();
    expect(field.width).toBeLessThanOrEqual(672);
    expect(action.width).toBeLessThan(field.width / 2);
    expect(action.x).toBeCloseTo(field.x, 0);
    expect(action.y + action.height).toBeLessThan(field.y);
    expect(design.x).toBeCloseTo(action.x + action.width + 8, 0);
    await page.screenshot({ path: testInfo.outputPath("character-center-wide.png") });

    await page.setViewportSize({ width: 900, height: 680 });
    await expect.poll(async () => {
      const [tree, body, bar] = await Promise.all([directory.boundingBox(), detail.boundingBox(), footer.boundingBox()]);
      return tree.y + tree.height <= body.y + 1 &&
        Math.abs(body.x - bar.x) < 2 &&
        Math.abs(body.width - bar.width) < 2 &&
        Math.abs(body.y + body.height - bar.y) < 2;
    }).toBe(true);
    await expect(footer.getByRole("button").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("character-center-compact.png") });
  });
}
