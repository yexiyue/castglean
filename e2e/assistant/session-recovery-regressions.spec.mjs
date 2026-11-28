import { openRightView } from "../chapter-task.mjs";
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
  const dialog = page.getByRole("dialog", { name: "切换会话" });
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("当前会话")).not.toHaveText("session");
  await switcher.click();
  const search = dialog.getByRole("combobox", { name: "搜索会话" });
  await expect(search).toBeFocused();
  await expect(dialog.getByRole("option", { name: "新建会话", exact: true })).toHaveCount(0);
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

for (const locale of ["zh", "en"]) {
  test(`retry clears the previous execution error and shows a new failure only if it occurs (${locale})`, async ({ page }) => {
    const english = locale === "en";
    if (english) await page.setViewportSize({ width: 380, height: 600 });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`/__agent-session-regressions?scenario=retry&locale=${locale}&theme=${english ? "dark" : "light"}`);
    const retry = page.getByRole("button", { name: english ? "Retry execution" : "重试执行", exact: true });
    const error = page.getByText("请求失败", { exact: true });
    const stop = page.getByRole("button", { name: english ? "Stop generating" : "停止生成", exact: true });
    await expect(error).toBeVisible();
    await retry.click();
    await expect(stop).toBeVisible();
    await expect(error).toBeHidden();
    await expect(retry).toBeHidden();
    await page.evaluate(() => window.agentRegression.finishRetry("failed"));
    await expect(stop).toBeHidden();
    await expect(error).toBeVisible();
    await retry.click();
    await expect(stop).toBeVisible();
    await expect(error).toBeHidden();
    await page.evaluate(() => window.agentRegression.finishRetry("succeeded"));
    await expect(stop).toBeHidden();
    await expect(error).toBeHidden();
    await expect(page.getByText("检查分章", { exact: true })).toHaveCount(1);
    const inputs = await page.evaluate(() =>
      window.agentRegression.submissions.map(({ request }) => request.input),
    );
    expect(inputs).toHaveLength(2);
    expect(inputs[0].forwardedProps).toEqual({ retryRunId: "run" });
    expect(inputs[1].forwardedProps).toEqual({ retryRunId: inputs[0].runId });
    expect(pageErrors).toEqual([]);
  });
}

test("casting approval submits only the selected edited previews", async ({ flowBrowser }) => {
  const page = await open(flowBrowser, "casting");
  await page.setViewportSize({ width: 380, height: 600 });
  const steps = page.getByRole("button", { name: /等待确认试听方案/ });
  await expect(steps).toHaveAttribute("aria-expanded", "false");
  const approve = page.getByRole("button", { name: "批准所选试听" });
  await expect(approve).toBeHidden();
  const returnToAnswer = page.getByRole("button", { name: "返回回答" });
  await returnToAnswer.press("Enter");
  await expect(steps).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("checkbox", { name: "甲" })).toBeFocused();
  const approval = page.getByRole("group", { name: "批准选角试听" });
  const todo = page.locator('[data-slot="todo-list"]');
  await expect(approval).toBeVisible();
  expect((await approval.boundingBox()).y).toBeLessThan((await todo.boundingBox()).y);
  await expect(page.getByRole("checkbox", { name: "甲" })).toBeInViewport();
  await expect(returnToAnswer).toBeInViewport();
  await expect(page.locator('[data-slot="todo-list"] li[data-status="waiting"]')).toContainText("确认试听方案");
  await expect(approve).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "丙" })).toBeDisabled();
  const choice = page.getByRole("checkbox", { name: "甲" });
  const text = page.getByRole("textbox", { name: "甲的试听文本" });
  await expect(approval.getByText("原文甲", { exact: true })).toBeVisible();
  await expect(text).toBeHidden();
  await choice.check();
  await text.fill("获批文本");
  await choice.uncheck();
  await expect(approval.getByText("获批文本", { exact: true })).toBeVisible();
  await choice.check();
  await expect(text).toHaveValue("获批文本");
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
      const steps = page.getByRole("button", { name: english ? /Waiting for preview approval/ : /等待确认试听方案/ });
      await expect(steps).toHaveAttribute("aria-expanded", "false");
      await steps.press("Enter");
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
      await expect(steps).toHaveAttribute("aria-expanded", "false");
      await steps.click();
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

