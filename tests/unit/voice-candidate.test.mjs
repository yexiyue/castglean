import assert from "node:assert/strict";
import { test } from "vitest";

test("candidate footer actions stay visible without opening model audition settings", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { setupI18n } = await import("@lingui/core");
    const { I18nProvider } = await import("@lingui/react");
    const { messages } = await import("../../src/locales/zh/messages.po");
    const i18n = setupI18n({ locale: "zh", messages: { zh: messages } });
    const { VoiceCandidateCard } = await import("../../src/components/voices/voice-candidate-card.tsx");
    const html = renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(VoiceCandidateCard, {
      candidate: { id: "candidate", saved_id: null, audio: "synthetic-audio", voice: { id: "voice", name: "公开验收样例", transcript: "山风穿过松林。", description: "清晰自然", source: "design", bytes: 100, duration: 1 } },
      footerActions: createElement("button", { type: "button" }, "绑定到此目标"),
    })));
    assert.match(html, /<button[^>]*>绑定到此目标<\/button>/);
    assert.doesNotMatch(html, /打开试听配置/);
});
