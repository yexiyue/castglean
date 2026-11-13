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

/** 参与顺序时间轴的最小单元形状：有音频（durationMs）即可播。 */
export interface TimedUnit {
  index: number;
  durationMs: number | null;
  mediaId: string | null;
  status?: string;
}

export interface TimelineEntry<T extends TimedUnit> {
  unit: T;
  start: number;
  end: number;
}

/**
 * 单元在整章/连播时间轴中的起止时间（秒）；只统计实际产出音频的单元，
 * 空白透明通过；失败、缺失与未生成单元终止连续区间。
 */
export function unitTimeline<T extends TimedUnit>(
  units: T[],
): TimelineEntry<T>[] {
  let cursor = 0;
  const timeline = [];
  for (const unit of units) {
    if (unit.status === "empty") continue;
    if (
      unit.durationMs == null ||
      unit.mediaId == null ||
      !Number.isFinite(unit.durationMs) ||
      unit.durationMs < 0
    )
      break;
    const start = cursor;
    cursor += unit.durationMs / 1000;
    timeline.push({ unit, start, end: cursor });
  }
  return timeline;
}

export function timelineTotal(timeline: TimelineEntry<TimedUnit>[]): number {
  return timeline.length ? timeline[timeline.length - 1].end : 0;
}

/** 播放时间（秒）→ 所在单元条目；超出末尾（已播完）返回 null。 */
export function timelineAt<T extends TimedUnit>(
  timeline: TimelineEntry<T>[],
  time: number,
): TimelineEntry<T> | null {
  if (!Number.isFinite(time) || time < 0) return null;
  return timeline.find((entry) => time < entry.end) ?? null;
}

export function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
