import { expect, test } from "@playwright/test";

const projectUrl = "/project/fixture-project?fixture=desktop&analysis=1";

test("Enter sends a multiline draft once and leaves IME confirmation alone", async ({ page }) => {
  await page.goto(projectUrl);
  await page.getByRole("button", { name: "返回 AI 助手" }).click();
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
  expect((await viewport.boundingBox()).y + (await viewport.boundingBox()).height).toBeLessThanOrEqual((await composer.boundingBox()).y + 1);
  await expect(composer.locator("..")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("the draft includes only the source excerpt explicitly quoted", async ({ page }) => {
  await page.goto(projectUrl);
  const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
  const reference = page.locator('[data-slot="composer-reference"]');
  await page.getByRole("button", { name: "返回 AI 助手" }).click();
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
  await page.getByRole("button", { name: "Back to AI assistant" }).click();
  const trigger = page.getByRole("button", { name: "Context usage", exact: true });
  const usage = page.getByRole("dialog", { name: "Context window" });
  const model = page.getByRole("button", { name: "Model for the next request" });
  await model.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { checked: true })).toBeVisible();
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
  ["zh", "light", ["返回 AI 助手", "调整右侧面板宽度", "AI 助手与检查器", "下次请求使用的模型", "思考强度", "发送"]],
  ["en", "dark", ["Back to AI assistant", "Resize right panel", "AI assistant and inspector", "Model for the next request", "Reasoning effort", "Send"]],
]) {
  test(`assistant toolbar and right panel resize (${locale}, ${theme})`, async ({ page }, testInfo) => {
    const [open, resize, pane, model, effort, send] = labels;
    await page.setViewportSize({ width: 1240, height: 800 });
    await page.goto(`${projectUrl}&locale=${locale}&theme=${theme}`);
    await page.getByRole("button", { name: open }).click();
    const panel = page.getByRole("complementary", { name: pane });
    const splitter = page.getByRole("separator", { name: resize });
    const controls = [model, effort, send].map((name) => panel.getByRole("button", { name, exact: true }));
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
