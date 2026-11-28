import { expect, test as browserTest } from "@playwright/test";
import { openRightView } from "../chapter-task.mjs";
import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("project-navigation", async ({ flowBrowser: browser }) => {
try {
  for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) for (const width of [1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1024 ? 680 : 900 } });
    await page.goto(`http://localhost:1437/project/fixture-project?fixture=desktop&locale=${locale}&theme=${theme}`);
    const names = locale === "zh" ? ["章节制作", "工程角色", "制作结果"] : ["Chapter production", "Project characters", "Production results"];
    const nav = page.getByRole("navigation", { name: locale === "zh" ? "工程导航" : "Project navigation" });
    for (const name of names) {
      const button = nav.getByRole("button", { name, exact: true });
      await button.waitFor();
      // 名称由无障碍名称与悬停提示承载，图标本身不常显文字。
      assert.equal(await button.locator("span").count(), 0);
      assert.equal(await button.evaluate((element) => element.scrollWidth <= element.clientWidth), true, `${locale} ${name} clipped`);
    }
    await nav.getByRole("button", { name: names[0], exact: true }).hover();
    await page.locator('[data-slot="tooltip-content"]', { hasText: names[0] }).waitFor();
    await nav.getByRole("button", { name: names[2], exact: true }).click();
    assert.equal(await nav.getByRole("button", { name: names[2], exact: true }).getAttribute("aria-current"), "page");
    await page.getByText(locale === "zh" ? "在章节制作中选择声音、生成和试听音频，并导出 WAV。跨章节结果列表尚未提供。" : "Choose voices, generate and preview audio, and export WAV in Chapter Studio. A cross-chapter results list is not available yet.", { exact: true }).waitFor();
    assert.equal(await page.getByText(locale === "zh" ? "音频制作尚未接入" : "Audio production is not available yet", { exact: true }).count(), 0);
    await page.getByRole("button", { name: locale === "zh" ? "返回章节制作" : "Back to chapters", exact: true }).click();
    await page.locator('main[data-chapter-id="chapter-0"]').waitFor();
    assert.equal(await nav.getByRole("button", { name: names[0], exact: true }).getAttribute("aria-current"), "page");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
    if (width === 1024) await page.screenshot({ path: `/tmp/castglean-nav-${locale}-${theme}.png` });
    await page.close();
  }
  console.log("PASS project navigation and honest results copy in both languages, themes and window sizes");
} finally { await browser.close(); }
});

browserTest("persistent history returns from the inspector roles action", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await page.goto("/project/fixture-project?fixture=desktop&analysis=1&longChapter=1&platform=windows");

  const bar = page.locator('[data-slot="desktop-bar"]');
  const back = bar.getByRole("button", { name: "返回", exact: true });
  const forward = bar.getByRole("button", { name: "前进", exact: true });
  const nav = page.getByRole("navigation", { name: "工程导航" });
  const chapters = nav.getByRole("button", { name: "章节制作" });
  const characters = nav.getByRole("button", { name: "工程角色" });
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();

  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await expect(page.locator('main[data-chapter-id="chapter-1"]')).toBeVisible();
  await openRightView(page, "assistant");
  const draft = page.getByRole("textbox", { name: "工程问题或补充说明" });
  await draft.fill("导航保留的草稿");
  await openRightView(page, "inspector");
  const source = page.locator('[data-slot="source-scroll"]');
  await expect.poll(() => source.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(300);
  await source.evaluate((element) => element.scrollTo({ top: 200, behavior: "instant" }));
  await expect.poll(() => source.evaluate((element) => element.scrollTop)).toBe(200);

  const inspector = page.getByRole("complementary", { name: "AI 助手与检查器" });
  await inspector.getByRole("button", { name: "角色", exact: true }).click();
  await expect(characters).toHaveAttribute("aria-current", "page");
  await expect(back).toBeEnabled();
  await expect(forward).toBeDisabled();
  const rightColumn = page.locator('.workspace-pane:has(aside[aria-label="AI 助手与检查器"])');
  await expect(rightColumn).toHaveCSS("width", "0px");
  await page.screenshot({ path: testInfo.outputPath("history-characters-1024.png") });

  await characters.click();
  await back.click();
  await expect(chapters).toHaveAttribute("aria-current", "page");
  await expect(page.locator('main[data-chapter-id="chapter-1"]')).toBeVisible();
  await expect.poll(() => source.evaluate((element) => element.scrollTop)).toBe(200);
  await expect(inspector.getByRole("tab", { name: "片段属性" })).toHaveAttribute("aria-selected", "true");
  await openRightView(page, "assistant");
  await expect(draft).toHaveValue("导航保留的草稿");
  await expect(forward).toBeEnabled();

  await forward.click();
  await expect(characters).toHaveAttribute("aria-current", "page");
  await expect(forward).toBeDisabled();

  await back.click();
  await expect(forward).toBeEnabled();
  await nav.getByRole("button", { name: "制作结果" }).click();
  await expect(nav.getByRole("button", { name: "制作结果" })).toHaveAttribute("aria-current", "page");
  await expect(forward).toBeDisabled();
  await back.click();
  await expect(chapters).toHaveAttribute("aria-current", "page");
  const controls = bar.getByRole("group", { name: "窗口控制" });
  await expect(controls).toBeVisible();
  expect(await bar.evaluate((element) => element.scrollWidth)).toBe(1024);
});
