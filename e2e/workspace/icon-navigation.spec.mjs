import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("icon-navigation", async ({ flowBrowser: browser }) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  try {
    await page.goto("http://localhost:1437/?fixture=desktop");
    const nav = page.getByRole("navigation", { name: "应用导航", exact: true });
    for (const name of ["工程", "音色中心"]) {
      const item = nav.getByRole("link", { name, exact: true });
      await item.waitFor();
      // 纯图标：名称只来自无障碍名称与悬停提示，不常显文字。
      assert.equal(await item.locator("span").count(), 0);
    }
    assert.equal(
      await nav.getByRole("link", { name: "工程", exact: true }).getAttribute("aria-current"),
      "page",
    );
    const footer = page.locator('[data-slot="rail-footer"]');
    const models = footer.getByRole("link", { name: "模型中心", exact: true });
    assert.equal(await page.getByRole("link", { name: "模型中心", exact: true }).count(), 1);
    assert.equal(await models.locator("span").count(), 0);
    await models.hover();
    await page.locator('[data-slot="tooltip-content"]', { hasText: "模型中心" }).waitFor();
    // 模型状态与设置在底部栏，界面里没有第二个同名入口。
    assert.equal(await page.getByRole("button", { name: "设置", exact: true }).count(), 1);
    // 品牌标记不做导航。
    const before = page.url();
    await page.locator('[data-slot="library-sidebar"] img').click();
    await page.waitForTimeout(300);
    assert.equal(page.url(), before);
    console.log("PASS icon-only navigation rails, single settings entry and inert brand mark");
  } finally { await browser.close(); }
});
