import { expect, test } from "@playwright/test";

const workspace = "/project/fixture-project?fixture=desktop&analysis=1&audio=1";

test("chapter workflow prioritizes attribution and binding, then returns to active generation", async ({ page }) => {
  await page.goto(workspace);
  const status = page.getByRole("region", { name: "章节播放控制" });
  const start = Buffer.byteLength("第1章 山雨\r\n");
  const end = start + Buffer.byteLength("阿岚说：“我们走吧。”\n");
  await page.evaluate(({ start, end }) => {
    const blocker = { count: 1, line: 1, range: { start, end }, segmentId: null, detail: null };
    window.fixture.generationBlockers = [
      { ...blocker, kind: "missing_binding", characterId: "character-a", characterName: "阿岚" },
      { ...blocker, kind: "unknown_attribution", characterId: null, characterName: null },
    ];
  }, { start, end });
  await status.getByRole("button", { name: "制作本章音频", exact: true }).click();
  await page.getByRole("dialog", { name: "本章音频设置" }).getByRole("button", { name: "分析角色归属" }).click();
  await expect(page.locator('[data-slot="workspace-notices"]')).toHaveCount(0);
  await expect(page.getByText("需要可用的角色归属", { exact: true })).toHaveCount(0);
  await expect(status.getByRole("button", { name: "生成本章音频", exact: true })).toBeHidden();

  await status.getByRole("button", { name: "处理 2 项生成问题" }).click();
  const check = page.getByRole("dialog", { name: "生成前检查" });
  await check.getByRole("button", { name: "定位并修正" }).click();
  await expect(check).toBeHidden();
  await expect(page.getByRole("heading", { name: "片段属性", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(offset => window.fixture.calls.some(({ command, args }) =>
    command === "chapter_analysis_excerpt" && args.chapterId === "chapter-0" && args.range.start === offset
  ), start)).toBe(true);

  await page.evaluate(() => {
    window.fixture.generationBlockers = window.fixture.generationBlockers.filter(({ kind }) => kind === "missing_binding");
  });
  await page.getByLabel("说话人", { exact: true }).selectOption("character-a");
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await status.getByRole("button", { name: "处理 1 项生成问题" }).click();
  await check.getByRole("button", { name: "为「阿岚」选择音色" }).click();
  const voices = check.getByRole("region", { name: "本章声音设置", exact: true });
  await expect(voices.getByText("阿岚", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "搜索音色" }).fill("Heart");
  await page.getByRole("option", { name: /选择音色「Heart」/ }).click();
  await page.evaluate(() => { window.fixture.generationBlockers = []; });
  await voices.getByRole("button", { name: /将「Heart」绑定给/ }).click();

  await expect(check.getByText("生成条件已满足。")).toBeVisible();
  await page.keyboard.press("Escape");
  await status.getByRole("button", { name: "生成本章音频", exact: true }).click();
  await expect(status.getByRole("progressbar")).toBeVisible();
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await status.getByRole("button", { name: "查看", exact: true }).click();
  await expect(status.getByRole("progressbar")).toBeVisible();
  await expect(status.getByRole("button", { name: "查看", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await expect(status.getByRole("button", { name: "查看", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const { run } = window.fixture.audio;
    Object.assign(run, { status: "cancelled", currentIndex: null, revision: run.revision + 1 });
  });
  await expect(status.getByRole("button", { name: "返回原任务" })).toHaveAttribute("title", /山雨/);
  await status.getByRole("button", { name: "返回原任务" }).click();
  await expect(status.getByRole("button", { name: "继续生成", exact: true })).toBeVisible();

  const calls = await page.evaluate(() => window.fixture.calls);
  const analysis = calls.filter(({ command }) => command === "agent_start");
  const generation = calls.filter(({ command }) => command === "chapter_audio_start");
  expect(analysis).toHaveLength(1);
  expect(analysis[0].args.request.workspaceContext).toMatchObject({ action: "analyze", chapterId: "chapter-0" });
  expect(generation).toHaveLength(1);
  expect(generation[0].args).toMatchObject({ chapterId: "chapter-0", input: { mode: "multi_role" } });
});

test("returning to assistant analysis opens the original task in a narrow workspace", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 680 });
  await page.goto(workspace + "&agentScenario=running&locale=en&theme=dark");
  const status = page.getByRole("region", { name: "Chapter playback controls" });
  await status.getByRole("button", { name: "Produce chapter audio" }).click();
  await page.getByRole("dialog", { name: "Chapter audio settings" }).getByRole("button", { name: "Analyze speakers" }).click();
  await expect(status.getByRole("button", { name: "View assistant task" })).toBeVisible();
  const toggle = page.getByRole("button", { name: "AI assistant", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(status.getByRole("button", { name: "View assistant task" })).toBeVisible();

  await page.getByRole("button", { name: "Next chapter", exact: true }).click();
  await expect(status.getByRole("button", { name: "Return to task" })).toHaveAttribute("title", /第1章 山雨/);
  await status.getByRole("button", { name: "Return to task" }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(status.getByRole("button", { name: "View assistant task" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
  expect(await page.evaluate(() => window.fixture.calls.filter(({ command }) => command === "agent_start"))).toHaveLength(1);
});
