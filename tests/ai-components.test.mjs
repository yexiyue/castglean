import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

test("shared result rendering escapes unknown summaries and hides failed tool response bodies", async () => {
  const server = await createServer({
    configFile: false,
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
  } finally { await server.close(); }
});
