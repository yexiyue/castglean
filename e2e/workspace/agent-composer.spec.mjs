import { openRightView, rightPanelToggle } from "../chapter-task.mjs";
import { expect, test } from "@playwright/test";

const projectUrl = "/project/fixture-project?fixture=desktop&analysis=1";

test("Enter sends a multiline draft once and leaves IME confirmation alone", async ({ page }) => {
  await page.goto(projectUrl);
  await openRightView(page, "assistant");
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  await expect(input).toBeVisible();
  await input.fill("第一行");
  await input.press("End");
  await input.press("Shift+Enter");
  await page.keyboard.insertText("第二行");
  await expect(input).toHaveValue("第一行\n第二行");
  await input.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true }));
  });
  const starts = () => page.evaluate(() => window.fixture.calls.filter((call) => call.command === "agent_start"));
  expect(await starts()).toHaveLength(0);
  await input.press("Enter");
  await expect.poll(starts).toHaveLength(1);
  expect((await starts())[0].args.request.input.messages.at(-1).content).toBe("第一行\n第二行");
  await expect(input).toHaveValue("");
  const viewport = page.getByRole("log");
  await expect(viewport.getByText("这是解释建议，没有修改已保存分析。")).toBeVisible();
  const composer = input.locator("xpath=ancestor::form");
  const toolbar = composer.locator("[data-composer-toolbar]");
  const [scrollArea, inputBox, toolbarBox, message] = await Promise.all([
    viewport.boundingBox(),
    composer.boundingBox(),
    toolbar.boundingBox(),
    viewport.getByText("这是解释建议，没有修改已保存分析。").boundingBox(),
  ]);
  const trackInset = await viewport.evaluate((el) =>
    parseFloat(getComputedStyle(el).getPropertyValue("--thread-scrollbar-end")),
  );
  expect(trackInset).toBeGreaterThan(0);
  expect(Math.abs(scrollArea.y + scrollArea.height - trackInset - toolbarBox.y)).toBeLessThan(1);
  expect(message.y + message.height).toBeLessThanOrEqual(inputBox.y + 1);
  expect(await page.evaluate(() => {
    const scrollbarWidth = (element) => getComputedStyle(element, "::-webkit-scrollbar").width;
    return [scrollbarWidth(document.querySelector('[role="log"]')), scrollbarWidth(document.querySelector('[data-slot="source-scroll"]'))];
  })).toEqual(["8px", "8px"]);
  await expect(viewport.locator(".aui-thread-viewport-footer")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("the draft includes only the source excerpt explicitly quoted", async ({ page }) => {
  await page.goto(projectUrl);
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  const reference = page.locator('[data-slot="composer-reference"]');
  await openRightView(page, "assistant");
  await expect(page.getByText(/下次发送上下文/)).toHaveCount(0);
  await expect(reference).toHaveCount(0);
  const addReference = async () => {
    await page.locator('[data-slot="source-scroll"] [data-source-line]').nth(1).evaluate((line) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.getByRole("button", { name: "引用选中的原文" }).click();
    await expect(input.locator("xpath=ancestor::form").locator(reference)).toBeVisible();
    await expect(input).toBeFocused();
  };
  await addReference();
  await page.getByRole("button", { name: "移除原文引用" }).click();
  await expect(reference).toHaveCount(0);
  await addReference();
  await input.fill("这段是什么意思？");
  await input.press("Enter");
  await expect(reference).toHaveCount(0);
  const request = await page.evaluate(() => window.fixture.calls.find((call) => call.command === "agent_start").args.request);
  expect(request.input.messages.at(-1).content).toContain("阿岚说：“我们走吧。”");
});

test("context breakdown shows capacity only for reported usage", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await page.goto(`${projectUrl}&locale=en&theme=dark`);
  await openRightView(page, "assistant");
  const trigger = page.getByRole("button", { name: "Context usage", exact: true });
  const usage = page.getByRole("dialog", { name: "Context window" });
  const model = page.getByRole("combobox", { name: "Model for the next request" });
  await model.press("ArrowDown");
  await expect(page.getByRole("option", { selected: true })).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search models", exact: true });
  await expect(search).toBeFocused();
  await search.fill("missing-model");
  await expect(page.getByText("No matching models", { exact: true })).toBeVisible();
  await search.fill("合成");
  await expect(page.getByRole("option", { selected: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(model).toBeFocused();
  await trigger.hover();
  await expect(usage.getByText(/No provider usage report yet/)).toBeVisible();
  await expect(usage.getByRole("meter")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(usage).toBeHidden();
  const input = page.getByRole("textbox", { name: "Project question or additional details" });
  await input.fill("Check the chapter.");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await trigger.press("Enter");
  await expect(usage.getByRole("meter")).toHaveAttribute("aria-valuetext", "150 / 8,192");
  await expect(usage.getByText("Remaining capacity")).toBeVisible();
  await expect(usage.getByText("8,042", { exact: true })).toBeVisible();
  const segments = usage.locator('[data-slot="context-breakdown"] > span');
  expect(await segments.evaluateAll((nodes) => nodes.map((node) => Number.parseFloat(node.style.width)))).toEqual([
    expect.closeTo(100 / 8192 * 100),
    expect.closeTo(50 / 8192 * 100),
  ]);
});

for (const [locale, theme, labels] of [
  ["zh", "light", ["调整右侧面板宽度", "AI 助手与检查器", "下次请求使用的模型", "思考强度", "发送"]],
  ["en", "dark", ["Resize right panel", "AI assistant and inspector", "Model for the next request", "Reasoning effort", "Send"]],
]) {
  test(`assistant toolbar and right panel resize (${locale}, ${theme})`, async ({ page }, testInfo) => {
    const [resize, pane, model, effort, send] = labels;
    await page.setViewportSize({ width: 1240, height: 800 });
    await page.goto(`${projectUrl}&locale=${locale}&theme=${theme}`);
    await openRightView(page, "assistant");
    const panel = page.getByRole("complementary", { name: pane });
    const color = (selector) => page.locator(selector).evaluate((element) => getComputedStyle(element).backgroundColor);
    const chrome = await color('[data-slot="desktop-bar"]');
    expect(await color('[data-slot="project-workspace"]')).toBe(chrome);
    expect(await color('[data-slot="project-workspace"] [data-slot="sidebar"]')).toBe(chrome);
    expect(await color(".aui-thread-root")).toBe(await color('[data-slot="project-workspace-surface"]'));
    const splitter = page.getByRole("separator", { name: resize });
    const controls = [panel.getByRole("combobox", { name: model, exact: true }), ...[effort, send].map((name) => panel.getByRole("button", { name, exact: true }))];
    const checkToolbar = async () => {
      const bounds = await Promise.all(controls.map((button) => button.boundingBox()));
      const rowCenter = (rect) => rect.y + rect.height / 2;
      expect(Math.abs(rowCenter(bounds[0]) - rowCenter(bounds[1]))).toBeLessThan(2);
      expect(Math.abs(rowCenter(bounds[1]) - rowCenter(bounds[2]))).toBeLessThan(2);
      expect(bounds[0].x + bounds[0].width).toBeLessThan(bounds[1].x);
    };
    await checkToolbar();
    const handle = await splitter.boundingBox();
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 96, y, { steps: 6 });
    await page.mouse.up();
    await expect(splitter).toHaveAttribute("aria-valuenow", "416");
    expect((await panel.boundingBox()).width).toBe(416);
    await splitter.press("ArrowRight");
    await expect(splitter).toHaveAttribute("aria-valuenow", "400");
    await page.setViewportSize({ width: 1024, height: 680 });
    await checkToolbar();
    await page.screenshot({ path: testInfo.outputPath("agent-composer.png") });
    await splitter.press("End");
    expect((await panel.boundingBox()).width).toBeLessThanOrEqual(640);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  });
}

for (const [locale, theme, platform] of [
  ["zh", "light", "macos"],
  ["en", "light", "windows"],
  ["zh", "dark", "windows"],
  ["en", "dark", "macos"],
]) {
  test(`1024px assistant chrome, commands and reopening (${locale}, ${theme}, ${platform})`, async ({ page }, testInfo) => {
    const en = locale === "en";
    await page.setViewportSize({ width: 1024, height: 680 });
    await page.goto(`${projectUrl}&locale=${locale}&theme=${theme}&platform=${platform}&longAssistantReply=1`);
    const top = page.locator('[data-slot="desktop-bar"]');
    const rail = top.locator('[data-slot="assistant-header"]');
    const toggle = rightPanelToggle(page);
    const panel = page.getByRole("complementary", { name: en ? "AI assistant and inspector" : "AI 助手与检查器" });
    const input = panel.getByRole("textbox", { name: en ? "Project question or additional details" : "工程问题或补充说明" });
    const send = panel.getByRole("button", { name: en ? "Send" : "发送", exact: true });
    const header = panel.locator("header");
    const tabs = header.getByRole("tablist");
    const assistant = tabs.getByRole("tab", { name: en ? "AI assistant" : "AI 助手", exact: true });
    const inspector = tabs.getByRole("tab", { name: en ? "Clip properties" : "片段属性", exact: true });
    const session = header.getByRole("button", { name: en ? "Switch conversation" : "切换会话", exact: true });
    const newSessionLabel = en ? "New conversation" : "新建会话";
    const newSession = header.getByRole("button", { name: newSessionLabel, exact: true });
    const sessionDialog = page.getByRole("dialog", { name: en ? "Switch conversation" : "切换会话" });
    const history = header.getByRole("button", { name: en ? "Analysis versions" : "分析版本历史", exact: true });
    await expect(rail.getByRole("button")).toHaveCount(1);
    await expect(inspector).toHaveAttribute("aria-selected", "true");
    const checkHeader = async (firstAction, lastAction = firstAction) => {
      const [tabBox, firstBox, lastBox, headerBox] = await Promise.all(
        [tabs, firstAction, lastAction, header].map((locator) => locator.boundingBox()),
      );
      expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(firstBox.x);
      expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width);
      expect(await header.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(headerBox.width);
    };
    await checkHeader(history, header.getByRole("button", { name: en ? "Characters" : "角色", exact: true }));
    await expect(tabs).toHaveText("");
    const tooltip = page.locator('[data-slot="tooltip-content"][data-open]');
    await inspector.hover();
    await expect(tooltip).toHaveText(en ? "Clip properties" : "片段属性");
    await expect(tooltip).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("right-tab-tooltip-1024.png"), animations: "disabled" });
    await page.mouse.move(0, 0);
    await inspector.press("ArrowLeft");
    await expect(assistant).toBeFocused();
    await expect(tooltip).toHaveText(en ? "AI assistant" : "AI 助手");
    await assistant.press("Enter");
    await expect(assistant).toHaveAttribute("aria-selected", "true");
    await expect(history).toHaveCount(0);
    await checkHeader(newSession, session);

    if (platform === "windows") {
      const controls = top.getByRole("group", { name: en ? "Window controls" : "窗口控制" });
      await expect(controls).toBeVisible();
      const toggleBox = await toggle.boundingBox();
      expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual((await controls.boundingBox()).x);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);
    await session.click();
    await expect(sessionDialog).toBeVisible();
    await expect(sessionDialog.getByRole("option", { name: newSessionLabel, exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(session).toBeFocused();

    // Populate real conversation overflow through the normal composer.
    await input.fill("阅读合成样本");
    await send.click();
    await expect(input).toHaveValue("");
    await expect(panel.getByRole("log").getByText("Reading sample 32", { exact: true })).toBeVisible();

    await input.fill("Keep this draft\n/");
    const tasks = page.getByRole("listbox", { name: en ? "Chapter tasks" : "章节任务" });
    await expect(tasks.getByRole("option")).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath("assistant-1024-commands.png"), animations: "disabled" });
    await input.press("Escape");
    await expect(tasks).toBeHidden();
    await expect(input).toHaveValue("Keep this draft\n/");
    await input.fill("Keep this draft\n/split");
    await expect(tasks.getByRole("option")).toHaveCount(1);
    await input.press("Tab");
    await expect(input).not.toBeFocused();
    await expect(tasks).toBeHidden();
    await expect(input).toHaveValue("Keep this draft\n/split");

    const draftPrefix = "Keep this draft\n";
    await input.fill(`${draftPrefix} continued`);
    await input.evaluate((element, cursor) => element.setSelectionRange(cursor, cursor), draftPrefix.length);
    await page.keyboard.insertText("/split");
    await expect(tasks.getByRole("option")).toHaveCount(1);
    await expect(tasks.getByRole("option")).toContainText(en ? "Check chapters" : "检查分章");
    await input.press("Enter");
    await expect(input).toHaveValue("Keep this draft\n continued");
    await expect.poll(() => page.evaluate(() => window.fixture.calls
      .filter(({ command }) => command === "agent_start")
      .map(({ args }) => args.request.workspaceContext.action),
    )).toEqual(["auto", "split"]);
    await expect(panel.getByRole("log").getByText("已生成分章候选，等待审阅。")).toBeVisible();

    const viewport = panel.getByRole("log");
    await viewport.evaluate((element) => element.scrollTo({ top: 120, behavior: "instant" }));
    const scroll = () => viewport.evaluate((element) => ({
      top: element.scrollTop,
      remaining: element.scrollHeight - element.clientHeight - element.scrollTop,
    }));
    await expect.poll(async () => (await scroll()).remaining).toBeGreaterThan(100);
    await expect.poll(async () => (await scroll()).top).toBe(120);
    const before = await scroll();
    const column = page.locator(".workspace-pane").filter({ has: page.locator("[data-assistant-composer]") });
    const columnWidth = await column.evaluate((element) => getComputedStyle(element).width);
    const expectDraftAndScroll = async () => {
      await expect(input).toHaveValue("Keep this draft\n continued");
      expect(Math.abs((await scroll()).top - before.top)).toBeLessThanOrEqual(1);
    };

    await inspector.click();
    await expect(inspector).toHaveAttribute("aria-selected", "true");
    await expect(input).toBeHidden();
    await expect(session).toHaveCount(0);
    await checkHeader(history);
    await page.screenshot({ path: testInfo.outputPath("inspector-1024.png"), animations: "disabled" });
    await toggle.click();
    await expect(column).toHaveCSS("width", "0px");
    await toggle.click();
    await expect(column).toHaveCSS("width", columnWidth);
    await expect(inspector).toHaveAttribute("aria-selected", "true");

    await assistant.click();
    await expectDraftAndScroll();
    await toggle.click();
    await expect(column).toHaveCSS("width", "0px");
    await expect(session).toHaveCount(0);
    await toggle.click();
    await expect(column).toHaveCSS("width", columnWidth);
    await expect(assistant).toHaveAttribute("aria-selected", "true");
    await expectDraftAndScroll();

    await newSession.click();
    await expect(sessionDialog).toBeHidden();
    await expect(input).toHaveValue("");
    await session.click();
    await sessionDialog.getByRole("option").first().click();
    await expect(sessionDialog).toBeHidden();
    await expect(input).toHaveValue("Keep this draft\n continued");
  });
}
