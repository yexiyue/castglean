import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChapterPauseEditor } from "../../src/components/projects/chapter-pause-editor";
import type { ChapterPauseEdit } from "../../src/lib/bindings";
import { messages } from "../../src/locales/zh/messages.po";
import "../../src/index.css";

i18n.load("zh", messages);
i18n.activate("zh");

function Fixture() {
  const [seconds, setSeconds] = useState("0.5");
  const [saved, setSaved] = useState(500);
  const [calls, setCalls] = useState<ChapterPauseEdit[]>([]);
  const [closed, setClosed] = useState(0);
  const [fail, setFail] = useState(false);
  const [busy, setBusy] = useState(false);
  return <main>
    <ChapterPauseEditor afterIndex={0} seconds={seconds} savedDurationMs={saved} boundaries={[0, 1]} occupied={[0]} busy={busy} onSeconds={setSeconds} onEdit={async (edit) => {
      setCalls((previous) => [...previous, edit]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (fail) return false;
      if (edit.kind === "set") setSaved(edit.duration_ms);
      return true;
    }} onSelect={() => {}} onClose={() => setClosed((value) => value + 1)} />
    <output aria-label="calls">{JSON.stringify(calls)}</output>
    <output aria-label="closed">{closed}</output>
    <button type="button">外部焦点</button>
    <button type="button" onClick={() => setFail((value) => !value)}>切换保存失败</button>
    <button type="button" onClick={() => setBusy((value) => !value)}>切换忙碌状态</button>
    <button type="button" onClick={() => setSeconds("0.25")}>设置外部数值</button>
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Fixture /></I18nProvider>);
