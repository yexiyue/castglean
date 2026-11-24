// Public synthetic IPC for the actual chapter production route.
import { analysisMock, sourceLines } from "./analysis-fixture";

interface Entry {
  run: any;
  units: any[];
  arrangement: any;
}

/** run id → 任务快照；Map 保持插入顺序，越晚插入越新。 */
const versions = new Map<string, Entry>();
/** 最近一次建立或恢复的任务，供 `fixture.audio` 与跨章在途指示读取。 */
let state: Entry | null = null;
let previous: any = null;
const pauseReceipts = new Map<string, any>();
let sequence = 0;

/**
 * 宿主事实的夹具版：补齐任务种类、采用状态、沿用与重做位置。
 * 采用状态按宿主规则解析——用例显式指定的状态优先；没有指定时，成功即当前采用版本，
 * 同一制作方式里只有最近一个这样的版本是当前采用，更早的让位。
 */
function snapshot(entry: Entry) {
  const newest = [...versions.values()].findLast(
    (other) =>
      other.run.mode === entry.run.mode &&
      other.run.status === "succeeded" &&
      other.run.adoption == null,
  );
  const run = {
    kind: "generation",
    parentRunId: null,
    inheritedUnits: 0,
    droppedPauses: 0,
    redoIndexes: [] as number[],
    ...entry.run,
  };
  run.adoption ??=
    run.status === "succeeded" && entry === newest ? "adopted" : "none";
  return structuredClone({ ...entry, run });
}

function sameMode(entry: { run: any }, mode: string | null | undefined) {
  return !mode || entry.run.mode === mode;
}

/**
 * 章节状态：某种制作方式最近一个未放弃的任务；与宿主一致，
 * 重新采用更早的版本时回到该版本。
 */
function chapterStatus(mode?: string | null) {
  const live = [...versions.values()]
    .filter((entry) => sameMode(entry, mode) && entry.run.adoption !== "rejected")
    .map(snapshot);
  const latest = live.at(-1);
  const adopted = live.findLast((entry) => entry.run.adoption === "adopted");
  return latest?.run.status === "succeeded" &&
    latest.run.adoption === "none" &&
    adopted
    ? adopted
    : latest;
}

function register(entry: Entry) {
  versions.set(entry.run.id, entry);
  state = entry;
  (window as any).fixture.audio = entry;
}

