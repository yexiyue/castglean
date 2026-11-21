import type { ChapterAudioStatusView_Serialize } from "./bindings";
import { formatClock } from "./chapter-playback";

const MIN_CLIP_WIDTH = 68;
const MAX_CLIP_WIDTH = 240;
const PLACEHOLDER_WIDTH = 128;
const MIN_GAP_WIDTH = 20;
const MAX_GAP_WIDTH = 112;
const FIT_SCALE = 100;
const SCROLL_SCALE = 40;

type TrackStatus = ChapterAudioStatusView_Serialize;
type PausePreview = { index: number; ms: number } | null;

export function layoutChapterTrack(
  units: TrackStatus["units"],
  pauses: TrackStatus["arrangement"]["pauses"],
  preview: PausePreview,
  viewportWidth: number,
  finished: boolean,
) {
  const pauseByIndex = new Map(
    pauses.map((pause) => [pause.afterIndex, pause.durationMs]),
  );
  const clips = units.filter((unit) => unit.status !== "empty");
  const spans = clips.map((unit, index) => ({
    unit,
    audioMs: unit.mediaId ? unit.durationMs : null,
    duration:
      index === clips.length - 1
        ? 0
        : preview?.index === unit.index
          ? preview.ms
          : (pauseByIndex.get(unit.index) ?? 0),
    hasBoundary: index < clips.length - 1,
  }));

  const clipWidth = (audioMs: number, scale: number) =>
    Math.max(
      MIN_CLIP_WIDTH,
      Math.min(MAX_CLIP_WIDTH, (audioMs * scale) / 1000),
    );
  const gapWidth = (duration: number, scale: number) =>
    Math.max(MIN_GAP_WIDTH, Math.min(MAX_GAP_WIDTH, (duration * scale) / 1000));
  const widthAt = (scale: number) =>
    spans.reduce(
      (sum, span) =>
        sum +
        clipWidth(span.audioMs ?? 0, scale) +
        (span.hasBoundary ? gapWidth(span.duration, scale) : 0),
      0,
    );

  // Durations arrive incrementally, so an unfinished plan uses fixed slots.
  // Once complete, pick the largest comfortable scale that fits if possible.
  let scale = SCROLL_SCALE;
  if (finished && widthAt(0) <= viewportWidth) {
    let low = 0;
    let high = FIT_SCALE;
    if (widthAt(high) <= viewportWidth) {
      scale = high;
    } else {
      for (let i = 0; i < 16; i++) {
        const mid = (low + high) / 2;
        if (widthAt(mid) <= viewportWidth) low = mid;
        else high = mid;
      }
      scale = low;
    }
  }

  let left = 0;
  let elapsedMs: number | null = 0;
  let uniform = finished && scale > 0;
  const items = spans.map(({ unit, audioMs, duration, hasBoundary }) => {
    const width =
      finished && audioMs != null
        ? clipWidth(audioMs, scale)
        : PLACEHOLDER_WIDTH;
    const gap = hasBoundary ? gapWidth(duration, scale) : 0;
    const item = { unit, left, width, gap, duration, elapsedMs };
    uniform &&=
      audioMs != null &&
      width === (audioMs * scale) / 1000 &&
      gap === (duration * scale) / 1000;
    left += width + gap;
    elapsedMs =
      elapsedMs != null && audioMs != null
        ? elapsedMs + audioMs + duration
        : null;
    return item;
  });
  return {
    items,
    total: left,
    uniformScale: uniform ? scale : null,
    elapsedMs,
  };
}

export function chapterTrackMarks(
  track: ReturnType<typeof layoutChapterTrack>,
  visible: ReturnType<typeof layoutChapterTrack>["items"],
  view: { left: number; width: number },
) {
  const start = view.left - 76;
  const end = view.left + view.width;
  if (track.uniformScale == null) {
    return visible.flatMap(({ left, elapsedMs }) => {
      if (elapsedMs == null || left < start || left >= end) return [];
      return [{ left, label: formatTrackTime(elapsedMs) }];
    });
  }
  const scale = track.uniformScale;
  const minStep = Math.max(1, 56 / scale);
  const decade = 10 ** Math.floor(Math.log10(minStep));
  const step =
    ([1, 2, 5, 10].find((factor) => factor * decade >= minStep) ?? 10) * decade;
  const marks = [];
  for (
    let second = Math.max(0, Math.ceil(start / scale / step) * step);
    second * scale < end && second * 1000 < (track.elapsedMs ?? 0);
    second += step
  ) {
    marks.push({ left: second * scale, label: `${second}s` });
  }
  return marks;
}

export function formatTrackTime(ms: number) {
  const clock = formatClock(ms / 1000);
  const fraction = (ms % 1000).toString().padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${clock}.${fraction}` : clock;
}
