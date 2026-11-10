// Run against tests/helpers/serve-workbench.mjs. Synthetic IPC only.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
try {
  for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&locale=${locale}&theme=${theme}`);
    // Locate by tag as well so this test does not rely on the translation of a
    // long input label. The toolbar has exactly one prompt textarea.
    const prompt = page.locator("textarea").last();
    await prompt.waitFor();
    await page.getByRole("button", { name: locale === "zh" ? "下次请求使用的模型" : "Model for the next request", exact: true }).filter({ hasText: "合成模型" }).waitFor();
    await page.evaluate(async () => {
      const hook = performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname === "/src/hooks/use-llm-connections.ts");
      const { publishLlmSnapshot, refreshLlmConnections } = await import(hook?.name ?? "/src/hooks/use-llm-connections.ts");
      await refreshLlmConnections();
      publishLlmSnapshot({
        connections: [{ id: "acceptance", name: "Synthetic service", revision: 1, protocol: "openai", endpoint: "https://example.invalid", hasKey: false, probes: [], models: [
          { id: "internal-glm-id", modelId: "zcode/GLM-5.3-Flash", name: "GLM acceptance", reasoning: "lowest", contextWindow: null, maxOutputTokens: null },
          { id: "internal-unknown-id", modelId: "unknown/no-reasoning", name: "Unknown acceptance", reasoning: "lowest", contextWindow: null, maxOutputTokens: null },
        ] }],
        defaultModel: { connectionId: "acceptance", modelId: "internal-glm-id" }, cleanupRequired: false,
        reasoningCatalog: [{ protocol: "openai", modelId: "zcode/GLM-5.3-Flash", choices: ["low", "high", "max"] }],
      });
    });
    // Select explicitly: the asynchronously restored fixture session has its
    // own model ID, independent from the catalog published above.
    await page.getByRole("button", { name: locale === "zh" ? "下次请求使用的模型" : "Model for the next request", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "GLM acceptance", exact: true }).click();
    await page.getByRole("menu").waitFor({ state: "hidden" });
    const label = locale === "zh" ? "思考强度" : "Reasoning effort";
    const picker = page.getByRole("button", { name: label, exact: true });
    await picker.click();
    await page.getByRole("menuitemradio", { name: locale === "zh" ? "高" : "High", exact: true }).click();
    await page.getByRole("menu").waitFor({ state: "hidden" });
    assert.equal(await page.getByText(locale === "zh" ? "页面未能加载" : "Page could not be loaded", { exact: true }).count(), 0);
    await prompt.fill("Synthetic reasoning acceptance");
    await prompt.press("Control+Enter");
    await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "ai_start"));
    const first = await page.evaluate(() => window.fixture.calls.find(call => call.command === "ai_start").args.request);
    assert.equal(first.configuration.reasoning, "high");
    assert.equal(first.configuration.selection.modelId, "internal-glm-id");
    await page.getByRole("button", { name: locale === "zh" ? "下次请求使用的模型" : "Model for the next request", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Unknown acceptance", exact: true }).click();
    await page.getByRole("menu").waitFor({ state: "hidden" });
    assert.equal(await picker.count(), 0);
    await page.getByRole("status").filter({ hasText: locale === "zh" ? "所选模型不支持原思考档位" : "does not support the previous reasoning level" }).waitFor();
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.close();
  }
  console.log("Reasoning: provider ID lookup, real menu opening, explicit override submission, unsupported-model fallback; zh/en × light/dark at 1024×680 passed");
} finally { await browser.close(); }