export function audioMock(command: string, args: any): { handled: boolean; value?: any } {
  const fixture = (window as any).fixture;
  if (command === "chapter_audio_check") {
    const blockers = args.input.mode === "multi_role" ? fixture.generationBlockers ?? [] : [];
    // 用例通过 fixture.redo 声明可沿用的范围；没有声明时宿主不报告重做范围。
    const redo = args.inheritFrom && fixture.redo
      ? { inheritableUnits: fixture.redo.inheritable ?? 2, redoUnits: fixture.redo.units.length, redoIndexes: fixture.redo.units }
      : null;
    return { handled: true, value: { ready: blockers.length === 0, blockers, plan: null, redo } };
  }
  if (command === "chapter_audio_start") {
    const request = args.request;
    const mode = args.input.mode;
    if (fixture.noAnalysis && mode === "multi_role") throw { blocked: { blockers: [{ kind: "no_analysis", count: 1, line: 0, characterId: null, characterName: null, segmentId: null, range: null, detail: null }] } };
    if (fixture.missingVoice && mode === "multi_role") throw { blocked: { blockers: [{ kind: "missing_binding", count: 1, line: 1, characterId: "character-a", characterName: "阿岚", segmentId: "missing", range: { start: 0, end: 1 }, detail: null }] } };
    const parent = request.run_id ?? request.inherit_from;
    const source = parent ? versions.get(parent) : undefined;
    if (request.kind !== "fresh" && !source) throw "not_found";
    if (request.kind === "resume") {
      // 续跑沿用原任务与已完成的单元，计数回到仅已完成。
      const kept = source.units.filter((unit: any) => unit.status === "done").length;
      Object.assign(source.run, { status: "running", stage: "generating", completedUnits: kept, currentIndex: null, failedIndex: null, error: null, revision: source.run.revision + 1 });
      register(source);
      return { handled: true, value: snapshot(source) };
    }
    const snapshot0 = analysisMock("chapter_analysis_snapshot", args).value;
    const segments = mode === "narrator" ? [] : analysisMock("chapter_analysis_segments", { versionId: snapshot0.versionId, range: snapshot0.binding }).value.segments;
    const fresh: Entry = {
      run: { id: mode === "narrator" ? "narrator-run" : "audio-run", mode, projectId: "fixture-project", chapterId: args.chapterId, chapterTitle: "山雨", status: "running", stage: "generating", backend: args.input.voice?.backend ?? "kokoro", model: args.input.voice?.model ?? "1.1-zh", device: "cpu", analysisVersionId: mode === "narrator" ? null : snapshot0.versionId, unitCount: 4, completedUnits: 2, currentIndex: 2, revision: 3, failedIndex: null, error: null, finalMediaId: null, finalDurationMs: null, createdAt: String(Math.floor(Date.now() / 1000)), finishedAt: null },
      units: sourceLines.slice(0, 4).map((line, index) => ({ index, range: { start: line.start, end: line.end }, line: line.line, segmentId: segments.find((s: any) => s.range.start <= line.start && line.start < s.range.end)?.id ?? `segment-${index}`, targetKind: "narrator", characterId: null, characterName: null, voice: args.input.voice?.voice ?? "zf_001", status: index < 2 ? "done" : "pending", mediaId: index < 2 ? `unit-${index}` : null, durationMs: index < 2 ? 1000 : null })),
      arrangement: { runId: mode === "narrator" ? "narrator-run" : "audio-run", revision: 0, pauses: [], canUndo: false, stale: false },
    };
    let entry = fresh;
    if (request.kind === "retake" || (request.kind === "fresh" && fixture.redo && source)) {
      // 派生：沿用来源的其余单元，只把指定单元置回待合成。
      const redo = request.kind === "retake" ? request.units : fixture.redo.units;
      sequence += 1;
      const derivedId = request.kind === "retake" ? `retake-${sequence}` : `redo-${sequence}`;
      entry = {
        run: {
          ...structuredClone(source.run),
          id: derivedId,
          kind: request.kind === "retake" ? "retake" : "redo",
          parentRunId: source.run.id,
          inheritedUnits: source.units.filter((unit: any) => unit.status === "done" && !redo.includes(unit.index)).length,
          redoIndexes: redo,
          status: "running", stage: "generating", completedUnits: 0, currentIndex: null, failedIndex: null, error: null, finalMediaId: null, finalDurationMs: null, finishedAt: null,
          // 与宿主一致：重录在成功时进入待采用，局部重做在成功时成为当前采用版本。
          adoption: request.kind === "retake" ? "pending" : null,
          revision: 1,
        },
        units: structuredClone(source.units).map((unit) => redo.includes(unit.index) ? { ...unit, status: "pending", mediaId: null, durationMs: null } : unit),
        arrangement: { ...structuredClone(source.arrangement), runId: derivedId, stale: false },
      };
      entry.run.completedUnits = entry.units.filter((unit: any) => unit.status === "done").length;
    }
    register(entry);
    return { handled: true, value: snapshot(entry) };
  }
  if (command === "chapter_audio_status" && fixture.failAudioRead) throw "read_failed";
  if (command === "chapter_audio_status") {
    const result = args.runId
      ? versions.get(args.runId)
      : args.completeOnly
        ? [...versions.values()].findLast(
            (entry) => sameMode(entry, args.mode) && snapshot(entry).run.adoption === "adopted",
          )
        : chapterStatus(args.mode);
    return { handled: true, value: result?.run.chapterId === args.chapterId && !fixture.emptyAudioStatus && (!args.completeOnly || result.run.status === "succeeded") ? snapshot(result) : null };
  }
  if (command === "chapter_audio_versions") {
    const listed = [...versions.values()].filter((entry) => sameMode(entry, args.mode) && entry.run.adoption !== "rejected").reverse();
    return { handled: true, value: listed.map((entry) => snapshot(entry).run) };
  }
  if (command === "chapter_audio_adopt" || command === "chapter_audio_reject") {
    const entry = versions.get(args.runId);
    if (!entry) throw "not_found";
    if (command === "chapter_audio_reject") {
      if (entry.run.adoption !== "pending") throw "conflict";
      entry.run.adoption = "rejected";
    } else {
      if (entry.run.status !== "succeeded" || entry.arrangement.stale) throw "conflict";
      for (const other of versions.values())
        if (other !== entry && other.run.mode === entry.run.mode && snapshot(other).run.adoption === "adopted") other.run.adoption = "none";
      entry.run.adoption = "adopted";
    }
    state = entry;
    fixture.audio = entry;
    return { handled: true, value: snapshot(entry).run };
  }
  if (command === "chapter_audio_waveforms") return { handled: true, value: Object.fromEntries(args.mediaIds.map((id: string) => [id, [0.15, 0.4, 0.75, 0.25]])) };
  if (command === "chapter_audio_recent_tasks") {
    const tasks = [...versions.values()].filter(({ run }) => run.projectId === args.projectId && run.adoption !== "rejected");
    return { handled: true, value: tasks.map(({ run, units }) => ({
      run: structuredClone(snapshot({ run, units, arrangement: null }).run),
      previewUnitIndex: units.find((unit: any) => unit.status === "done" && unit.mediaId)?.index ?? null,
    })) };
  }
  if (command === "chapter_audio_active") return { handled: true, value: state && ["running", "cancelling"].includes(state.run.status) ? snapshot(state as Entry).run : null };
  if (command === "chapter_audio_cancel") { const run = (state as Entry).run; run.status = "cancelled"; run.currentIndex = null; run.revision++; return { handled: true, value: snapshot(state as Entry).run }; }
  if (command === "chapter_audio_summaries") return { handled: true, value: sourceLines.slice(args.fromIndex, args.fromIndex + args.count).map((l, n) => ({ index: args.fromIndex + n, text: l.text })) };
  if (command === "chapter_audio_arrangement_edit") {
    const target = (state as Entry);
    if (pauseReceipts.has(args.operationId)) return { handled: true, value: structuredClone(pauseReceipts.get(args.operationId)) };
    if (fixture.failPause) throw "write_failed";
    if (args.expectedRevision !== target.arrangement.revision) throw "conflict";
    const current = structuredClone(target.arrangement.pauses);
    const edit = args.edit;
    if (edit.kind === "undo") { target.arrangement.pauses = previous; previous = null; }
    else if (edit.kind === "move") { if (target.arrangement.pauses.some((p: any) => p.afterIndex === edit.to_index)) throw "conflict"; target.arrangement.pauses.find((p: any) => p.afterIndex === edit.after_index).afterIndex = edit.to_index; previous = current; }
    else { target.arrangement.pauses = current.filter((p: any) => p.afterIndex !== edit.after_index); if (edit.duration_ms) target.arrangement.pauses.push({ afterIndex: edit.after_index, durationMs: edit.duration_ms }); previous = current; }
    target.arrangement.pauses.sort((a: any, b: any) => a.afterIndex - b.afterIndex);
    target.arrangement.canUndo = previous != null; target.arrangement.revision++;
    pauseReceipts.set(args.operationId, structuredClone(target.arrangement));
    if (fixture.losePauseReply) { fixture.losePauseReply = false; throw "response_lost"; }
    return { handled: true, value: structuredClone(target.arrangement) };
  }
  if (command === "chapter_audio_playback") {
    const run = versions.get(args.runId);
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
  if (command === "chapter_audio_export") {
    const target = state as Entry;
    if (snapshot(target).run.adoption !== "adopted" || target.arrangement.stale) throw "conflict";
    return { handled: true, value: { id: "export-1", runId: target.run.id, revision: target.arrangement.revision, status: "succeeded", completed: 4, total: 4, durationMs: 4500, filename: "chapter.wav" } };
  }
  return { handled: false };
}
