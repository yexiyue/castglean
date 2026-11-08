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
import {
  VoicePlayback,
  type VoicePlaybackSnapshot,
} from "@/lib/voice-playback";

const WavePlayer = lazy(() => import("@/components/waves-cn/wave-player"));
const PlayerContext = createContext<{
  play: (id: string, label: string, transcript?: string) => Promise<void>;
  stop: () => Promise<void>;
}>({ play: async () => {}, stop: async () => {} });
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
  const visible = Boolean(source || error);
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
  const stop = useCallback(() => playback.stop(), [playback]);
  const context = useMemo(
    () => ({
      play: (id: string, label: string, transcript?: string) =>
        playback.play(id, label, transcript),
      stop,
    }),
    [playback, stop],
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
      {(source || error) && (
        <aside
          ref={panel}
          className="bg-card text-card-foreground border-border rounded-surface fixed inset-x-6 bottom-5 z-60 mx-auto flex max-w-5xl flex-col gap-3 border p-4 shadow-lg"
          aria-label={source?.label}
        >
          <div className="flex items-start gap-4">
            <div className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
              <AudioLines className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground text-xs">
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
            <p className="text-muted-foreground max-h-14 overflow-y-auto border-t pt-3 text-xs leading-relaxed">
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
