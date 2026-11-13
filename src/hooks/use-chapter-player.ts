import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  commands,
  type ChapterAudioStatusView_Serialize as StatusView,
} from "@/lib/bindings";
import {
  claimChapterPlayback,
  releaseChapterPlayback,
  type TimelineEntry,
  timelineAt,
  timelineTotal,
  unitTimeline,
} from "@/lib/chapter-playback";

type Unit = StatusView["units"][number] & { pauseAfter?: number | null };
const PROTOCOL = "chapter-audio";

export interface ChapterPlayerState {
  /** 播放会话存在；false 表示空闲（无 audio 源）。 */
  active: boolean;
  playing: boolean;
  /** 会话时间轴上的当前位置与总时长（秒）。 */
  time: number;
  duration: number;
  /** 正在播放的单元（跟读高亮与控制条信息源）；会话空闲为 null。 */
  unit: Unit | null;
  failed: boolean;
  pauseAfter?: number | null;
  gapIndex?: number | null;
  revision?: number;
  fromIndex?: number;
  toIndex?: number;
}

const IDLE: ChapterPlayerState = {
  active: false,
  playing: false,
  time: 0,
  duration: 0,
  unit: null,
  failed: false,
};

interface Session {
  runId: string;
  /** 起播时冻结的队列；串播从所选单元开始，时间轴从零计。 */
  timeline: TimelineEntry<Unit>[];
  duration: number;
  gapIndex: number | null;
}

/**
 * 章节播放会话：从任意已生成单元起播，按正文顺序连播到已生成末尾。
 * 播放宿主冻结的 audio/silence 队列，静音同样使用真实媒体时钟。
 * 只消费宿主快照（units + 产物身份），不持有宿主状态投影。
 */
