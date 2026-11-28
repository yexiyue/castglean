export function rightPanelToggle(page) {
  return page.getByRole("button", { name: /^(右侧面板|Right panel)$/ });
}

export async function openRightView(page, view) {
  const toggle = rightPanelToggle(page);
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  const name = view === "assistant" ? /^(AI 助手|AI assistant)$/ : /^(片段属性|Clip properties)$/;
  const tab = page.getByRole("tab", { name });
  if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
}

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
  await openRightView(page, "assistant");
  const button = page.locator('[data-slot="chapter-suggestions"]').getByRole("button", { name, exact: true });
  if (await button.isVisible()) return button;
  const input = page.getByRole("textbox", { name: /^(工程问题或补充说明|Project question or additional details)$/ });
  // Wait for the session to settle after a previous task.
  await page.getByRole("button", { name: /^(发送|Send)$/, exact: true }).waitFor();
  const option = page.getByRole("option", { name: new RegExp(`^${name} /`) });
  if (!(await option.isVisible())) {
    const draft = await input.inputValue();
    const separator = draft && !/\s$/u.test(draft) ? "\n" : "";
    await input.fill(`${draft}${separator}/`);
  }
  const shortcut = button.or(option);
  await shortcut.waitFor();
  return shortcut;
}

export function expandChapterTrack(page) {
  return page.locator('[data-slot="chapter-playback-bar"]').getByRole("button", {
    name: /^(展开轨道|Expand track)$/,
  }).click();
}

export async function inspectSegment(page, row) {
  await row.click();
  await openRightView(page, "inspector");
}
