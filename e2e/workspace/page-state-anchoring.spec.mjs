import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { chapterTask, openRightView } from "../chapter-task.mjs";
import { test } from "../managed-browser.mjs";

test("page-state-anchoring", async ({ flowBrowser: browser }) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(15000);
  try {
    async function assertCentered(state, minimumHeight = 120) {
      await state.waitFor();
      const geometry = () => state.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const first = element.firstElementChild.getBoundingClientRect();
        const last = element.lastElementChild.getBoundingClientRect();
        return { height: bounds.height, delta: Math.abs((first.top + last.bottom - bounds.top - bounds.bottom) / 2) };
      });
      await expect.poll(async () => (await geometry()).height, { message: "空态区域高度" }).toBeGreaterThanOrEqual(minimumHeight);
      await expect.poll(async () => (await geometry()).delta, { message: "内容偏离垂直中心" }).toBeLessThan(2);
      assert.equal(await state.locator('[data-slot="empty-icon"] svg').count(), 1);
    }

    await page.goto("http://localhost:1437/voices?fixture=desktop");
    const search = page.getByRole("searchbox", { name: "搜索预置音色" });
    await search.fill("不存在");
    const voiceState = page.locator('[data-app-state="search"]').filter({ hasText: "没有匹配的音色" });
    await assertCentered(voiceState, 350);
    assert.ok((await voiceState.boundingBox()).y >= (await search.boundingBox()).y + (await search.boundingBox()).height);
    await voiceState.getByRole("button", { name: "清除搜索" }).click();
    await voiceState.waitFor({ state: "hidden" });

    await page.goto("http://localhost:1437/models?fixture=desktop");
    await page.getByRole("searchbox", { name: "搜索模型" }).fill("不存在");
    const modelState = page.locator('[data-app-state="search"]').filter({ hasText: "没有匹配的模型" });
    await assertCentered(modelState, 350);
    assert.equal(await page.locator('[class*="resource-model-columns"]:visible').count(), 0);

    await page.goto("http://localhost:1437/?fixture=desktop&empty=1&onboardingCompleted=1");
    await assertCentered(page.locator('[data-app-state="empty"]').filter({ hasText: "还没有工程" }), 350);
    await page.getByRole("button", { name: "全局搜索", exact: true }).click();
    const projectSearch = page.getByRole("dialog", { name: "全局搜索" });
    await projectSearch.getByRole("combobox").fill("不存在的工程");
    await assertCentered(projectSearch.locator('[data-app-state="search"]'));

    await page.goto("http://localhost:1437/voices?fixture=desktop&library=mine&empty=1");
    await assertCentered(page.locator('[data-app-state="empty"]').filter({ hasText: "还没有自己的音色" }), 350);
    assert.equal(await page.getByRole("button", { name: "导入音色包", exact: true }).count(), 1);

    await page.goto("http://localhost:1437/voices?fixture=desktop&library=mine");
    const openVoice = page.getByRole("button", { name: "查看音色「山风」" });
    await openVoice.click();
    const voice = page.getByRole("dialog", { name: "山风" });
    await voice.locator('[data-app-state="empty"]').getByText("暂无工程绑定此音色。").waitFor();
    await page.keyboard.press("Escape");
    await voice.waitFor({ state: "hidden" });
    await page.evaluate(() => {
      const ipc = window.__TAURI_INTERNALS__;
      const invoke = ipc.invoke;
      ipc.invoke = (name, ...args) =>
        name === "voice_binding_references"
          ? Promise.reject("read_failed")
          : invoke.call(ipc, name, ...args);
    });
    await openVoice.click();
    await voice.getByRole("alert").getByText("无法读取工程引用", { exact: true }).waitFor();
    assert.equal(await voice.getByText("暂无工程绑定此音色。").count(), 0);

    await page.setViewportSize({ width: 900, height: 680 });
    await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&locale=en&theme=dark");
    await openRightView(page, "inspector");
    const inspectorState = page.locator('[data-app-state="empty"]').filter({ hasText: "Select a passage" });
    await assertCentered(inspectorState, 350);
    assert.equal(await inspectorState.innerText(), "Select a passage");
    const projectRoute = "http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&audio=1&locale=zh";
    await page.goto(projectRoute);
    await (await chapterTask(page, "分析本章角色")).click();
    await page.locator("[data-segment-id]").first().waitFor();
    await page.getByRole("button", { name: "本章音频设置", exact: true }).click();
    const audioSettings = page.getByRole("dialog", { name: "本章音频设置" });
    assert.equal(await audioSettings.locator('[data-slot="separator"]').count(), 0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "工程角色", exact: true }).click();
    const directory = page.locator('[data-slot="character-directory"]');
    await directory.getByRole("searchbox", { name: "搜索角色" }).fill("不存在");
    const roles = directory.locator('[data-app-state="search"]');
    await assertCentered(roles, 64);
    assert.equal(await directory.locator("div.border-t").count(), 0);
    await page.setViewportSize({ width: 1200, height: 800 });

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

    // 候选为空时按当前入口引导，录音方式不显示设计引擎提示。
    await page.goto("http://localhost:1437/voices/new?fixture=desktop&empty=1");
    const candidates = page.locator('[data-app-state="empty"]').filter({ hasText: "还没有候选音色" });
    await assertCentered(candidates, 260);
    await page.getByText("参考录音", { exact: true }).click();
    await page.getByRole("button", { name: "选择参考 WAV", exact: true }).waitFor();
    assert.equal(await candidates.getByText(/用左侧的设计引擎/).count(), 0);
    console.log("PASS empty and search states are centered within the available content, with route chrome intact");
  } finally {
    await browser.close();
  }
});
