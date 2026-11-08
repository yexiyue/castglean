import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1");
  const input = page.getByRole("textbox", { name: "工程问题或补充说明", exact: true });
  await input.fill("保留这份草稿");
  const split = page.getByRole("button", { name: "检查分章", exact: true });
  const requests = () => page.evaluate(() => window.fixture.calls.filter(call => call.command === "ai_start").map(call => call.args.request));
  await split.click();
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "ai_start"));
  await page.getByRole("log").getByText("已生成分章候选，等待审阅。", { exact: true }).waitFor();
  async function changeConfiguration(revision) {
    await page.evaluate(async revision => {
      const hook = performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname === "/src/hooks/use-llm-connections.ts");
      const { publishLlmSnapshot } = await import(hook?.name ?? "/src/hooks/use-llm-connections.ts");
      publishLlmSnapshot({ connections: [{ id: "test", name: "变更后的服务", revision, protocol: "openai", endpoint: "https://example.invalid", hasKey: false, probes: [], models: [{ id: "replacement", modelId: "replacement", name: "替代模型", contextWindow: null, maxOutputTokens: null }, { id: "explicit", modelId: "explicit", name: "手选模型", contextWindow: null, maxOutputTokens: null }] }], defaultModel: { connectionId: "test", modelId: "replacement" }, cleanupRequired: false });
    }, revision);
  }
  await changeConfiguration(2);
  const confirm = page.getByRole("button", { name: "确认使用", exact: true });
  await confirm.waitFor();
  assert.equal(await split.isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "发送", exact: true }).isDisabled(), true);
  assert.equal((await requests()).length, 1);
  assert.equal(await input.inputValue(), "保留这份草稿");
  await confirm.click();
  await split.click();
  await page.waitForFunction(() => window.fixture.calls.filter(call => call.command === "ai_start").length === 2);
  assert.equal((await requests()).at(-1).confirmRebind, true);
  assert.equal((await requests()).at(-1).configuration.revision, 2);
  assert.equal((await requests()).at(-1).configuration.selection.modelId, "replacement");
  await changeConfiguration(3);
  await confirm.waitFor();
  assert.equal(await split.isDisabled(), true);
  await page.getByRole("combobox", { name: "下次请求使用的模型", exact: true }).selectOption(JSON.stringify(["test", "explicit"]));
  await split.click();
  await page.waitForFunction(() => window.fixture.calls.filter(call => call.command === "ai_start").length === 3);
  const last = (await requests()).at(-1);
  assert.equal(last.confirmRebind, true);
  assert.equal(last.configuration.revision, 3);
  assert.equal(last.configuration.selection.modelId, "explicit");
  assert.equal(await input.inputValue(), "保留这份草稿");
  assert.deepEqual(errors, []);
  console.log("Model consent: removed-model fallback blocked, exact revision confirmed, explicit selection allowed, draft preserved");
} catch (error) {
  console.error(await page.locator("body").innerText());
  console.error(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "ai_start").map(call => call.args.request)));
  throw error;
} finally {
  await browser.close();
}
