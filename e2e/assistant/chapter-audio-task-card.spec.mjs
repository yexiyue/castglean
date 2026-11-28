import { openRightView, rightPanelToggle } from "../chapter-task.mjs";
import { expect, test } from "@playwright/test";

test("chapter audio Task Card follows the host run across chapter changes and assistant reopening", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await page.addInitScript(() => {
    window.testAudio = [];
    window.Audio = class extends EventTarget {
      src = "";
      paused = true;
      currentTime = 0;
      constructor() {
        super();
        window.testAudio.push(this);
      }
      load() {}
      removeAttribute(name) {
        if (name === "src") this.src = "";
      }
      play() {
        this.paused = false;
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
        this.dispatchEvent(new Event("pause"));
      }
    };
  });
  await page.goto("/project/fixture-project?fixture=desktop&analysis=1&audio=1&locale=en&theme=dark");
  const workflow = page.getByRole("region", { name: "Chapter playback controls" });
  await workflow.getByRole("button", { name: "Produce chapter audio" }).click();
  await page.getByRole("dialog", { name: "Chapter audio settings" }).getByRole("button", { name: "Analyze chapter characters" }).click();
  await workflow.getByRole("button", { name: "Generate chapter audio" }).click();

  const cards = page.getByRole("region", { name: "Recent chapter generation tasks" });
  const card = cards.locator('[data-slot="task-card"][data-chapter-audio-run="audio-run"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-state", "working");
  await expect(card.getByRole("progressbar")).toHaveJSProperty("value", 2);
  await expect(card.getByRole("progressbar")).toHaveJSProperty("max", 4);

  const toggle = rightPanelToggle(page);
  await toggle.click();
  await expect(card).toBeHidden();
  await page.getByRole("button", { name: "Next chapter", exact: true }).click();
  await page.evaluate(() => {
    const { run, units } = window.fixture.audio;
    units[2] = { ...units[2], status: "done", mediaId: "unit-2", durationMs: 1000 };
    Object.assign(run, { completedUnits: 3, currentIndex: 3, revision: run.revision + 1 });
    window.__TAURI_INTERNALS__.convertFileSrc = id => `https://chapter-audio.localhost/${id}`;
  });
  await toggle.click();
  await expect(card.getByRole("progressbar")).toHaveJSProperty("value", 3);
  await expect(cards.locator('[data-slot="task-card"]')).toHaveCount(1);

  await card.getByRole("button", { name: "Preview audio" }).click();
  await expect.poll(() => page.evaluate(() => window.testAudio[0]?.src)).toContain("unit-0");
  await card.getByRole("button", { name: "Pause preview" }).click();
  await expect.poll(() => page.evaluate(() => window.testAudio[0]?.paused)).toBe(true);
  await card.getByRole("button", { name: "Preview audio" }).click();
  await expect.poll(() => page.evaluate(() => window.testAudio[0]?.paused)).toBe(false);

  await page.evaluate(() => {
    const { run, units } = window.fixture.audio;
    units[3] = { ...units[3], status: "done", mediaId: "unit-3", durationMs: 1000 };
    Object.assign(run, { status: "succeeded", stage: "finished", completedUnits: 4, currentIndex: null, revision: run.revision + 1 });
  });
  await expect(card).toHaveAttribute("data-state", "done");
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  await expect(card.getByText("4/4 units")).toBeVisible();
  await card.getByRole("button", { name: "Return to chapter" }).click();

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("main", { name: "Chapter workspace" })).toHaveAttribute("data-chapter-id", "chapter-0");
  await toggle.click();
  await expect(card).toHaveAttribute("data-state", "done");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);

  const calls = await page.evaluate(() => window.fixture.calls);
  expect(calls.filter(({ command }) => command === "chapter_audio_start")).toHaveLength(1);
  expect(calls.filter(({ command }) => command === "agent_start")).toHaveLength(1);
  expect(calls.filter(({ command }) => command === "chapter_audio_playback").map(({ args }) => args))
    .toEqual([{ projectId: "fixture-project", runId: "audio-run", fromIndex: 0 }]);
  expect(calls.some(({ command, args }) => command === "chapter_audio_status" &&
    args.chapterId === "chapter-0" && args.runId === "audio-run")).toBe(true);
});

test("narration Task Card shows a real loading stage and returns to the original mode", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 680 });
  await page.goto("/project/fixture-project?fixture=desktop&analysis=1&audio=1&locale=zh&theme=light");
  const playback = page.getByRole("region", { name: "章节播放控制" });
  await playback.getByRole("button", { name: "制作本章音频" }).click();
  await page.getByRole("radio", { name: "单音色旁白" }).check();
  await page.getByRole("combobox", { name: "选择音色", exact: true }).click();
  await page.getByRole("option", { name: /Heart/ }).click();
  await page.keyboard.press("Escape");
  await playback.getByRole("button", { name: "生成旁白音频" }).click();
  await expect(page.getByRole("region", { name: "章节音频轨道" })).toHaveAttribute("data-run-id", "narrator-run");

  await page.evaluate(() => {
    const { run, units } = window.fixture.audio;
    for (const unit of units) Object.assign(unit, { status: "pending", mediaId: null, durationMs: null });
    Object.assign(run, { stage: "loading", completedUnits: 0, currentIndex: null, revision: run.revision + 1 });
  });
  await playback.getByRole("button", { name: "本章音频设置" }).click();
  await page.getByRole("radio", { name: "多角色" }).check();
  await page.keyboard.press("Escape");
  await openRightView(page, "assistant");
  const card = page.locator('[data-slot="task-card"][data-chapter-audio-run="narrator-run"]');
  await expect(card.getByText("加载模型中")).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "试听音频" })).toHaveCount(0);

  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await card.getByRole("button", { name: "返回原章" }).click();
  await expect(page.getByRole("region", { name: "章节音频轨道" })).toHaveAttribute("data-run-id", "narrator-run");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
  const starts = await page.evaluate(() => window.fixture.calls.filter(({ command }) => command === "chapter_audio_start"));
  expect(starts).toHaveLength(1);
  expect(starts[0].args).toMatchObject({ chapterId: "chapter-0", input: { mode: "narrator" } });
});
