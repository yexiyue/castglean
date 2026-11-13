// Actual components in an isolated React root; never sends IPC or modifies a project.
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import { StrictMode, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { SessionInput } from "../../src/components/ai-elements/session-input";
import { ChapterAudioTrack } from "../../src/components/projects/chapter-audio-track";
import { Dialog, DialogContent, DialogTitle } from "../../src/components/ui/dialog";
import { commands } from "../../src/lib/bindings";
import { appHotkeys } from "../../src/lib/hotkeys";

export async function checkHotkeys() {
  const results: string[] = [];
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  const original = { summaries: commands.chapterAudioSummaries, edit: commands.chapterAudioArrangementEdit };
  const sent = [0, 0]; let toggles = 0; let edits = 0;
  let setVisible: (v: boolean) => void;
  let setDialog: (v: boolean) => void;
  const status = { run: { id: "hotkeys-test", status: "succeeded", currentIndex: null },
    units: [0, 1].map(index => ({ index, mediaId: `test-${index}`, durationMs: 1000, status: "done", range: { start: index, end: index + 1 } })),
    arrangement: { revision: 0, stale: false, pauses: [{ afterIndex: 0, durationMs: 500 }], canUndo: false } };
  commands.chapterAudioSummaries = async () => [];
  commands.chapterAudioArrangementEdit = async () => { edits++; return status.arrangement; };
  function Harness() {
    const [visible, updateVisible] = useState(true); setVisible = updateVisible;
    const [open, updateOpen] = useState(false); setDialog = updateOpen;
    useHotkey(appHotkeys["workspace.toggleDirectory"], () => toggles++, { enabled: visible });
    return <>
      <button type="button" data-test-outside>outside</button>
      {[0, 1].map(index => <SessionInput key={index} label={`hotkeys-${index}`} placeholder="" value="draft" onChange={() => {}} disabled={false} active={false} onSend={async () => { sent[index]++; }} onStop={async () => {}} />)}
      <Dialog open={open} onOpenChange={updateOpen}><DialogContent><DialogTitle>Hotkeys test</DialogTitle></DialogContent></Dialog>
      <ChapterAudioTrack audio={{ desktop: true, projectId: "test", status, starting: false } as any} player={{ state: { active: false, playing: false, time: 0, duration: 0, unit: null, failed: false } } as any} selectedSegmentId={null} pauseContainer={null} requestedPause={null} onPauseSelect={() => {}} onLocate={() => {}} />
    </>;
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));
  const check = (ok: boolean, name: string) => { if (!ok) throw new Error(name); results.push(name); };
  const press = (target: EventTarget, key: string, extra = {}) => {
    const init = { key, code: key === "Enter" ? "Enter" : key === "Escape" ? "Escape" : "KeyB", bubbles: true, cancelable: true, metaKey: true, ...extra };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  };
  try {
    flushSync(() => root.render(<StrictMode><I18nProvider i18n={i18n}><HotkeysProvider appHotkeys={appHotkeys} scope="hotkeys-test" exclusive defaultOptions={{ platform: "mac" }}><Harness /></HotkeysProvider></I18nProvider></StrictMode>));
    await settle();
    const inputs = node.querySelectorAll("textarea");
    const outside = node.querySelector<HTMLButtonElement>("[data-test-outside]")!;
    outside.focus(); press(outside, "Enter"); await settle();
    check(sent[0] === 0 && sent[1] === 0, "outside focus never sends a draft");
    inputs[0].focus(); press(inputs[0], "Enter"); await settle();
    check(sent[0] === 1 && sent[1] === 0, "focused input sends once under StrictMode");
    inputs[1].focus(); press(inputs[1], "Enter"); await settle();
    check(sent[0] === 1 && sent[1] === 1, "two mounted inputs remain isolated");
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { key: "Process" }]) { press(inputs[1], "Enter", extra); await settle(); check(sent[1] === 1, `IME/repeat filter ${JSON.stringify(extra)}`); }
    inputs[1].dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    press(inputs[1], "Enter"); await settle();
    check(sent[1] === 1, "composition lifecycle, isComposing, 229, Process and repeat block sending");
    inputs[1].dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    press(inputs[1], "Enter"); await settle(); check(sent[1] === 2, "sending resumes after compositionend");
    outside.focus();
    outside.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", metaKey: true, bubbles: true })); await settle();
    outside.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", metaKey: true, repeat: true, bubbles: true })); await settle();
    outside.dispatchEvent(new KeyboardEvent("keyup", { key: "b", code: "KeyB", metaKey: true, bubbles: true }));
    check(toggles === 1, "panel shortcut fires once even while held");
    press(outside, "b", { metaKey: false, ctrlKey: true }); await settle(); check(toggles === 1, "mac Control does not match Mod");
    flushSync(() => setVisible(false)); press(outside, "b"); await settle(); check(toggles === 1, "hidden workspace shortcut is disabled");
    flushSync(() => { setVisible(true); setDialog(true); }); await settle();
    press(document.activeElement!, "b"); await settle(); check(toggles === 1, "dialog suspends outer shortcuts");
    press(document.activeElement!, "Escape", { metaKey: false }); await new Promise(resolve => setTimeout(resolve, 300));
    check(!document.querySelector('[role="dialog"]'), "dialog Escape closes normally");
    outside.focus(); press(outside, "b"); await settle(); check(toggles === 2, "dialog close restores shortcuts");
    const handle = node.querySelector('[aria-label="拖动调整停顿时长"]')!;
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, pointerId: 1 })); await settle();
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 140, pointerId: 1 }));
    press(outside, "b"); await settle(); check(toggles === 2, "actual audio drag suspends shortcuts");
    press(outside, "Escape", { metaKey: false }); await settle();
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 140, pointerId: 1 })); await settle();
    check(edits === 0, "Escape cancels audio drag without committing");
    press(outside, "b"); await settle(); check(toggles === 3, "audio drag cancellation restores shortcuts");
    return results;
  } finally {
    flushSync(() => root.unmount()); node.remove();
    commands.chapterAudioSummaries = original.summaries;
    commands.chapterAudioArrangementEdit = original.edit;
  }
}
