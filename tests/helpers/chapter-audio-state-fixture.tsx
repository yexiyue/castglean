import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { commands, events, type ChapterAudioStatusView_Serialize as StatusView } from "../../src/lib/bindings";
import { useChapterAudio } from "../../src/hooks/use-chapter-audio";
export async function checkAudioStateRaces() {
  const original = { status: commands.chapterAudioStatus, active: commands.chapterAudioActive, start: commands.chapterAudioStart, listen: events.chapterAudioUpdate.listen };
  const originalTauri = window.isTauri; window.isTauri = true;
  let current = { run: { id: "r", projectId: "p", chapterId: "c", status: "running", revision: 1, completedUnits: 0 }, units: [], arrangement: { runId: "r", revision: 0, pauses: [], canUndo: false, stale: false } } as unknown as StatusView;
  let delayed: (() => void) | null = null;
  let delayNext = false;
  let listener: any;
  commands.chapterAudioStatus = async () => { const frozen = structuredClone(current); if (delayNext) { delayNext = false; return new Promise((resolve) => { delayed = () => resolve(frozen); }); } return frozen; };
  commands.chapterAudioActive = async () => ["running", "cancelling"].includes(current.run.status) ? structuredClone(current.run) : null;
  events.chapterAudioUpdate.listen = async (cb: any) => { listener = cb; return () => {}; };
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  let hook: ReturnType<typeof useChapterAudio>;
  function Harness({ chapter }: { chapter: string }) { hook = useChapterAudio("p", chapter); return null; }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    flushSync(() => root.render(createElement(Harness, { chapter: "c" }))); await settle();
    delayNext = true;
    const old = hook!.refresh(); await settle();
    current = { ...current, run: { ...current.run, revision: 3, completedUnits: 2, status: "failed" } };
    listener({ payload: current.run }); await settle();
    (delayed as unknown as () => void)(); await old; await settle();
    const latest = hook!.status?.run.revision;
    delayNext = true;
    const oldArrangement = hook!.refresh(); await settle();
    hook!.applyArrangement({ ...current.arrangement, revision: 2, pauses: [{ afterIndex: 0, durationMs: 500 }] }); await settle();
    (delayed as unknown as () => void)(); await oldArrangement; await settle();
    const arrangementRevision = hook!.status?.arrangement.revision;
    listener({ payload: { ...current.run, revision: 2, status: "running", completedUnits: 1 } }); await settle();
    const terminal = hook!.status?.run.status;
    const active = hook!.active;
    let releaseStart: (value: StatusView) => void = () => {};
    commands.chapterAudioStart = () => new Promise((resolve) => { releaseStart = resolve; });
    const sameStart = hook!.start(); await settle();
    current = { ...current, run: { ...current.run, revision: 5, status: "failed" } };
    listener({ payload: current.run }); await settle();
    releaseStart({ ...current, run: { ...current.run, revision: 4, status: "running" } }); await sameStart; await settle();
    const afterLateStart = hook!.active;
    const start = hook!.start(); await settle();
    current = { ...current, run: { ...current.run, chapterId: "d", id: "d-run", revision: 1 } };
    flushSync(() => root.render(createElement(Harness, { chapter: "d" }))); await settle();
    releaseStart({ ...current, run: { ...current.run, chapterId: "c", id: "old-start", revision: 10 } }); await start; await settle();
    return { arrangementRevision, latest, terminal, active, afterLateStart, chapter: hook!.status?.run.chapterId, starting: hook!.starting };
  } finally { flushSync(() => root.unmount()); node.remove(); commands.chapterAudioStatus = original.status; commands.chapterAudioActive = original.active; commands.chapterAudioStart = original.start; events.chapterAudioUpdate.listen = original.listen; window.isTauri = originalTauri; }
}