export function useChapterPlayer(
  status: StatusView | null,
  options: { stopOthers?: () => unknown } = {},
) {
  const [state, setState] = useState<ChapterPlayerState>(IDLE);
  const statusRef = useRef(status);
  statusRef.current = status;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playRequestRef = useRef(0);
  const sessionRef = useRef<Session | null>(null);
  const entryRef = useRef<TimelineEntry<Unit> | null>(null);
  /** 当前源对应的媒体身份；跨单元定位时据此判断是否需要换源。 */
  const sourceIdRef = useRef<string | null>(null);
  /** 换源后的定位值，loadedmetadata 就绪时应用。 */
  const pendingSeekRef = useRef<number | null>(null);
  const stopOthersRef = useRef(options.stopOthers);
  stopOthersRef.current = options.stopOthers;

  const patch = useCallback((next: Partial<ChapterPlayerState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const reportTime = useCallback(() => {
    const audio = audioRef.current;
    const session = sessionRef.current;
    if (!audio || !session) return;
    const time = (entryRef.current?.start ?? 0) + audio.currentTime;
    const unit = entryRef.current?.unit;
    setState((current) => ({
      ...current,
      time,
      unit: unit ?? current.unit,
      pauseAfter: unit?.pauseAfter,
    }));
  }, []);

  const stop = useCallback(() => {
    playRequestRef.current++;
    sessionRef.current = null;
    entryRef.current = null;
    pendingSeekRef.current = null;
    sourceIdRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      releaseChapterPlayback(audio);
      audio.removeAttribute("src");
      audio.load();
    }
    setState(IDLE);
  }, []);

  const playOrFail = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !sessionRef.current) return;
    const request = ++playRequestRef.current;
    patch({ failed: false });
    audio.play().catch(() => {
      if (request === playRequestRef.current && sessionRef.current) {
        patch({ playing: false, failed: true });
      }
    });
  }, [patch]);

  /** 换源前冻结播放意图；load 会重置媒体的 paused 状态。 */
  const load = useCallback(
    (
      audio: HTMLAudioElement,
      mediaId: string,
      seekTo: number,
      playing: boolean,
    ) => {
      playRequestRef.current++;
      pendingSeekRef.current = seekTo;
      sourceIdRef.current = mediaId;
      audio.src = convertFileSrc(mediaId, PROTOCOL);
      audio.load();
      if (playing) playOrFail();
    },
    [playOrFail],
  );

  const advance = useCallback(() => {
    const audio = audioRef.current;
    const session = sessionRef.current;
    if (!audio || !session) {
      stop();
      return;
    }
    const current = entryRef.current;
    // 只推进起播时已就绪的队列，不把后续生成的单元加入会话。
    const next = current
      ? session.timeline[session.timeline.indexOf(current) + 1]
      : session.timeline[0];
    if (!next || next.unit.mediaId == null) {
      stop();
      patch({ gapIndex: session.gapIndex });
      return;
    }
    entryRef.current = next;
    setState((current) => ({
      ...current,
      unit: next.unit,
      pauseAfter: next.unit.pauseAfter,
    }));
    load(audio, next.unit.mediaId, 0, true);
  }, [load, stop, patch]);

  const ensureAudio = useCallback(() => {
    const existing = audioRef.current;
    if (existing) return existing;
    const element = new Audio();
    element.preload = "auto";
    element.addEventListener("timeupdate", reportTime);
    element.addEventListener("play", () => {
      if (sessionRef.current) patch({ playing: true });
    });
    element.addEventListener("pause", () => {
      if (sessionRef.current) patch({ playing: false });
    });
    element.addEventListener("ended", advance);
    element.addEventListener("error", () => {
      if (sessionRef.current) patch({ playing: false, failed: true });
    });
    element.addEventListener("loadedmetadata", () => {
      if (pendingSeekRef.current != null) {
        try {
          element.currentTime = pendingSeekRef.current;
        } catch {
          // 元数据不足时放弃本次定位，从单元头播放。
        }
        pendingSeekRef.current = null;
      }
    });
    audioRef.current = element;
    return element;
  }, [advance, patch, reportTime]);

  /** 从指定已完成单元起播，不跨过未就绪起点或缺口。 */
  const start = useCallback(
    async (unitIndex: number) => {
      const status = statusRef.current;
      if (!status?.units.some((u) => u.index === unitIndex && u.mediaId))
        return;
      const request = ++playRequestRef.current;
      let plan: Awaited<ReturnType<typeof commands.chapterAudioPlayback>>;
      try {
        plan = await commands.chapterAudioPlayback(
          status.run.projectId,
          status.run.id,
          unitIndex,
        );
      } catch {
        patch({ failed: true });
        return;
      }
      if (
        request !== playRequestRef.current ||
        statusRef.current?.run.id !== status.run.id
      )
        return;
      const units: Unit[] = plan.entries.flatMap((entry) => {
        const unit = status.units.find((u) => u.index === entry.unitIndex);
        return unit
          ? [
              {
                ...unit,
                mediaId: entry.mediaId,
                durationMs: entry.durationMs,
                pauseAfter: entry.pauseAfter,
              },
            ]
          : [];
      });
      const timeline = unitTimeline(units);
      const entry = timeline[0];
      const mediaId = entry?.unit.mediaId;
      if (!entry || !mediaId) return;
      const duration = timelineTotal(timeline);
      stopOthersRef.current?.();
      const audio = ensureAudio();
      claimChapterPlayback(audio);
      sessionRef.current = {
        runId: status.run.id,
        timeline,
        duration,
        gapIndex: plan.gapIndex,
      };
      entryRef.current = entry;
      setState({
        ...IDLE,
        active: true,
        time: entry.start,
        duration,
        unit: entry.unit,
        pauseAfter: entry.unit.pauseAfter,
        gapIndex: null,
        revision: plan.revision,
        fromIndex: units[0]?.index,
        toIndex: units[units.length - 1]?.index,
      });
      load(audio, mediaId, 0, true);
    },
    [ensureAudio, load, patch],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    const session = sessionRef.current;
    if (!audio || !session) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    claimChapterPlayback(audio);
    stopOthersRef.current?.();
    playOrFail();
  }, [playOrFail]);

  const seek = useCallback(
    (target: number) => {
      const audio = audioRef.current;
      const session = sessionRef.current;
      if (!audio || !session || !Number.isFinite(target)) return;
      const clamped = Math.max(0, Math.min(target, session.duration));
      // 总时长位置对应最后一个单元末端，不能只更新界面而不移动媒体。
      const entry =
        timelineAt(session.timeline, clamped) ??
        session.timeline[session.timeline.length - 1];
      if (!entry || entry.unit.mediaId == null) return;
      const local = clamped - entry.start;
      const playing = !audio.paused;
      entryRef.current = entry;
      if (sourceIdRef.current === entry.unit.mediaId) {
        if (pendingSeekRef.current != null) pendingSeekRef.current = local;
        else audio.currentTime = local;
      } else {
        load(audio, entry.unit.mediaId, local, playing);
      }
      patch({
        time: clamped,
        unit: entry.unit,
        pauseAfter: entry.unit.pauseAfter,
      });
    },
    [load, patch],
  );

  // 新快照只使已失效的媒体停止，不扩展或改写播放会话。
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.runId !== status?.run.id) {
      stop();
      return;
    }
    const current = entryRef.current?.unit;
    if (current?.pauseAfter != null) return;
    if (
      !status.units.some(
        (unit) =>
          unit.index === current?.index && unit.mediaId === current.mediaId,
      )
    )
      stop();
  }, [status, stop]);

  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio) {
        playRequestRef.current++;
        sessionRef.current = null;
        audioRef.current = null;
        audio.pause();
        releaseChapterPlayback(audio);
        audio.removeAttribute("src");
        audio.load();
      }
    },
    [],
  );

  return { state, start, toggle, seek, stop };
}

export type ChapterPlayerSession = ReturnType<typeof useChapterPlayer>;
