import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

test("shared result rendering escapes unknown summaries and hides failed tool response bodies", async () => {
  const server = await createServer({
    configFile: false,
    cacheDir: fileURLToPath(new URL("../src-tauri/target/vite-ai-components", import.meta.url)),
    logLevel: "error",
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
    plugins: [react(), lingui({ macroTransform: true })],
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { setupI18n } = await import("@lingui/core");
    const { I18nProvider } = await import("@lingui/react");
    const { messages } = await server.ssrLoadModule("/src/locales/zh/messages.po");
    const i18n = setupI18n({ locale: "zh", messages: { zh: messages } });
    const render = (component) => renderToStaticMarkup(createElement(I18nProvider, { i18n }, component));
    const { SplitProposal } = await server.ssrLoadModule("/src/components/projects/split-proposal.tsx");
    const html = render(createElement(SplitProposal, {
      reference: { kind: "future_kind", id: "future", summary: '<script>alert("unsafe")</script>' },
      project: { id: "project", revision: 1 }, disabled: false,
      onChange: () => assert.fail("unknown results cannot adopt"),
      onLocate: () => assert.fail("unknown results cannot navigate"),
    }));
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script|<button|<a\b/);

    const { SessionMessages } = await server.ssrLoadModule("/src/components/ai-elements/session-messages.tsx");
    const failed = render(createElement(SessionMessages, { label: "history", messages: [{
      id: "assistant", role: "assistant", parts: [{ type: "dynamic-tool", toolCallId: "call", toolName: "inspect", input: {}, state: "output-error", errorText: "PRIVATE_PROVIDER_RESPONSE", output: "PRIVATE_PROVIDER_RESPONSE" }],
    }] }));
    assert.doesNotMatch(failed, /PRIVATE_PROVIDER_RESPONSE/);
    assert.match(failed, /工具未完成/);
    const markdown = render(createElement(SessionMessages, { label: "Markdown", messages: [{
      id: "markdown", role: "assistant", parts: [{ type: "text", text: "## 分章结果\n\n- **遗漏标题**\n\n| 当前 | 建议 |\n| --- | --- |\n| 第一章 | 第二章 |\n\n```rust\nlet chapter = 2;\n```\n\n<script>window.unsafe=true</script>\n\n[unsafe](javascript:alert(1))" }],
    }] }));
    assert.match(markdown, /data-streamdown="strong">遗漏标题/);
    assert.match(markdown, /<table/);
    assert.match(markdown, /<code/);
    assert.doesNotMatch(markdown, /<script|href="javascript:/);
    const literal = render(createElement(SessionMessages, { label: "Input", messages: [{ id: "literal", role: "user", parts: [{ type: "text", text: "<b>字面标签</b> **不是格式**" }] }] }));
    assert.match(literal, /&lt;b&gt;字面标签&lt;\/b&gt;/);
    assert.doesNotMatch(literal, /<strong|<b>/);
  } finally { await server.close(); }
});
