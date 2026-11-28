import { openRightView } from "../chapter-task.mjs";
import { expect, test } from "@playwright/test";

async function openCasting(page, extra) {
  await page.setViewportSize({ width: 1024, height: 680 });
  await page.addInitScript(() => {
    window.Audio = class extends EventTarget {
      paused = true;
      ended = false;
      load() {}
      removeAttribute() {}
      pause() {
        this.paused = true;
        this.dispatchEvent(new Event("pause"));
      }
      play() {
        this.paused = false;
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      }
    };
  });
  await page.goto(`/project/fixture-project?fixture=desktop&analysis=1&agentScenario=casting-card&castingDesign=1&auditionMedia=1&${extra}`);
  await page.evaluate(() => {
    window.__TAURI_INTERNALS__.convertFileSrc = (id) => `https://voice-audio.localhost/${encodeURIComponent(id)}`;
  });
  await openRightView(page, "assistant");
  const log = page.getByRole("log");
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  await input.fill("给角色配声音");
  await input.press("Enter");
  const result = log.locator("[data-casting-review]");
  const narrator = result.getByRole("button", { name: /^旁白/ });
  await narrator.click();
  return { input, result, narrator };
}

test("manual design generates, auditions, saves and binds beside the original casting result", async ({ page }) => {
  const { input, result, narrator } = await openCasting(page, "voiceAudition=1&designCandidate=1&queuedAuditions=1");
  const editor = result.getByRole("button", { name: "目录中没有合适的，编辑设计草稿" });
  await editor.press("Enter");
  const form = result.getByRole("form", { name: "为「旁白」设计音色" });
  await expect(form.getByLabel("声音描述")).toHaveValue("沉稳的叙述声");
  await form.getByLabel("音色名称").fill("会话旁白候选");
  await expect(input).toBeInViewport();
  await form.getByRole("button", { name: "生成音色候选" }).click();
  await expect(form).toBeHidden();
  const progress = result.locator('[data-slot="studio-job"]');
  await expect(progress).toHaveAttribute("data-state", "Running");
  await expect(progress.getByRole("status")).toHaveText("生成音频中");
  const candidate = result.locator('[data-slot="casting-design-candidate"]');
  await expect(candidate).toHaveCount(0);
  await page.evaluate(() => window.fixture.finishAudition(1));
  await expect(candidate.getByText("会话旁白候选", { exact: true })).toBeVisible();
  await expect(progress).toHaveCount(0);
  await expect(input).toBeInViewport();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-slot="character-detail"]')).toHaveCount(0);
  await candidate.getByRole("button", { name: "试听设计候选" }).click();
  await expect(candidate.getByRole("button", { name: "暂停" })).toBeVisible();
  await expect(page.getByText("音色试听", { exact: true })).toHaveCount(0);
  await narrator.click();
  await expect(candidate).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.fixture.calls.some(
    ({ command, args }) => command === "voice_audio_lease" && !args.playing
  ))).toBe(true);
  await narrator.click();
  await expect(candidate).toHaveCount(1);
  await candidate.getByRole("button", { name: "保存到音色库" }).click();
  await candidate.getByRole("button", { name: "绑定到此目标" }).click();
  await expect(candidate.getByRole("status")).toHaveText("当前绑定");
  const calls = await page.evaluate(() => window.fixture.calls);
  expect(calls.filter(({ command }) => command === "start_voice_job")).toHaveLength(1);
  expect(calls.find(({ command }) => command === "voice_binding_edit").args).toMatchObject({
    target: { kind: "narrator" }, edit: { type: "bind", voice: { kind: "library", id: "saved-design-1" } },
  });
});

test("approved design audio can be played and adopted within the casting reply", async ({ page }) => {
  const { input, result, narrator } = await openCasting(page, "castingGenerated=1&castingLostReply=1");
  const preview = result.locator('[data-slot="casting-generated-preview"]');
  await preview.getByRole("button", { name: "试听设计候选" }).click();
  await preview.getByRole("button", { name: "暂停" }).click();
  await expect(preview.getByRole("button", { name: "试听设计候选" })).toBeVisible();
  await expect(input).toBeInViewport();
  await expect(page.getByText("音色试听", { exact: true })).toHaveCount(0);
  await preview.getByRole("button", { name: "确认入库并绑定" }).click();
  await expect(result.getByRole("alert")).toContainText("上次音色修改的结果尚未确认");
  await narrator.click();
  await expect(preview).toBeHidden();
  await narrator.click();
  await preview.getByRole("button", { name: "重试原操作" }).click();
  await expect(preview.getByRole("button", { name: "当前绑定" })).toBeDisabled();
  const calls = await page.evaluate(() => window.fixture.calls.filter(({ command }) => command === "casting_adopt_design"));
  expect(calls).toHaveLength(2);
  expect(calls[1].args).toEqual(calls[0].args);
});

test("a late casting preview cannot replace a newer playback selection", async ({ page }) => {
  const { result } = await openCasting(page, "castingGenerated=1&castingPreviewRace=1&audio=1");
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
      if (command === "casting_preview_audio") {
        await new Promise((resolve) => { window.fixture.releasePreview = resolve; });
      }
      return original(command, args, options);
    };
  });
  const preview = result.locator('[data-slot="casting-generated-preview"]');
  const older = preview.getByRole("button", { name: "试听设计候选" });
  await older.click();
  await expect(older).toBeDisabled();
  const newer = result.getByRole("listitem").filter({ hasText: "库内少年" });
  await newer.getByRole("button", { name: "试听", exact: true }).click();
  await expect(newer.getByRole("button", { name: "暂停" })).toBeVisible();
  await page.evaluate(() => window.fixture.releasePreview());
  await expect(older).toBeEnabled();
  await expect(newer.getByRole("button", { name: "暂停" })).toBeVisible();
  const calls = await page.evaluate(() => window.fixture.calls);
  expect(calls.some(({ command, args }) =>
    command === "voice_audio_lease" && args.id === "synthetic-casting-audio"
  )).toBe(false);
});
