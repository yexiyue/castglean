// UI helpers adapted from waves-cn (MIT); WaveSurfer 8 owns playback and plugins.
// https://github.com/Ziane-Badreddine/waves-cn
import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import Hover from "wavesurfer.js/dist/plugins/hover.esm.js";

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

// Canvas colors need computed values; HTML hover labels accept CSS variables.
function useWaveColors() {
  const [colors, setColors] = useState({
    waveColor: "#64748b",
    progressColor: "#2563eb",
  });
  useEffect(() => {
    const update = () => {
      const style = getComputedStyle(document.documentElement);
      setColors({
        waveColor: style.getPropertyValue("--muted-foreground").trim(),
        progressColor: style.getPropertyValue("--primary").trim(),
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return colors;
}

export interface WavePlayerOptions {
  src: string;
  media: HTMLAudioElement;
  peaks: number[][];
  duration: number;
  onError: () => void;
}

export function useWavePlayer({
  src,
  media,
  peaks,
  duration,
  onError,
}: WavePlayerOptions) {
  const container = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const colors = useWaveColors();
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [rate, setRateState] = useState(1);

  useEffect(() => {
    if (!container.current) return;
    const ws = WaveSurfer.create({
      container: container.current,
      url: src,
      media,
      peaks,
      duration,
      height: 48,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      cursorWidth: 0,
      dragToSeek: true,
      // Fresh plugin per instance, including React StrictMode effect replay.
      plugins: [
        Hover.create({
          lineColor: "var(--primary)",
          labelColor: "var(--popover-foreground)",
          labelBackground: "var(--popover)",
          labelSize: 11,
        }),
      ],
    });
    wavesurfer.current = ws;
    ws.setVolume(0.8);
    const unsubscribe = [
      ws.on("ready", () => {
        setIsReady(true);
        void ws.play().catch(onError);
      }),
      ws.on("play", () => setIsPlaying(true)),
      ws.on("pause", () => setIsPlaying(false)),
      ws.on("finish", () => setIsPlaying(false)),
      ws.on("timeupdate", setCurrentTime),
      ws.on("error", onError),
    ];
    return () => {
      for (const stop of unsubscribe) stop();
      ws.destroy();
      wavesurfer.current = null;
    };
  }, [src, media, peaks, duration, onError]);

  useEffect(() => {
    wavesurfer.current?.setOptions(colors);
  }, [colors]);

  const togglePlay = useCallback(() => {
    void wavesurfer.current?.playPause().catch(onError);
  }, [onError]);
  const restart = useCallback(() => {
    wavesurfer.current?.setTime(0);
    void wavesurfer.current?.play().catch(onError);
  }, [onError]);
  const seek = useCallback((fraction: number) => {
    wavesurfer.current?.seekTo(Math.min(1, Math.max(0, fraction)));
  }, []);
  const setVolume = useCallback((next: number) => {
    const value = Math.min(1, Math.max(0, next));
    setVolumeState(value);
    setIsMuted(false);
    wavesurfer.current?.setMuted(false);
    wavesurfer.current?.setVolume(value);
  }, []);
  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    wavesurfer.current?.setMuted(next);
  };
  const setRate = (next: number) => {
    setRateState(next);
    wavesurfer.current?.setPlaybackRate(next, true);
  };
  return {
    container,
    isReady,
    isPlaying,
    currentTime,
    progress: duration > 0 ? currentTime / duration : 0,
    volume,
    isMuted,
    rate,
    togglePlay,
    restart,
    seek,
    setVolume,
    toggleMute,
    setRate,
  };
}
