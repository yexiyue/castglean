import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HeadingRulesEditor } from "../../src/components/projects/heading-rules-editor";
import { messages } from "../../src/locales/zh/messages.po";
import "../../src/index.css";

i18n.load("zh", messages); i18n.activate("zh");
function Fixture() {
 const [result, setResult] = useState<unknown>(null);
 return <main><HeadingRulesEditor initialRules={[
  {name:"第一条", kind:"chapter", pattern:"^A"},
  {name:"第二条", kind:"volume", pattern:"^B"},
  {name:"第三条", kind:"exclude", pattern:"^C"},
 ]} disabled={false} onApply={setResult} /><output aria-label="applied">{JSON.stringify(result)}</output></main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Fixture /></I18nProvider>);
