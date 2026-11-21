import { expect, test } from "vitest";
import { chapterTrackMarks, layoutChapterTrack } from "../../src/lib/chapter-track-layout";

const units = (durations) => durations.map((durationMs, index) => ({
  index,
  durationMs,
  mediaId: durationMs == null ? null : `clip-${index}`,
  status: durationMs == null ? "pending" : "done",
}));

test("long tracks retain a compact range of capsule widths and true boundary times", () => {
  const clips = units([100, 2500, 30000, ...Array(30).fill(1000)]);
  const track = layoutChapterTrack(clips, [{ afterIndex: 0, durationMs: 500 }], null, 900, true);
  const first = track.items.slice(0, 4);
  expect(first.map((clip) => clip.width)).toEqual([68, 100, 240, 68]);
  expect(track.total).toBeGreaterThan(900);
  expect(chapterTrackMarks(track, first, { left: 0, width: 900 })).toEqual(
    first.map((clip, index) => ({
      left: clip.left,
      label: ["0:00", "0:00.6", "0:03.1", "0:33.1"][index],
    })),
  );
});

test("unclamped tracks show evenly spaced seconds across real pause spans", () => {
  const track = layoutChapterTrack(units([1000, 1000]), [{ afterIndex: 0, durationMs: 1000 }], null, 900, true);
  expect(chapterTrackMarks(track, track.items, { left: 0, width: 900 })).toEqual([
    { left: 0, label: "0s" },
    { left: 100, label: "1s" },
    { left: 200, label: "2s" },
  ]);
});
