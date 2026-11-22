export async function chapterTask(page, name) {
  if (/^(生成本章音频|重新生成本章音频|Generate chapter audio)$/.test(name)) {
    const bar = page.locator('[data-slot="chapter-playback-bar"]:visible');
    const start = bar.getByRole("button", { name, exact: true });
    if (await start.isVisible()) return start;
    const primary = bar.getByRole("button", { name: /^(生成新版本|Generate a new version)$/ });
    if (await primary.isVisible()) return primary;
    if (await bar.getByRole("button", { name: /^(本章音频设置|Chapter audio settings)$/ }).isVisible()) {
      const heading = page.getByRole("heading", { name: /^(本章音频设置|Chapter audio settings)$/ });
      if (!(await heading.isVisible())) {
        await bar.getByRole("button", { name: /^(本章音频设置|Chapter audio settings)$/ }).click();
      }
      const regenerate = page.getByRole("button", { name: /^(生成新版本|Generate a new version)$/ });
      if (await regenerate.isVisible()) return regenerate;
      await page.keyboard.press("Escape");
    }
    await start.waitFor();
    return start;
  }
  const suggestions = page.locator('[data-slot="chapter-suggestions"]:not([data-closed] *)');
  const button = suggestions.getByRole("button", { name, exact: true });
  if (!(await suggestions.first().isVisible())) {
    const menu = page.getByRole("button", { name: /^(章节任务|Chapter tasks)$/ });
    if (!(await menu.isVisible())) {
      const toggle = page.getByRole("button", { name: /^(AI 助手|AI assistant)$/ });
      if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
    }
    if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true" && !(await suggestions.first().isVisible())) await menu.click();
  }
  await button.waitFor();
  return button;
}

export function expandChapterTrack(page) {
  return page.locator('[data-slot="chapter-playback-bar"]').getByRole("button", {
    name: /^(展开轨道|Expand track)$/,
  }).click();
}

export async function inspectSegment(page, row) {
  await row.click();
  const toggle = page.getByRole("button", { name: /^(片段属性|Clip properties)$/ });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}
