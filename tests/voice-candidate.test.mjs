import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

test("candidate footer actions stay visible without opening model audition settings", async () => {
  const server = await createServer({
    configFile: false,
    cacheDir: fileURLToPath(new URL("../src-tauri/target/vite-voice-candidate", import.meta.url)),
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
    const { VoiceCandidateCard } = await server.ssrLoadModule("/src/components/voices/voice-candidate-card.tsx");
    const html = renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(VoiceCandidateCard, {
      candidate: { id: "candidate", saved_id: null, audio: "synthetic-audio", voice: { id: "voice", name: "公开验收样例", transcript: "山风穿过松林。", description: "清晰自然", source: "design", bytes: 100, duration: 1 } },
      footerActions: createElement("button", { type: "button" }, "绑定到此目标"),
    })));
    assert.match(html, /<button[^>]*>绑定到此目标<\/button>/);
    assert.doesNotMatch(html, /用模型试声/);
  } finally { await server.close(); }
});
