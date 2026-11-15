import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("page-state-anchoring", async ({ flowBrowser: browser }) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(15000);
  try {
    // 集合页的搜索无结果态紧跟在工具栏下方，不漂在页面中部。
    await page.goto("http://localhost:1437/voices?fixture=desktop");
    const search = page.getByRole("searchbox", { name: "搜索预置音色" });
    await search.fill("不存在");
    const state = page.locator('[data-app-state="search"]');
    await state.getByText("没有匹配的音色", { exact: true }).waitFor();
    const gap = await state.evaluate((element) => {
      const input = document.querySelector('input[type="search"]');
      const inputBox = input?.getBoundingClientRect();
      const stateBox = element.getBoundingClientRect();
      return inputBox ? stateBox.top - inputBox.bottom : Number.POSITIVE_INFINITY;
    });
    assert.ok(gap >= 0 && gap < 160, `预置音色状态距离工具栏 ${gap}px`);
    assert.ok(
      (await state.evaluate((element) => element.getBoundingClientRect().height)) < 240,
      "预置音色状态不应撑满剩余高度",
    );
    // 搜索无结果态与模型中心使用同一形态：放大镜图标 + 标题 + 清除动作。
    assert.equal(
      await state.locator('[data-slot="empty-icon"] svg').count(),
      1,
    );

    await page.goto("http://localhost:1437/models?fixture=desktop");
    await page.getByRole("searchbox", { name: "搜索模型" }).fill("不存在");
    const modelState = page.locator('[data-app-state="search"]');
    await modelState.getByText("没有匹配的模型", { exact: true }).waitFor();
    const modelGap = await modelState.evaluate((element) => {
      const input = document.querySelector('input[type="search"]');
      const inputBox = input?.getBoundingClientRect();
      const stateBox = element.getBoundingClientRect();
      return inputBox ? stateBox.top - inputBox.bottom : Number.POSITIVE_INFINITY;
    });
    assert.ok(modelGap >= 0 && modelGap < 160, `模型中心状态距离工具栏 ${modelGap}px`);
    assert.equal(
      await modelState.locator('[data-slot="empty-icon"] svg').count(),
      1,
    );

    // 路由级状态保留应用级导航栏，状态仍整页居中。
    await page.goto("http://localhost:1437/missing?fixture=desktop");
    await page.getByText("这个页面不存在", { exact: true }).waitFor();
    assert.equal(
      await page.locator('[data-slot="library-sidebar"]').count(),
      1,
      "404 页面应保留应用级导航栏",
    );
    const centered = await page
      .locator("main [data-app-state]")
      .first()
      .evaluate((element) => {
        const box = element.getBoundingClientRect();
        const main = element.closest("main")?.getBoundingClientRect();
        if (!main) return false;
        const above = box.top - main.top;
        const below = main.bottom - box.bottom;
        return Math.abs(above - below) < 80;
      });
    assert.equal(centered, true, "404 状态应整页居中");

    // 创建音色的候选面板在没有候选时给出明确空态。
    await page.goto("http://localhost:1437/voices/new?fixture=desktop");
    await page.getByText("还没有候选音色", { exact: true }).waitFor();
    assert.equal(
      await page
        .locator('[data-app-state]')
        .filter({ hasText: "还没有候选音色" })
        .locator('[data-slot="empty-icon"] svg')
        .count(),
      1,
    );
    console.log("PASS collection states stay anchored, route states keep the navigation rail");
  } finally {
    await browser.close();
  }
});
