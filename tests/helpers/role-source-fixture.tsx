import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { RoleSourceBlock } from "../../src/components/analysis/role-source-block";
import type { Segment } from "../../src/lib/bindings";
export function mountRoleFixture() {
  const pieces = ["山风🌲吹来。", "“走吧。”", "她说。\r\n第二段。"];
  const text = pieces.join(""); const bytes = new TextEncoder();
  let offset = 0;
  const segments: Segment[] = pieces.map((piece, i) => {
    const start = offset; offset += bytes.encode(piece).length;
    return { id: `r${i}`, range: { start, end: offset }, kind: i === 1 ? "speech" : "narration", attribution: i === 1 ? { state: "resolved", character_id: "c" } : { state: "narrator" }, review: "confirmed", evidence: [], reason: "" };
  });
  let start = 0;
  const lines = text.match(/[^\n]*\n|[^\n]+$/g)!.map((text, line) => { const a = start; start += bytes.encode(text).length; return { line, start: a, end: start, text }; });
  const container = document.createElement("div"); container.id = "role-fixture"; document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(<I18nProvider i18n={i18n}><RoleSourceBlock lines={lines} segments={segments} characters={[{ id: "c", displayName: "很长的角色名字用于测试截断" }]} selectedId={null} onSelect={() => {}} pauses={[{ offset: segments[0].range.end, index: 0, durationMs: 500 }]} /></I18nProvider>));
  return { text, dispose: () => { root.unmount(); container.remove(); } };
}
