import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("icon-navigation", async ({ flowBrowser: browser }) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  try {
    await page.goto("http://localhost:1437/?fixture=desktop");
    const nav = page.getByRole("navigation", { name: "应用导航", exact: true });
    for (const name of ["音色中心", "模型中心"]) {
      const item = nav.getByRole("link", { name, exact: true });
      await item.waitFor();
      // 纯图标：名称只来自无障碍名称与悬停提示，不常显文字。
      assert.equal(await item.locator("span").count(), 0);
    }
    const home = page.getByRole("link", { name: "工程首页", exact: true });
    assert.equal(await home.count(), 1);
    assert.equal(await home.getAttribute("aria-current"), "page");
    assert.equal(await home.locator("img").count(), 1);
    assert.equal(await home.evaluate(el => getComputedStyle(el).backgroundColor),
      await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--secondary").trim()));
    const models = nav.getByRole("link", { name: "模型中心", exact: true });
    await models.hover();
    await page.locator('[data-slot="tooltip-content"]', { hasText: "模型中心" }).waitFor();
    // 底部栏只保留设置入口，界面里没有第二个同名入口。
    assert.equal(await page.getByRole("button", { name: "设置", exact: true }).count(), 1);
    await models.click();
    await page.waitForURL(url => url.pathname === "/models");
    assert.equal(await home.getAttribute("aria-current"), null);
    await home.click();
    await page.waitForURL(url => url.pathname === "/");
    assert.equal(await home.getAttribute("aria-current"), "page");

  } finally { await browser.close(); }
});
