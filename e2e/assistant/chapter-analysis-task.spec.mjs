import { expect, test } from "@playwright/test";
import { chapterTask } from "../chapter-task.mjs";

for (const delegated of [false, true]) {
  test(`chapter analysis progress belongs to its ${delegated ? "delegated" : "direct"} invocation`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 720 });
    await page.goto(`/project/fixture-project?fixture=desktop&analysis=1&agentScenario=running&analysisTaskReview=1&analysisTaskDuplicate=1${delegated ? "&analysisTaskDelegated=1&analysisTaskSaving=1" : ""}`);
    await page.getByRole("button", { name: "返回 AI 助手", exact: true }).click();
    if (delegated) {
      const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
      await input.fill("分析当前章");
      await input.press("Enter");
    } else {
      await (await chapterTask(page, "分析本章")).click();
    }
    const card = page.locator("[data-analysis-subagent]");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(delegated ? "正在保存分析结果…" : "正在预审");
    await expect(card).toContainText(delegated ? "已完成 3 / 3 个原文窗口" : "已完成 1 / 3 个原文窗口");
    const runId = await card.getAttribute("data-analysis-run");
    const subagentRunId = await card.getAttribute("data-analysis-subagent");
    expect(subagentRunId).toBe(`task-${runId}`);
    const reads = await page.evaluate(() =>
      window.fixture.calls.filter(({ command }) => command === "chapter_analysis_progress").map(({ args }) => args),
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((args) => args.runId === runId && args.subagentRunId === subagentRunId)).toBe(true);
    const log = page.getByRole("log");
    await expect(log.getByText(/上下文 ·|提交分析结果/)).toHaveCount(0);
    await expect(log.locator('[data-slot="tool-group-trigger"]')).toHaveCount(0);
    await card.getByRole("button").first().click();
    await expect(card.getByText("提交分析结果", { exact: true })).toBeVisible();
    await expect(log.getByText("提交分析结果", { exact: true })).toHaveCount(1);
    await card.getByRole("button").first().click();
    await expect(log.getByText("提交分析结果", { exact: true })).toHaveCount(0);
    const title = await card.getByRole("button").first().innerText();
    await page.getByRole("treeitem", { name: /第2章 山雨/ }).click();
    await expect(card.getByRole("button").first()).toHaveText(title);
  });
}

test("a delegated analysis keeps its saved result outside the transcript", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 700 });
  await page.goto("/project/fixture-project?fixture=desktop&analysis=1&agentScenario=analysis-result&analysisTaskDelegated=1&locale=en&theme=dark");
  await page.getByRole("button", { name: "Back to AI assistant", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Project question or additional details" });
  await input.fill("Analyze the current chapter.");
  await input.press("Enter");
  const card = page.locator("[data-analysis-subagent]");
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("status", { name: "" }).filter({ hasText: "Analysis results saved" })).toBeVisible();
  await expect(card.locator('[data-slot="task-card-transcript"]')).toHaveCount(0);
  await card.getByRole("button", { name: "View result and review status", exact: true }).click();
  await expect(page.locator("[data-segment-id]").first()).toBeVisible();
});
