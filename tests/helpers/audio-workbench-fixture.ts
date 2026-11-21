// Public synthetic IPC for the actual chapter production route.
import { analysisMock, sourceLines } from "./analysis-fixture";
let state: any = null;
const audioByMode = new Map<string, any>();
let previous: any = null;
const pauseReceipts = new Map<string, any>();
export function audioMock(command: string, args: any): { handled: boolean; value?: any } {
  const fixture = (window as any).fixture;
  if (command === "chapter_audio_check") {
    const blockers = args.input.mode === "multi_role" ? fixture.generationBlockers ?? [] : [];
    return { handled: true, value: { ready: blockers.length === 0, blockers, plan: null } };
  }
  if (command === "chapter_audio_start") {
    const mode = args.input.mode;
    if (fixture.noAnalysis && mode === "multi_role") throw { blocked: { blockers: [{ kind: "no_analysis", count: 1, line: 0, characterId: null, characterName: null, segmentId: null, range: null, detail: null }] } };
    if (fixture.missingVoice && mode === "multi_role") throw { blocked: { blockers: [{ kind: "missing_binding", count: 1, line: 1, characterId: "character-a", characterName: "阿岚", segmentId: "missing", range: { start: 0, end: 1 }, detail: null }] } };
    const snapshot = analysisMock("chapter_analysis_snapshot", args).value;
    const segments = mode === "narrator" ? [] : analysisMock("chapter_analysis_segments", { versionId: snapshot.versionId, range: snapshot.binding }).value.segments;
    state = { run: { id: mode === "narrator" ? "narrator-run" : "audio-run", mode, projectId: "fixture-project", chapterId: args.chapterId, chapterTitle: "山雨", status: "running", stage: "generating", backend: args.input.voice?.backend ?? "kokoro", model: args.input.voice?.model ?? "1.1-zh", device: "cpu", analysisVersionId: mode === "narrator" ? null : snapshot.versionId, unitCount: 4, completedUnits: 2, currentIndex: 2, revision: 3, failedIndex: null, error: null, finalMediaId: null, finalDurationMs: null, createdAt: "1", finishedAt: null },
      units: sourceLines.slice(0, 4).map((line, index) => ({ index, range: { start: line.start, end: line.end }, line: line.line, segmentId: segments.find((s: any) => s.range.start <= line.start && line.start < s.range.end)?.id ?? `segment-${index}`, targetKind: "narrator", characterId: null, characterName: null, voice: args.input.voice?.voice ?? "zf_001", status: index < 2 ? "done" : "pending", mediaId: index < 2 ? `unit-${index}` : null, durationMs: index < 2 ? 1000 : null })),
      arrangement: { runId: mode === "narrator" ? "narrator-run" : "audio-run", revision: 0, pauses: [], canUndo: false, stale: false } };
    audioByMode.set(mode, state);
    fixture.audio = state;
    return { handled: true, value: structuredClone(state) };
  }
  if (command === "chapter_audio_status" && fixture.failAudioRead) throw "read_failed";
  if (command === "chapter_audio_status") {
    const result = args.runId
      ? [...audioByMode.values()].find((entry) => entry.run.id === args.runId)
      : args.mode ? audioByMode.get(args.mode) : state;
    return { handled: true, value: result?.run.chapterId === args.chapterId && !fixture.emptyAudioStatus && (!args.completeOnly || result.run.status === "succeeded") ? structuredClone(result) : null };
  }
  if (command === "chapter_audio_waveforms") return { handled: true, value: Object.fromEntries(args.mediaIds.map((id: string) => [id, [0.15, 0.4, 0.75, 0.25]])) };
  if (command === "chapter_audio_recent_tasks") {
    const tasks = Array.from(audioByMode.values()).filter(({ run }) => run.projectId === args.projectId);
    return { handled: true, value: tasks.map(({ run, units }) => ({
      run: structuredClone(run),
      previewUnitIndex: units.find((unit: any) => unit.status === "done" && unit.mediaId)?.index ?? null,
    })) };
  }
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
    const run = [...audioByMode.values()].find((entry) => entry.run.id === args.runId);
    if (!run) throw "not_found";
    const entries = []; let gapIndex = null;
    for (const u of run.units.filter((u) => u.index >= args.fromIndex)) {
      if (!u.mediaId) { gapIndex = u.index; break; }
      entries.push({ unitIndex: u.index, pauseAfter: null, mediaId: u.mediaId, durationMs: u.durationMs });
      const pause = run.arrangement.pauses.find((p) => p.afterIndex === u.index);
      if (pause) entries.push({ unitIndex: u.index, pauseAfter: u.index, mediaId: "silence", durationMs: pause.durationMs });
    }
    return { handled: true, value: { runId: run.run.id, revision: run.arrangement.revision, entries, gapIndex } };
  }
  if (command === "chapter_audio_export") return { handled: true, value: { id: "export-1", runId: state.run.id, revision: state.arrangement.revision, status: "succeeded", completed: 4, total: 4, durationMs: 4500, filename: "chapter.wav" } };
  return { handled: false };
}
