import assert from "node:assert/strict";
import { test } from "vitest";

test("shared result rendering escapes unknown summaries and hides failed tool response bodies", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { setupI18n } = await import("@lingui/core");
    const { I18nProvider } = await import("@lingui/react");
    const { messages } = await import("../../src/locales/zh/messages.po");
    const i18n = setupI18n({ locale: "zh", messages: { zh: messages } });
    const render = (component) => renderToStaticMarkup(createElement(I18nProvider, { i18n }, component));
    const { SplitProposal } = await import("../../src/components/projects/split-proposal.tsx");
    const { StructureOperationRegistry } = await import("../../src/lib/structure-operation.ts");
    const html = render(createElement(SplitProposal, {
      reference: { kind: "future_kind", id: "future", summary: '<script>alert("unsafe")</script>' },
      project: { id: "project", revision: 1 }, disabled: false,
      operations: new StructureOperationRegistry(),
      onChange: () => assert.fail("unknown results cannot adopt"),
      onLocate: () => assert.fail("unknown results cannot navigate"),
    }));
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script|<button|<a\b/);

    const { SubagentMessages } = await import("../../src/components/assistant-ui/tools/subagent-messages.tsx");
    const { AssistantRuntimeProvider, ThreadPrimitive, useLocalRuntime } = await import("@assistant-ui/react");
    const adapter = { async run() { return { content: [] }; } };
    function TestThread({ children }) {
      const runtime = useLocalRuntime(adapter);
      return createElement(AssistantRuntimeProvider, { runtime }, createElement(ThreadPrimitive.Viewport, null, children));
    }
    const renderSubagent = (message) => render(createElement(TestThread, null, createElement(SubagentMessages, {
      author: "章节分析",
      messages: [{
        createdAt: new Date(0),
        attachments: [],
        status: { type: "complete", reason: "stop" },
        metadata: { custom: {}, unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [] },
        ...message,
      }],
    })));
    const failed = renderSubagent({
      id: "assistant", role: "assistant", content: [{ type: "tool-call", toolCallId: "call", toolName: "inspect", args: {}, argsText: "{}", isError: true, result: JSON.stringify({ output: "PRIVATE_PROVIDER_RESPONSE" }) }],
    });
    assert.doesNotMatch(failed, /PRIVATE_PROVIDER_RESPONSE/);
    assert.match(failed, /data-subagent="章节分析"/);
    const markdown = renderSubagent({
      id: "markdown", role: "assistant", content: [{ type: "text", text: "## 分章结果\n\n- **遗漏标题**\n\n| 当前 | 建议 |\n| --- | --- |\n| 第一章 | 第二章 |\n\n```rust\nlet chapter = 2;\n```\n\n<script>window.unsafe=true</script>\n\n[unsafe](javascript:alert(1))" }],
    });
    assert.match(markdown, /<strong[^>]*>遗漏标题/);
    assert.match(markdown, /<table/);
    assert.match(markdown, /<code/);
    assert.doesNotMatch(markdown, /<script|href="javascript:/);
    const literal = renderSubagent({ id: "literal", role: "user", content: [{ type: "text", text: "<b>字面标签</b> **保留原样**" }] });
    assert.match(literal, /&lt;b&gt;字面标签&lt;\/b&gt;/);
    assert.doesNotMatch(literal, /<strong|<b>/);
});

test("main-thread tool fallback strips failed response bodies before rendering", async () => {
    const { stripFailedToolBody } = await import("../../src/components/assistant-ui/tools/agent-tool-ui.tsx");
    const failed = { toolName: "directory", toolCallId: "c1", args: {}, isError: true, result: JSON.stringify({ output: "PRIVATE_PROVIDER_RESPONSE" }) };
    assert.equal(stripFailedToolBody(failed).result, undefined);
    const ok = { toolName: "directory", toolCallId: "c2", args: {}, result: '{"output":{"chapters":3}}' };
    assert.equal(stripFailedToolBody(ok).result, '{"output":{"chapters":3}}');
});
