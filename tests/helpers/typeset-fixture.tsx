import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageResponse } from "../../src/components/ai-elements/message";
import { SessionMessages } from "../../src/components/ai-elements/session-messages";
import { messages } from "../../src/locales/zh/messages.po";
import "../../src/index.css";

i18n.load("zh", messages);
i18n.activate("zh");
function Fixture() {
  const [more, setMore] = useState(false);
  const text = "## 标题\n\n第一段原有内容。" + (more ? "\n\n| 项目 | 数量 |\n| --- | --- |\n| 章节 | 2 |\n\n```ts\nconst answer = 42;" : "");
  return <main className="w-96 p-4">
    <button type="button" onClick={() => setMore(true)}>追加流式内容</button>
    <MessageResponse isAnimating controls={false}>{text}</MessageResponse>
    <article className="typeset typeset-docs" aria-label="文档预设"><h2>文档标题</h2><p>文档正文</p><div className="not-typeset"><p data-test="excluded">工具卡内容</p><div className="typeset"><p data-test="nested-excluded">嵌套内容</p></div></div></article>
    <div className="typeset typeset-chat"><div className="not-typeset"><h2 data-test="excluded-heading">工具标题</h2><p data-test="excluded-peer">工具内容</p></div></div>
    <SessionMessages label="消息记录" messages={[{ id: "assistant", role: "assistant", parts: [{ type: "text", text: "助手文本" }, { type: "dynamic-tool", toolCallId: "call", toolName: "inspect", input: {}, state: "output-error", errorText: "synthetic" }] }]} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Fixture /></I18nProvider>);
