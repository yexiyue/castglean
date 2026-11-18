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

test("root professional task owns a stop button and disables it while cancelling", async ({ flowBrowser }) => {
  const page = await open(flowBrowser, "stop");
  const stop = page.locator('[data-action="agent-stop"]');
  await expect(stop).toHaveCount(1);
  await expect(stop).toHaveText("停止");
  await stop.click();
  await expect(stop).toHaveText("正在停止");
  await expect(stop).toBeDisabled();
  expect(await page.evaluate(() => window.agentRegression.calls.filter(c => c === "agent_cancel"))).toHaveLength(1);
});
