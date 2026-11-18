import { expect } from "@playwright/test";
import { test } from "../managed-browser.mjs";

async function open(browser, scenario) {
  const page = await browser.newPage();
  await page.goto(`http://localhost:1437/__agent-session-regressions?scenario=${scenario}`);
  await expect(page.getByLabel("当前会话")).toHaveText("session");
  return page;
}

test("an empty unsaved conversation keeps the sole saved conversation reachable", async ({ flowBrowser }) => {
  const page = await open(flowBrowser, "history");
  const switcher = page.getByRole("button", { name: "切换会话", exact: true });
  await switcher.click();
  await page.getByRole("option", { name: "新建会话", exact: true }).click();
  await expect(page.getByLabel("当前会话")).not.toHaveText("session");
  await switcher.click();
  const search = page.getByRole("combobox", { name: "搜索会话" });
  await expect(search).toBeFocused();
  await search.fill("无匹配结果");
  await expect(page.getByText("未找到会话")).toBeVisible();
  await search.fill("已有");
  await expect(page.getByRole("option", { name: "已有会话", exact: true })).toBeVisible();
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page.getByRole("dialog", { name: "切换会话" })).toBeHidden();
  await expect(switcher).toBeFocused();
  await expect(page.getByLabel("当前会话")).toHaveText("session");
  expect(await page.evaluate(() => window.agentRegression.calls.filter(c => c === "agent_start"))).toEqual([]);
});

test("abandoning an unaccepted answer rebuilds authoritative interrupts and preserves its draft", async ({ flowBrowser }) => {
  const page = await open(flowBrowser, "interrupt");
  const answer = page.getByRole("textbox", { name: "请补充章节范围" });
  const submit = page.getByRole("button", { name: "提交回答并继续任务" });
  await expect(submit).toBeEnabled();
  await answer.fill("第一至第三章");
  await submit.click();
  await page.getByRole("button", { name: "核对原请求", exact: true }).click();
  await page.getByRole("button", { name: "再次核对后停止恢复" }).click();
  await page.getByRole("button", { name: "我已了解" }).click();
  await expect(answer).toHaveValue("第一至第三章");
  await expect(submit).toBeEnabled();
  const calls = await page.evaluate(() => window.agentRegression.calls);
  expect(calls.filter(c => c === "agent_start")).toHaveLength(1);
  expect(calls.filter(c => c === "agent_history")).toHaveLength(2);
  expect(calls.filter(c => c === "agent_subscribe")).toHaveLength(2);
  expect(calls).not.toContain("agent_cancel");
});

test("a root professional task stops from the composer toolbar", async ({ flowBrowser }) => {
  const page = await open(flowBrowser, "stop");
  await page.setViewportSize({ width: 340, height: 600 });
  const stop = page.locator('[data-action="agent-stop"]');
  await expect(stop).toHaveCount(1);
  await expect(page.locator("[data-composer-toolbar]").locator(stop)).toBeVisible();
  await expect(stop).toHaveAccessibleName("停止生成");
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(send).toHaveCount(0);
  const stopPosition = await stop.boundingBox();
  await stop.click();
  await expect(stop).toHaveAccessibleName("正在停止");
  await expect(stop).toBeDisabled();
  expect(await page.evaluate(() => window.agentRegression.calls.filter(c => c === "agent_cancel"))).toHaveLength(1);
  await page.evaluate(() => window.agentRegression.finishCancellation());
  await expect(stop).toHaveCount(0);
  await expect(send).toBeVisible();
  expect(await send.boundingBox()).toEqual(stopPosition);
});

test("casting approval submits only the selected edited previews", async ({ flowBrowser }) => {
  const page = await open(flowBrowser, "casting");
  await page.setViewportSize({ width: 380, height: 600 });
  const approve = page.getByRole("button", { name: "批准所选试听" });
  await expect(approve).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "丙" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "甲" }).check();
  await page.getByRole("textbox", { name: "甲的试听文本" }).fill("获批文本");
  await approve.click();
  await expect.poll(() => page.evaluate(() => window.agentRegression.submissions)).toEqual([
    expect.objectContaining({
      request: expect.objectContaining({
        input: expect.objectContaining({
          resume: [{ interruptId: "casting-question", status: "resolved", payload: { decision: "approve", items: [{ id: "one", text: "获批文本" }] } }],
        }),
      }),
    }),
  ]);
});

for (const locale of ["zh", "en"]) {
  for (const theme of ["light", "dark"]) {
    test(`casting approval remains usable at narrow width in ${locale} ${theme}`, async ({ flowBrowser }) => {
      const page = await open(flowBrowser, `casting&locale=${locale}&theme=${theme}`);
      await page.setViewportSize({ width: 380, height: 600 });
      const english = locale === "en";
      const approve = page.getByRole("button", {
        name: english ? "Approve selected previews" : "批准所选试听",
      });
      await expect(approve).toBeDisabled();
      const target = page.getByRole("checkbox", { name: "甲" });
      await target.focus();
      await target.press("Space");
      await expect(target).toBeChecked();
      await expect(approve).toBeEnabled();
      await page.reload();
      const unavailable = page.getByRole("checkbox", { name: "丙" });
      await expect(unavailable).toBeDisabled();
      const reject = page.getByRole("button", {
        name: english ? "Reject preview plan" : "拒绝试听计划",
      });
      await expect(reject).toBeEnabled();
      await reject.click();
      await expect.poll(() => page.evaluate(() => window.agentRegression.submissions)).toEqual([
        expect.objectContaining({
          request: expect.objectContaining({
            input: expect.objectContaining({
              resume: [{ interruptId: "casting-question", status: "resolved", payload: { decision: "reject", feedback: "" } }],
            }),
          }),
        }),
      ]);
    });
  }
}
