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
      assert.equal(await button.locator("span", { hasText: name }).isVisible(), true);
      assert.equal(await button.evaluate((element) => element.scrollWidth <= element.clientWidth), true, `${locale} ${name} clipped`);
    }
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
