import { expect, test } from "@playwright/test";

for (const [locale, theme, width, labels] of [
  ["zh", "light", 1440, ["全局搜索", "已打开的工程", "待检查", "没有匹配结果"]],
  ["en", "dark", 1024, ["Global search", "Open projects", "Needs review", "No matching results"]],
]) {
  test(`directory actions use popups (${locale})`, async ({ page }) => {
    const [searchName, projectsName, issuesName, emptyName] = labels;
    await page.setViewportSize({ width, height: 780 });
    await page.goto(`/project/fixture-project?fixture=desktop&veryLargeDirectory=1&grouped=1&locale=${locale}&theme=${theme}`);
    await expect(page.getByRole("main", { name: locale === "zh" ? "章节工作台" : "Chapter workspace" })).toBeVisible();
    const toolbar = page.locator('[data-slot="directory-toolbar"]');
    if (!await toolbar.isVisible()) {
      await page.getByRole("button", { name: locale === "zh" ? "目录" : "Directory", exact: true }).click();
    }
    const picker = toolbar.getByRole("button", { name: projectsName, exact: true });
    await expect(picker).toBeVisible();
    await expect(page.locator('[data-slot="desktop-bar"]').getByRole("button", { name: projectsName })).toHaveCount(0);
    await picker.click();
    await expect(page.getByRole("navigation", { name: projectsName })).toBeVisible();
    await page.keyboard.press("Escape");

    const tree = page.getByRole("tree");
    const trigger = toolbar.getByRole("button", { name: searchName, exact: true });
    await trigger.click();
    const search = page.getByRole("combobox", { name: searchName });
    await expect(search).toBeFocused();
    await search.fill("10001");
    await expect(page.getByText(emptyName, { exact: true })).toBeVisible();
    await search.fill("9501");
    await search.press("Enter");
    await expect(search).toBeHidden();
    await expect.poll(() => page.evaluate(() =>
      window.fixture.calls.some(c => c.command === "local_project_text" && c.args.line === 95000),
    )).toBe(true);
    expect(await tree.getByRole("treeitem").count()).toBeLessThan(50);
    const scrollTop = await tree.evaluate(el => el.scrollTop);
    await toolbar.getByRole("button", { name: issuesName, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: new RegExp(issuesName) });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await tree.evaluate(el => el.scrollTop)).toBe(scrollTop);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
