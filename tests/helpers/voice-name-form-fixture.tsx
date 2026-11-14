import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LibraryVoiceDescriptionEditor, LibraryVoiceEditor } from "../../src/components/voices/library-voice-editor";
import { commands } from "../../src/lib/bindings";
import { messages } from "../../src/locales/zh/messages.po";
import { messages as englishMessages } from "../../src/locales/en/messages.po";
import "../../src/index.css";

i18n.load("zh", messages);
i18n.load("en", englishMessages);
i18n.activate("zh");

let failDescription = false;
const descriptions: Array<{ id: string; description: string | null }> = [];
commands.describeLibraryVoice = async (id, description) => {
  if (failDescription) throw new Error("synthetic write failure");
  descriptions.push({ id, description });
  return null;
};

function Fixture() {
  const [name, setName] = useState("原始音色");
  const [saved, setSaved] = useState("原始音色");
  const [submissions, setSubmissions] = useState<string[]>([]);
  return (
    <main>
      <button type="button" onClick={() => i18n.activate(i18n.locale === "zh" ? "en" : "zh")}>Switch language</button>
      <LibraryVoiceEditor
        name={name}
        savedName={saved}
        onNameChange={setName}
        onSave={() => {
          setSubmissions((previous) => [...previous, name]);
          setSaved(name.trim());
        }}
        onReset={() => setName(saved)}
      />
      <output aria-label="submissions">{JSON.stringify(submissions)}</output>
      <LibraryVoiceDescriptionEditor voiceId="voice-a" saved="初始描述" />
      <button type="button" onClick={() => { failDescription = !failDescription; }}>切换描述写入失败</button>
      <button type="button" onClick={() => { document.querySelector("[data-descriptions]")!.textContent = JSON.stringify(descriptions); }}>读取描述调用</button>
      <output data-descriptions />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}><Fixture /></I18nProvider>,
);
