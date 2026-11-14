import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { UIMessage } from "ai";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionMessages } from "../../src/components/ai-elements/session-messages";
import "../../src/index.css";

i18n.load("zh", {});
i18n.activate("zh");
const makeMessage = (id: string, text: string): UIMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
});

function Fixture() {
  const [messages, setMessages] = useState([makeMessage("current", Array.from({ length: 60 }, (_, i) => `${i + 1}. 当前内容`).join("\n\n"))]);
  const [older, setOlder] = useState(true);
  return (
    <I18nProvider i18n={i18n}>
      <main className="flex h-svh flex-col">
        <button type="button" onClick={() => setMessages((items) => [...items, makeMessage("new", "新消息")])}>追加消息</button>
        <SessionMessages label="会话" messages={messages} interruptedMessages={new Set(["current"])} hasOlder={older} onLoadOlder={async () => {
          setMessages((items) => [makeMessage("old", "更早的内容"), ...items]);
          setOlder(false);
          return true;
        }} />
      </main>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
