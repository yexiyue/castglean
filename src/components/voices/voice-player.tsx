import { Trans } from "@lingui/react/macro";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AudioLines, X } from "lucide-react";
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { commands } from "@/lib/bindings";
import { pauseChapterPlayback } from "@/lib/chapter-playback";
import {
  VoicePlayback,
  type VoicePlaybackSnapshot,
} from "@/lib/voice-playback";

const WavePlayer = lazy(() => import("@/components/waves-cn/wave-player"));
const PlayerContext = createContext<{
  play: (id: string, label: string, transcript?: string) => Promise<void>;
  toggle: (id: string, label: string, transcript?: string) => Promise<void>;
  playingId: string | null;
  inlineErrorId: string | null;
  reserveInline: () => () => boolean;
  toggleInline: (id: string, label: string) => Promise<void>;
  stopInline: (id: string) => void;
  stop: () => Promise<void>;
}>({
  play: async () => {},
  toggle: async () => {},
  playingId: null,
  inlineErrorId: null,
  reserveInline: () => () => false,
  toggleInline: async () => {},
  stopInline: () => {},
  stop: async () => {},
});
export function useVoicePlayer() {
  return useContext(PlayerContext);
}
export function VoicePlayerProvider({ children }: { children: ReactNode }) {
  const [{ source, error }, setSnapshot] = useState<VoicePlaybackSnapshot>({
    source: null,
    error: false,
  });
  const [playback] = useState(
    () =>
      new VoicePlayback(
        commands,
        (id) => new Audio(convertFileSrc(id, "voice-audio")),
        setSnapshot,
      ),
  );
  const panel = useRef<HTMLElement | null>(null);
  const inlineId = useRef<string | null>(null);
  const playbackRequest = useRef(0);
  const media = source?.playback?.media;
  const [playingMedia, setPlayingMedia] = useState<HTMLAudioElement | null>(
    null,
  );
  useEffect(() => {
    if (!media) return;
    const sync = () =>
      setPlayingMedia(media.paused || media.ended ? null : media);
    const events = ["play", "pause", "ended", "error", "emptied"];
    for (const event of events) media.addEventListener(event, sync);
    sync();
    return () => {
      for (const event of events) media.removeEventListener(event, sync);
    };
  }, [media]);
  const playingId =
    !error && media && playingMedia === media ? source.id : null;
  const visible = inlineId.current === null && Boolean(source || error);
  const inlineErrorId = error ? inlineId.current : null;
  useEffect(() => {
    if (!visible || !panel.current) return;
    const element = panel.current;
    const update = () =>
      document.documentElement.style.setProperty(
        "--voice-player-inset",
        `${Math.ceil(element.getBoundingClientRect().height) + 40}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--voice-player-inset");
    };
  }, [visible]);
  const stop = useCallback(() => {
    playbackRequest.current++;
    return playback.stop();
  }, [playback]);
  const stopInline = useCallback(
    (id: string) => {
      if (inlineId.current === id) void playback.stop();
    },
    [playback],
  );
  const context = useMemo(
    () => ({
      play: async (id: string, label: string, transcript?: string) => {
        playbackRequest.current++;
        inlineId.current = null;
        // 同一时间至多一个音源：开始试听前暂停整章播放。
        pauseChapterPlayback();
        await playback.play(id, label, transcript);
      },
      toggle: async (id: string, label: string, transcript?: string) => {
        playbackRequest.current++;
        inlineId.current = null;
        pauseChapterPlayback();
        await playback.toggle(id, label, transcript);
      },
      reserveInline: () => {
        const request = ++playbackRequest.current;
        return () => request === playbackRequest.current;
      },
      toggleInline: async (id: string, label: string) => {
        const movingToInline = inlineId.current !== id;
        inlineId.current = id;
        pauseChapterPlayback();
        if (movingToInline) await playback.play(id, label, undefined, true);
        else await playback.toggle(id, label, undefined, true);
      },
      stopInline,
      inlineErrorId,
      playingId,
      stop,
    }),
    [playback, playingId, inlineErrorId, stop, stopInline],
  );
  useEffect(
    () => () => {
      void playback.dispose().catch(() => {});
    },
    [playback],
  );
  return (
    <PlayerContext value={context}>
      {children}
      {visible && (
        <aside
          ref={panel}
          className="fixed inset-x-6 bottom-5 z-60 mx-auto flex max-w-5xl flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg"
          aria-label={source?.label}
        >
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <AudioLines className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                <Trans comment="底部全局播放器的用途标签">音色试听</Trans>
              </p>
              <p className="truncate text-sm font-medium">{source?.label}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={stop}>
              <X data-icon="inline-start" />
              <Trans comment="停止音色试听并释放音频">停止</Trans>
            </Button>
          </div>
          {source && (
            <Suspense fallback={<Skeleton className="h-24 w-full" />}>
              {source.playback ? (
                <WavePlayer
                  key={source.id}
                  src={convertFileSrc(source.id, "voice-audio")}
                  media={source.playback.media}
                  peaks={source.playback.waveform.peaks}
                  duration={source.playback.waveform.duration}
                  onError={source.playback.onError}
                />
              ) : (
                <Skeleton className="h-24 w-full" />
              )}
            </Suspense>
          )}
          {source?.transcript && (
            <p className="max-h-14 overflow-y-auto border-t pt-3 text-xs leading-relaxed text-muted-foreground">
              {source.transcript}
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                <Trans>无法播放这段音频，请重新选择试听。</Trans>
              </AlertDescription>
            </Alert>
          )}
        </aside>
      )}
    </PlayerContext>
  );
}
