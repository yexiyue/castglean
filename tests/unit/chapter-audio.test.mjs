import assert from "node:assert/strict";
import { test } from "vitest";
import {
  blockersOf,
  chapterAudioActive,
  derivedProgress,
  exportableVersion,
  pendingVersion,
  segmentPending,
  versionRole,
} from "../../src/lib/chapter-audio.ts";
import {
  claimChapterPlayback,
  formatClock,
  pauseChapterPlayback,
  releaseChapterPlayback,
  timelineAt,
  timelineTotal,
  unitTimeline,
} from "../../src/lib/chapter-playback.ts";

function fakeAudio() {
  return {
    pauses: 0,
    pause() {
      this.pauses++;
    },
  };
}

test("unit timeline stops at missing audio", () => {
  const units = [
    { index: 0, durationMs: 1500, mediaId: "unit" },
    { index: 1, durationMs: null, mediaId: "unit" },
    { index: 2, durationMs: 500, mediaId: "unit" },
  ];
  const timeline = unitTimeline(units);
  assert.deepEqual(
    timeline.map(({ unit, start, end }) => [unit.index, start, end]),
    [
      [0, 0, 1.5],
    ],
  );
  assert.deepEqual(unitTimeline([]), []);
});

test("clock formatting never shows negative or non-finite time", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(59.9), "0:59");
  assert.equal(formatClock(61), "1:01");
  assert.equal(formatClock(3725), "62:05");
  assert.equal(formatClock(-1), "0:00");
  assert.equal(formatClock(Number.NaN), "0:00");
});

test("only one chapter source plays and auditions can pause it", () => {
  const first = fakeAudio();
  const second = fakeAudio();
  claimChapterPlayback(first);
  claimChapterPlayback(first);
  assert.equal(first.pauses, 0, "re-claiming the same source does not pause it");
  claimChapterPlayback(second);
  assert.equal(first.pauses, 1, "a new source pauses the previous one");
  pauseChapterPlayback();
  assert.equal(second.pauses, 1);
  // A stale release must not clear the current source.
  releaseChapterPlayback(first);
  pauseChapterPlayback();
  assert.equal(second.pauses, 2);
  releaseChapterPlayback(second);
  pauseChapterPlayback();
  assert.equal(second.pauses, 2, "released sources are no longer paused");
});

test("thrown host errors are classified without trusting their shape", () => {
  const blockers = [{ kind: "missing_binding", count: 1 }];
  assert.deepEqual(blockersOf({ blocked: { blockers } }), blockers);
  for (const cause of [
    "busy",
    null,
    undefined,
    new Error("ipc"),
    {},
    { blocked: null },
    { blocked: {} },
    { blocked: { blockers: "nope" } },
  ]) {
    assert.equal(blockersOf(cause), null);
  }
});

test("active statuses are exactly the ones the host can still act on", () => {
  for (const status of ["queued", "running", "cancelling"])
    assert.equal(chapterAudioActive(status), true);
  for (const status of ["cancelled", "failed", "interrupted", "succeeded"])
    assert.equal(chapterAudioActive(status), false);
});

test("pending scope flags only unresolved attribution awaiting human handling", () => {
  const segment = (review, state) => ({ review, attribution: { state } });
  assert.equal(segmentPending(segment("unreviewed", "unknown")), true);
  assert.equal(segmentPending(segment("unreviewed", "ambiguous")), true);
  assert.equal(
    segmentPending(segment("confirmed", "ambiguous")),
    false,
    "人工明确保留歧义后不再催处理",
  );
  assert.equal(
    segmentPending(segment("unreviewed", "resolved")),
    false,
    "归属已明确但未逐段确认不进入待检查",
  );
  assert.equal(segmentPending(segment("unreviewed", "narrator")), false);
});

test("timeline lookup resolves playing unit and end-of-queue", () => {
  const units = [
    { index: 0, durationMs: 1000, mediaId: "unit" },
    { index: 1, durationMs: null, mediaId: null, status: "empty" },
    { index: 2, durationMs: 1000, mediaId: "unit" },
    { index: 3, durationMs: 1000, mediaId: "unit" },
  ];
  const timeline = unitTimeline(units);
  assert.equal(timelineTotal(timeline), 3);
  assert.equal(timelineAt(timeline, 0)?.unit.index, 0);
  assert.equal(timelineAt(timeline, 0.9)?.unit.index, 0);
  assert.equal(timelineAt(timeline, 1)?.unit.index, 2, "无音频单元不占时长");
  assert.equal(timelineAt(timeline, 2.5)?.unit.index, 3);
  assert.equal(timelineAt(timeline, 3), null, "播完即结束");
  assert.equal(timelineAt(timeline, -1), null);
});

test("missing issued media terminates the queue and cannot conceal a gap", () => {
  const timeline = unitTimeline([
    { index: 0, durationMs: 1000, mediaId: "a" },
    { index: 1, durationMs: 2000, mediaId: null },
    { index: 2, durationMs: 1000, mediaId: "c" },
  ]);
  assert.equal(timeline.length, 1);
  assert.equal(timelineTotal(timeline), 1);
});

function version({
  adoption = "adopted",
  status = "succeeded",
  unitCount = 4,
  completedUnits = 4,
  inheritedUnits = 0,
} = {}) {
  return {
    run: { id: "run", status, adoption, unitCount, completedUnits, inheritedUnits },
    units: [{ index: 0, status: "done", mediaId: "a" }],
  };
}

test("only a finished retake is a pending decision", () => {
  assert.equal(pendingVersion(null), null);
  assert.equal(pendingVersion(version({ adoption: "pending" }))?.run.id, "run");
  assert.equal(pendingVersion(version({ adoption: "adopted" })), null);
  assert.equal(
    pendingVersion(version({ adoption: "pending", status: "running" })),
    null,
    "重录仍在进行时不是待采用版本",
  );
});

test("export requires the adopted and complete version", () => {
  assert.equal(exportableVersion(version()), true);
  assert.equal(exportableVersion(version({ adoption: "pending" })), false);
  assert.equal(exportableVersion(version({ adoption: "none" })), false);
  assert.equal(exportableVersion(null), false);
  const gapped = version();
  gapped.units = [
    { index: 0, status: "done", mediaId: "a" },
    { index: 1, status: "pending", mediaId: null },
  ];
  assert.equal(exportableVersion(gapped), false, "有缺口不能导出");
});

test("derived progress excludes inherited audio", () => {
  assert.deepEqual(
    derivedProgress(
      version({ unitCount: 10, completedUnits: 8, inheritedUnits: 7 }).run,
    ),
    { done: 1, total: 3 },
  );
  assert.deepEqual(
    derivedProgress(
      version({ unitCount: 10, completedUnits: 7, inheritedUnits: 7 }).run,
    ),
    { done: 0, total: 3 },
    "任务刚建立时不显示接近完成",
  );
  assert.deepEqual(
    derivedProgress(
      version({ unitCount: 10, completedUnits: 10, inheritedUnits: 7 }).run,
    ),
    { done: 3, total: 3 },
  );
  assert.deepEqual(
    derivedProgress(version({ unitCount: 4, completedUnits: 2 }).run),
    { done: 2, total: 4 },
    "整章生成沿用全部计数",
  );
});

test("version roles follow the adoption state", () => {
  assert.equal(versionRole(version().run), "current");
  assert.equal(versionRole(version({ adoption: "pending" }).run), "pending");
  assert.equal(versionRole(version({ adoption: "none" }).run), "history");
});
