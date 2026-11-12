import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChapterAudioStatusView_Serialize as StatusView } from "@/lib/bindings";
import {
  claimChapterPlayback,
  firstPlayableFrom,
  releaseChapterPlayback,
  type TimelineEntry,
  timelineAt,
  timelineTotal,
  unitTimeline,
} from "@/lib/chapter-playback";

type Unit = StatusView["units"][number];
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
  /** file：整章产物单文件定位播放；units：单元产物顺序串播。 */
  mode: "file" | "units";
  /** 起播时冻结的队列；串播从所选单元开始，时间轴从零计。 */
  timeline: TimelineEntry<Unit>[];
  duration: number;
}

/**
 * 章节播放会话：从任意已生成单元起播，按正文顺序连播到已生成末尾。
 * 载体对调用方无感——整章产物存在时用单文件定位，否则串播单元文件。
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
    const time =
      session.mode === "units"
        ? (entryRef.current?.start ?? 0) + audio.currentTime
        : audio.currentTime;
    // file 模式由时间反查当前单元；units 模式单元由推进入口维护。
    const unit =
      session.mode === "file"
        ? (timelineAt(session.timeline, time)?.unit ??
          entryRef.current?.unit ??
          null)
        : entryRef.current?.unit;
    setState((current) => ({ ...current, time, unit: unit ?? current.unit }));
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
    if (session.mode === "file") {
      stop();
      return;
    }
    const current = entryRef.current;
    // 只推进起播时已就绪的队列，不把后续生成的单元加入会话。
    const next = current
      ? (session.timeline.find(
          (entry) => entry.unit.index > current.unit.index,
        ) ?? null)
      : firstPlayableFrom(session.timeline, 0);
    if (!next || next.unit.mediaId == null) {
      stop();
      return;
    }
    entryRef.current = next;
    setState((current) => ({ ...current, unit: next.unit }));
    load(audio, next.unit.mediaId, 0, true);
  }, [load, stop]);

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

  /** 从指定单元（含）起播；起点单元未就绪时向后顺延到最近可播单元。 */
  const start = useCallback(
    (unitIndex: number) => {
      const status = statusRef.current;
      if (!status) return;
      const file = status.run.finalMediaId;
      const units = file
        ? status.units
        : status.units.filter((unit) => unit.index >= unitIndex);
      const timeline = unitTimeline(units, !!file);
      const entry = firstPlayableFrom(timeline, unitIndex);
      const mediaId = file ?? entry?.unit.mediaId;
      if (!entry || !mediaId) return;
      const duration = file
        ? (status.run.finalDurationMs ?? 0) / 1000 || timelineTotal(timeline)
        : timelineTotal(timeline);
      stopOthersRef.current?.();
      const audio = ensureAudio();
      claimChapterPlayback(audio);
      sessionRef.current = {
        runId: status.run.id,
        mode: file ? "file" : "units",
        timeline,
        duration,
      };
      entryRef.current = entry;
      setState({
        ...IDLE,
        active: true,
        time: entry.start,
        duration,
        unit: entry.unit,
      });
      load(audio, mediaId, file ? entry.start : 0, true);
    },
    [ensureAudio, load],
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
      if (session.mode === "file") {
        if (pendingSeekRef.current != null) pendingSeekRef.current = clamped;
        else audio.currentTime = clamped;
        reportTime();
        return;
      }
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
      patch({ time: clamped, unit: entry.unit });
    },
    [load, patch, reportTime],
  );

  // 新快照只使已失效的媒体停止，不扩展或改写播放会话。
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.runId !== status?.run.id) {
      stop();
      return;
    }
    if (session.mode === "file") {
      if (sourceIdRef.current !== status.run.finalMediaId) stop();
      return;
    }
    const current = entryRef.current?.unit;
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