// In-card domain operations: result surfaces render beside the call, outside
// the collapsed tool content, and adopt through the owning domain commands.
async function openDesktop(page, params) {
  await page.goto(`/project/fixture-project?fixture=desktop&analysis=1&${params}`);
}

test("approved casting progress stays beside the original tool call once", async ({ page }) => {
  await openDesktop(page, "agentScenario=casting-card&castingProgress=1");
  await openRightView(page, "assistant");
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  await input.fill("给角色配声音");
  await input.press("Enter");
  const workflow = page.locator('[data-slot="casting-plan"]');
  const toggle = workflow.getByRole("button", { name: /正在生成试听/ });
  await expect(workflow).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  const list = workflow.locator('[data-slot="todo-list"]');
  await expect(list.locator('li[data-status="active"]')).toContainText("已处理 1/3 条试听");
  await expect(list.getByText(/1 条试听未能生成/)).toBeVisible();
  const original = await list.elementHandle();
  await page.evaluate(() => window.fixture.finishCasting());
  await expect(workflow).toHaveCount(1);
  await expect(workflow.getByRole("button", { name: /选角建议已保存/ })).toHaveAttribute("aria-expanded", "true");
  await expect(list.locator('li[data-status="done"]')).toHaveCount(4);
  await expect(list.getByText(/已处理 3\/3 条试听/)).toBeVisible();
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await input.fill("下一条消息");
  await input.press("Enter");
  await expect(page.getByText("已收到下一条消息。")).toBeVisible();
  await expect(workflow).toHaveCount(1);
  await expect(list.getByText(/已处理 3\/3 条试听/)).toBeVisible();
  await page.evaluate(() => window.fixture.resetAgent());
  await expect(workflow).toHaveCount(1);
  const saved = workflow.getByRole("button", { name: /选角建议已保存/ });
  if ((await saved.getAttribute("aria-expanded")) === "false") {
    await saved.click();
  }
  await expect(list.getByText(/已处理 3\/3 条试听/)).toBeVisible();
});

test("casting review adopts a binding inside the card", async ({ page }) => {
  await openDesktop(page, "agentScenario=casting-card");
  await openRightView(page, "assistant");
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  await input.fill("给角色配声音");
  await input.press("Enter");
  const review = page.locator("[data-casting-review]");
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: /旁白/ }).click();
  const adopt = review.getByRole("button", { name: "采用绑定" });
  await adopt.click();
  await expect.poll(() => page.evaluate(() => window.fixture.castWrites)).toBe(1);
  await expect(review.getByRole("button", { name: "当前绑定" })).toBeVisible();
});

test("casting review returns to the assistant beside the character detail", async ({ page }) => {
  await openDesktop(page, "agentScenario=casting-card");
  await page.getByRole("button", { name: "工程角色", exact: true }).click();
  const detail = page.locator('[data-slot="character-detail"]');
  const profile = detail.getByRole("textbox");
  await profile.fill("保留旁白画像草稿");
  await openRightView(page, "assistant");
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  await input.fill("给角色配声音");
  await input.press("Enter");
  await page.getByRole("button", { name: "在角色中心打开" }).click();
  await input.fill("保留助手草稿");
  const back = page.getByRole("button", { name: "返回 AI 助手", exact: true });
  await back.click();
  await expect(back).toBeHidden();
  await expect(profile).toHaveValue("保留旁白画像草稿");
  await expect(input).toHaveValue("保留助手草稿");
});

