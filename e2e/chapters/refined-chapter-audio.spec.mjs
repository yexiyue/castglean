import { expect, test } from "@playwright/test";

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
  await bar.getByRole("button", { name: "制作本章音频", exact: true }).click();
  await expect(page.getByRole("button", { name: "分析角色归属", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "单音色旁白" }).check();
  const picker = page.getByRole("combobox", { name: "选择音色", exact: true });
  await picker.click();
  await page.getByRole("option", { name: /Heart/ }).click();
  await page.waitForFunction(() => window.fixture.calls.some((call) =>
    call.command === "chapter_audio_check" && call.args.input.mode === "narrator"));
  await bar.getByRole("button", { name: "生成旁白音频" }).click();
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

  await page.getByRole("radio", { name: "多角色" }).check();
  await page.getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.getByRole("radio", { name: "单音色旁白" })).toBeChecked();
  await expect(page.getByRole("button", { name: "取消", exact: true })).toBeVisible();

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
  await page.getByRole("radio", { name: "多角色" }).check();
  await expect(bar.getByRole("button", { name: "制作本章音频" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "分析角色归属" })).toBeEnabled();
  await page.getByRole("radio", { name: "单音色旁白" }).check();
  await expect(track).toHaveAttribute("data-run-id", "narrator-run");
  await expect(bar.getByRole("button", { name: "播放整章" })).toBeEnabled();
  expect(await page.evaluate(() => window.fixture.calls.filter((x) => x.command === "chapter_audio_start").length)).toBe(1);
});
