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
}

export interface TimelineEntry<T extends TimedUnit> {
  unit: T;
  start: number;
  end: number;
}

/**
 * 单元在整章/连播时间轴中的起止时间（秒）；只统计实际产出音频的单元，
 * 空白、失败与未生成单元不占时长。整章拼接文件与单元串播共用同一条时间轴。
 */
export function unitTimeline<T extends TimedUnit>(
  units: T[],
  includeMissing = false,
): TimelineEntry<T>[] {
  let cursor = 0;
  const timeline = [];
  for (const unit of units) {
    if (unit.durationMs == null || (!includeMissing && unit.mediaId == null))
      continue;
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

/** 从指定单元（含）起第一个可播单元：起点单元未就绪时向后顺延到最近的可播单元。 */
export function firstPlayableFrom<T extends TimedUnit>(
  timeline: TimelineEntry<T>[],
  index: number,
): TimelineEntry<T> | null {
  return timeline.find((entry) => entry.unit.index >= index) ?? null;
}

/** 指定单元的时间轴起点（秒）；单元不在时间轴上时向后顺延，无可播单元返回 null。 */
export function playableStart<T extends TimedUnit>(
  timeline: TimelineEntry<T>[],
  index: number,
): number | null {
  return firstPlayableFrom(timeline, index)?.start ?? null;
}

export function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
