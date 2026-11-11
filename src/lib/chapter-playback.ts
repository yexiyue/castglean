/**
 * 整章播放与音色试听互斥：同一时间至多一个音源。
 * 章节播放条登记自己的 audio 元素；试听播放器开始前调用暂停。
 */
let current: HTMLAudioElement | null = null;

export function claimChapterPlayback(audio: HTMLAudioElement) {
  if (current && current !== audio) current.pause();
  current = audio;
}

export function releaseChapterPlayback(audio: HTMLAudioElement) {
  if (current === audio) current = null;
}

export function pauseChapterPlayback() {
  current?.pause();
}

/** 单元在整章音频中的起止时间；只统计实际产出音频的单元。 */
export function unitTimeline<T extends { durationMs: number | null }>(
  units: T[],
): { unit: T; start: number; end: number }[] {
  let cursor = 0;
  const timeline = [];
  for (const unit of units) {
    if (unit.durationMs == null) continue;
    const start = cursor;
    cursor += unit.durationMs / 1000;
    timeline.push({ unit, start, end: cursor });
  }
  return timeline;
}

export function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
