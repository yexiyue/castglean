import assert from "node:assert/strict";
import { test } from "node:test";
import { blockersOf, chapterAudioActive } from "../src/lib/chapter-audio.ts";
import {
  claimChapterPlayback,
  formatClock,
  pauseChapterPlayback,
  releaseChapterPlayback,
  unitTimeline,
} from "../src/lib/chapter-playback.ts";

function fakeAudio() {
  return {
    pauses: 0,
    pause() {
      this.pauses++;
    },
  };
}

test("unit timeline accumulates produced audio and skips units without it", () => {
  const units = [
    { index: 0, durationMs: 1500 },
    { index: 1, durationMs: null },
    { index: 2, durationMs: 500 },
  ];
  const timeline = unitTimeline(units);
  assert.deepEqual(
    timeline.map(({ unit, start, end }) => [unit.index, start, end]),
    [
      [0, 0, 1.5],
      [2, 1.5, 2],
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
