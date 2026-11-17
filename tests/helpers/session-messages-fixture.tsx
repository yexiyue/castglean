import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Thread } from "../../src/components/assistant-ui/elements/thread.aui";
import { messages } from "../../src/locales/zh/messages.po";
import "../../src/index.css";

i18n.load("zh", messages);
i18n.activate("zh");

const adapter: ChatModelAdapter = {
  async *run({ messages }) {
    const last = messages.at(-1);
    const prompt = last?.role === "user" ? last.content[0] : null;
    if (!prompt || prompt.type !== "text") return;
    const reply = `收到：${prompt.text}。${Array.from({ length: 3 }, (_, i) => `第 ${i + 1} 段补充内容，用于形成可滚动的消息长度。`).join("")}`;
    yield { content: [{ type: "text", text: reply.slice(0, 20) }] };
    yield { content: [{ type: "text", text: reply.slice(0, 40) }] };
    return { content: [{ type: "text", text: reply }] };
  },
};

function Fixture() {
  const runtime = useLocalRuntime(adapter);
  const [older, setOlder] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function seed() {
      for (let i = 0; i < 10 && !cancelled; i++) {
        if (runtime.thread.getState().messages.length < i * 2)
          await runtime.thread.append({
            role: "user",
            content: [{ type: "text", text: `初始话题 ${i + 1}` }],
          });
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
    void seed().then(async () => {
      // Wait for the last reply to complete before pinning to the end.
      for (let i = 0; i < 40 && !cancelled; i++) {
        if (!runtime.thread.getState().isRunning) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const viewport = document.querySelector('[data-slot="aui_thread-viewport"]');
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime]);
  return (
    <I18nProvider i18n={i18n}>
      <main className="flex h-svh flex-col" data-ready={ready ? "true" : "false"}>
        <button
          type="button"
          onClick={() =>
            void runtime.thread.append({
              role: "user",
              content: [{ type: "text", text: "追加的新消息" }],
            })
          }
        >
          追加消息
        </button>
        <AssistantRuntimeProvider runtime={runtime}>
          <div className="min-h-0 flex-1">
            <Thread
              autoFocus={false}
              components={{
                EarlierLoader: older
                  ? () => (
                      <button
                        type="button"
                        data-slot="agent-load-earlier"
                        className="self-center"
                        onClick={() => setOlder(false)}
                      >
                        加载更早的消息
                      </button>
                    )
                  : undefined,
                Composer: null,
              }}
            />
          </div>
        </AssistantRuntimeProvider>
      </main>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