test("casting card reports an in-place adopt conflict honestly", async ({ page }) => {
  await openDesktop(page, "agentScenario=casting-card&failCastAdopt=1");
  await openRightView(page, "assistant");
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  await input.fill("给角色配声音");
  await input.press("Enter");
  const review = page.locator("[data-casting-review]");
  await review.getByRole("button", { name: /旁白/ }).click();
  await review.getByRole("button", { name: "采用绑定" }).click();
  const conflict = review.getByText("操作未保存，请刷新后重试。已有结果保留。");
  await expect(conflict).toBeVisible();
  await review.getByRole("button", { name: "重新读取结果" }).click();
  await expect(conflict).toBeHidden();
  await expect(review.getByRole("button", { name: "采用绑定" })).toBeEnabled();
});

test("split proposal adopts and recovers in the card without opening the dialog", async ({ page }) => {
  await openDesktop(page, "agentScenario=result&proposalState=pending");
  await openRightView(page, "assistant");
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  await input.fill("检查分章");
  await input.press("Enter");
  const card = page.locator("[data-split-review-card]");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "采用方案" }).click();
  await page.evaluate(() => { window.fixture.loseSplitReply = true; });
  await card.getByRole("button", { name: "确认采用" }).click();
  await expect(card.getByText("结构操作结果尚未确认，原请求已保留。")).toBeVisible();
  const retry = page.getByRole("button", { name: "重试原操作", exact: true });
  await expect(retry).toHaveCount(1);
  await retry.click();
  await expect(card.getByText("已采用", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.fixture.splitWrites)).toBe(1);
  await expect(card.getByRole("button", { name: "打开审阅弹窗调整" })).toBeVisible();
});

test("analysis card retries the same candidate command after a lost response", async ({ page }) => {
  await openDesktop(page, "agentScenario=analysis-result&analysisTaskDelegated=1&candidateState=pending");
  await openRightView(page, "assistant");
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  await input.fill("分析当前章");
  await input.press("Enter");
  const card = page.locator('[data-analysis-review-card="review-candidate"]');
  await expect(card).toHaveCount(1);
  await page.evaluate(() => { window.fixture.failCandidateSave = true; });
  await card.getByRole("button", { name: "采用候选", exact: true }).click();
  const retry = card.getByRole("button", { name: "重试原操作", exact: true });
  await expect(retry).toBeVisible();
  await page.evaluate(() => { window.fixture.failCandidateSave = false; });
  await retry.click();
  await expect(card.getByText("已采用", { exact: true })).toBeVisible();
  const writes = await page.evaluate(() => window.fixture.calls
    .filter(({ command }) => command === "chapter_analysis_candidate_process")
    .map(({ args }) => args));
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0]).toMatchObject({ expectedRevision: 1, selected: ["change-1"] });
});

for (const locale of ["zh", "en"]) {
  test(`context compaction keeps chat and uses a message-free action (${locale})`, async ({ page }) => {
    const english = locale === "en";
    await page.setViewportSize({ width: 1024, height: 680 });
    await openDesktop(page, `agentScenario=result&locale=${locale}&theme=${english ? "dark" : "light"}`);
    await openRightView(page, "assistant");
    const input = page.getByRole("textbox", { name: english ? "Project question or additional details" : "工程问题或补充说明" });
    await input.fill("检查分章");
    await input.press("Enter");
    await expect(page.locator("[data-split-review-card]")).toBeVisible();
    await input.fill("未发送的草稿");
    const usage = page.getByRole("button", { name: english ? "Context usage" : "上下文用量" });
    await usage.focus();
    await usage.press("Enter");
    const compact = page.getByRole("button", { name: english ? "Compact context" : "压缩上下文", exact: true });
    await expect(compact).toBeEnabled();
    await compact.click();
    await expect(page.getByText(english ? "Older turns were compacted. The full chat is still available." : "旧轮次已压缩，完整聊天记录仍可查看。")).toBeVisible();
    await expect(input).toHaveValue("未发送的草稿");
    await expect(page.locator("[data-split-review-card]")).toBeVisible();
    const requests = await page.evaluate(() => window.fixture.calls
      .filter(({ command }) => command === "agent_start")
      .map(({ args }) => args.request.input));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ messages: [], forwardedProps: { compact: true } });
  });
}
