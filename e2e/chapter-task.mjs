export async function chapterTask(page, name) {
  const suggestions = page.locator('[data-slot="chapter-suggestions"]:not([data-closed] *)');
  const button = suggestions.getByRole("button", { name, exact: true });
  if (!(await suggestions.first().isVisible())) {
    const menu = page.getByRole("button", { name: /^(章节任务|Chapter tasks)$/ });
    if (!(await menu.isVisible())) {
      const toggle = page.locator('[data-slot="assistant-header"] button');
      if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
    }
    if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true" && !(await suggestions.first().isVisible())) await menu.click();
  }
  await button.waitFor();
  return button;
}
