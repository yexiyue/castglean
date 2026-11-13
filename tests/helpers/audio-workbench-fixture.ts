// Public synthetic IPC for the actual chapter production route.
import { analysisMock, sourceLines } from "./analysis-fixture";
let state: any = null;
let previous: any = null;
const pauseReceipts = new Map<string, any>();
export function audioMock(command: string, args: any): { handled: boolean; value?: any } {
  const fixture = (window as any).fixture;
  if (command === "chapter_audio_check") return { handled: true, value: { ready: true, blockers: [], plan: null } };
  if (command === "chapter_audio_start") {
    if (fixture.missingVoice) throw { blocked: { blockers: [{ kind: "missing_binding", count: 1, line: 1, characterId: "character-a", characterName: "阿岚", segmentId: "missing", range: { start: 0, end: 1 }, detail: null }] } };
    const snapshot = analysisMock("chapter_analysis_snapshot", args).value;
    const segments = analysisMock("chapter_analysis_segments", { versionId: snapshot.versionId, range: snapshot.binding }).value.segments;
    state = { run: { id: "audio-run", projectId: "fixture-project", chapterId: args.chapterId, chapterTitle: "山雨", status: "running", stage: "generating", backend: "kokoro", model: "1.1-zh", device: "cpu", analysisVersionId: snapshot.versionId, unitCount: 4, completedUnits: 2, currentIndex: 2, revision: 3, failedIndex: null, error: null, finalMediaId: null, finalDurationMs: null, createdAt: "1", finishedAt: null },
      units: sourceLines.slice(0, 4).map((line, index) => ({ index, range: { start: line.start, end: line.end }, line: line.line, segmentId: segments.find((s: any) => s.range.start <= line.start && line.start < s.range.end)?.id ?? `segment-${index}`, targetKind: "narrator", characterId: null, characterName: null, voice: "zf_001", status: index < 2 ? "done" : "pending", mediaId: index < 2 ? `unit-${index}` : null, durationMs: index < 2 ? 1000 : null })),
      arrangement: { runId: "audio-run", revision: 0, pauses: [], canUndo: false, stale: false } };
    fixture.audio = state;
    return { handled: true, value: structuredClone(state) };
  }
  if (command === "chapter_audio_status" && fixture.failAudioRead) throw "read_failed";
  if (command === "chapter_audio_status") return { handled: true, value: args.chapterId === "chapter-0" ? structuredClone(state) : null };
  if (command === "chapter_audio_active") return { handled: true, value: state && ["running", "cancelling"].includes(state.run.status) ? structuredClone(state.run) : null };
  if (command === "chapter_audio_cancel") { state.run.status = "cancelled"; state.run.currentIndex = null; state.run.revision++; return { handled: true, value: structuredClone(state.run) }; }
  if (command === "chapter_audio_summaries") return { handled: true, value: sourceLines.slice(args.fromIndex, args.fromIndex + args.count).map((l, n) => ({ index: args.fromIndex + n, text: l.text })) };
  if (command === "chapter_audio_arrangement_edit") {
    if (pauseReceipts.has(args.operationId)) return { handled: true, value: structuredClone(pauseReceipts.get(args.operationId)) };
    if (fixture.failPause) throw "write_failed";
    if (args.expectedRevision !== state.arrangement.revision) throw "conflict";
    const current = structuredClone(state.arrangement.pauses);
    const edit = args.edit;
    if (edit.kind === "undo") { state.arrangement.pauses = previous; previous = null; }
    else if (edit.kind === "move") { if (state.arrangement.pauses.some((p) => p.afterIndex === edit.to_index)) throw "conflict"; state.arrangement.pauses.find((p) => p.afterIndex === edit.after_index).afterIndex = edit.to_index; previous = current; }
    else { state.arrangement.pauses = current.filter((p) => p.afterIndex !== edit.after_index); if (edit.duration_ms) state.arrangement.pauses.push({ afterIndex: edit.after_index, durationMs: edit.duration_ms }); previous = current; }
    state.arrangement.pauses.sort((a, b) => a.afterIndex - b.afterIndex);
    state.arrangement.canUndo = previous != null; state.arrangement.revision++;
    pauseReceipts.set(args.operationId, structuredClone(state.arrangement));
    if (fixture.losePauseReply) { fixture.losePauseReply = false; throw "response_lost"; }
    return { handled: true, value: structuredClone(state.arrangement) };
  }
  if (command === "chapter_audio_playback") {
    const entries = []; let gapIndex = null;
    for (const u of state.units.filter((u) => u.index >= args.fromIndex)) {
      if (!u.mediaId) { gapIndex = u.index; break; }
      entries.push({ unitIndex: u.index, pauseAfter: null, mediaId: u.mediaId, durationMs: u.durationMs });
      const pause = state.arrangement.pauses.find((p) => p.afterIndex === u.index);
      if (pause) entries.push({ unitIndex: u.index, pauseAfter: u.index, mediaId: "silence", durationMs: pause.durationMs });
    }
    return { handled: true, value: { runId: state.run.id, revision: state.arrangement.revision, entries, gapIndex } };
  }
  if (command === "chapter_audio_export") return { handled: true, value: { id: "export-1", runId: state.run.id, revision: state.arrangement.revision, status: "succeeded", completed: 4, total: 4, durationMs: 4500, filename: "chapter.wav" } };
  return { handled: false };
}
