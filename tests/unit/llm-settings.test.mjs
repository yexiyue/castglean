import { test } from "vitest";
import assert from "node:assert/strict";

test("reasoning settings render only host-supported choices and keep unknown models safe", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { setupI18n } = await import("@lingui/core");
    const { I18nProvider } = await import("@lingui/react");
    const { ReasoningSelect } = await import("../../src/components/settings/llm-settings.tsx");
    const i18n = setupI18n({ locale: "zh", messages: { zh: {} } });
    const catalog = [{ protocol: "openai", modelId: "zcode/GLM-5.3-Flash", choices: ["low", "high", "max"] }];
    const model = { id: "model", modelId: catalog[0].modelId, name: "GLM", reasoning: "lowest" };
    const render = (overrides = {}) => renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(ReasoningSelect, {
      id: "reasoning", model, protocol: "openai", catalog, disabled: false,
      onChange: () => assert.fail("render must not change settings"), ...overrides,
    })));
    const html = render();
    assert.match(html, /value="lowest" selected=""/);
    assert.match(html, /自动（最低：低）/);
    assert.doesNotMatch(html, />\s*(?:low|high|max)\s*</);
    for (const choice of ["low", "high", "max", "provider_default"]) assert.match(html, new RegExp(`value="${choice}"`));
    for (const unsupported of ["off", "medium", "xhigh"]) assert.doesNotMatch(html, new RegExp(`value="${unsupported}"`));
    assert.match(render({ model: { ...model, reasoning: "high" } }), /value="high" selected=""/);
    assert.match(render({ disabled: true }), /<select[^>]*disabled/);
    for (const unknown of [render({ model: { ...model, modelId: "other/GLM-5.3-Flash" } }), render({ protocol: "gemini" })]) {
      assert.match(unknown, /<select[^>]*disabled/);
      assert.doesNotMatch(unknown, /value="(?:low|high|max|off)"/);
    }
});
