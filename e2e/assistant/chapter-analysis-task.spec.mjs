import { expect, test } from "@playwright/test";
import { chapterTask } from "../chapter-task.mjs";

for (const delegated of [false, true]) {
  test(`chapter analysis progress belongs to its ${delegated ? "delegated" : "direct"} invocation`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 720 });
    await page.goto(`/project/fixture-project?fixture=desktop&analysis=1&agentScenario=running&analysisTaskReasoning=1&analysisTaskReview=1&analysisTaskDuplicate=1${delegated ? "&analysisTaskDelegated=1&analysisTaskSaving=1" : ""}`);
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    if (delegated) {
      const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
      await input.fill("分析当前章");
      await input.press("Enter");
    } else {
      await (await chapterTask(page, "分析本章角色")).click();
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
    await expect(card.getByText("合成任务说明，已有内容保留。", { exact: true })).toBeVisible();
    await expect(card.locator('[data-slot="thinking-indicator"]').first()).toBeVisible();
    const thinking = card.locator('[data-slot="reasoning-trigger"]').first();
    await expect(thinking).toHaveAttribute("aria-expanded", "false");
    await thinking.click();
    await expect(card.getByText("按段落核对旁白和台词。", { exact: true })).toBeVisible();
    await expect(log.getByText("提交分析结果", { exact: true })).toBeHidden();
    const tools = card.locator('[data-slot="tool-group-trigger"]').last();
    await tools.click();
    await expect(card.getByText("提交分析结果", { exact: true })).toBeVisible();
    await expect(log.getByText("提交分析结果", { exact: true })).toHaveCount(1);
    await tools.click();
    await expect(log.getByText("提交分析结果", { exact: true })).toBeHidden();
    const title = await card.getAttribute("aria-label");
    await page.getByRole("treeitem", { name: /第2章 山雨/ }).click();
    await expect(card).toHaveAttribute("aria-label", title);
  });
}

test("a delegated analysis keeps its saved result outside the transcript", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 700 });
  await page.goto("/project/fixture-project?fixture=desktop&analysis=1&agentScenario=analysis-result&analysisTaskDelegated=1&analysisOverwrite=1&locale=en&theme=dark");
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Project question or additional details" });
  await input.fill("Analyze the current chapter.");
  await input.press("Enter");
  const card = page.locator("[data-analysis-subagent]");
  await expect(card).toHaveCount(1);
  await expect(card.getByText("合成任务说明，已有内容保留。", { exact: true })).toBeVisible();
  await expect(card.getByText("Analysis saved. It updated manual attributions. You can undo this change.")).toBeVisible();
  await card.getByRole("button", { name: "View speaker assignments", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Type", exact: true })).toHaveValue("speech");
  await expect(page.getByRole("region", { name: "Source reader" }).locator("mark")).toContainText("我们走吧");
});
