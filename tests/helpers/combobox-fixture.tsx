import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "../../src/components/ui/combobox";
import { Field, FieldError, FieldLabel } from "../../src/components/ui/field";
import { messages } from "../../src/locales/zh/messages.po";
import "../../src/index.css";

i18n.load("zh", messages);
i18n.activate("zh");
const items = Array.from({ length: 150 }, (_, index) => ({ value: `role-${index}`, label: index >= 148 ? `同名角色 (${index})` : `角色 ${index}` }));
function Fixture() {
  const [value, setValue] = useState<typeof items[number] | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [invalid, setInvalid] = useState(false);
  return <main className="w-80 p-4">
    <Field data-invalid={invalid}><FieldLabel htmlFor="role">角色选择</FieldLabel>
      <Combobox items={items} value={value} inputValue={query ?? value?.label ?? ""} onInputValueChange={(text, details) => { if (details.reason === "input-change") setQuery(text); }} onOpenChange={(open) => { if (!open) setQuery(null); }} isItemEqualToValue={(a, b) => a.value === b.value} onValueChange={(item) => { setValue(item); setQuery(null); }}>
        <ComboboxInput id="role" disabled={disabled} aria-invalid={invalid} aria-describedby={invalid ? "role-error" : undefined} showClear />
        <ComboboxContent><ComboboxEmpty>没有匹配角色</ComboboxEmpty><ComboboxList>{(item: typeof items[number]) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
      </Combobox>
      {invalid && <FieldError id="role-error">请选择角色</FieldError>}
    </Field>
    <output aria-label="selected">{value?.value ?? "none"}</output>
    <button type="button" disabled={!value || query !== null}>绑定</button>
    <button type="button" onClick={() => setValue(items[149])}>设置同名角色</button>
    <button type="button" onClick={() => setDisabled((old) => !old)}>切换禁用</button>
    <button type="button" onClick={() => setInvalid((old) => !old)}>切换错误</button>
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Fixture /></I18nProvider>);
