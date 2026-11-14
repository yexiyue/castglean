import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVoicePlayer } from "@/components/voices/voice-player";
import {
  type ChapterPlayerSession,
  useChapterPlayer,
} from "@/hooks/use-chapter-player";
import type { ChapterAudioStatusView_Serialize } from "@/lib/bindings";

type Source = {
  status: ChapterAudioStatusView_Serialize | null;
  projectTitle: string;
};
type ReturnTarget = {
  projectId: string;
  chapterId: string;
  range: { start: number; end: number };
  id: number;
};
type ChapterPlaybackContextValue = {
  player: ChapterPlayerSession;
  setSource: (source: Source | null) => void;
  returnTarget: ReturnTarget | null;
  requestReturn: (target: Omit<ReturnTarget, "id">) => void;
  clearReturn: (id: number) => void;
};
const ChapterPlaybackContext =
  createContext<ChapterPlaybackContextValue | null>(null);

/** One player belongs to the desktop session, not the currently rendered chapter. */
export function ChapterPlaybackProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<Source | null>(null);
  const [returnTarget, setReturnTarget] = useState<ReturnTarget | null>(null);
  const returnSerial = useRef(0);
  const requestReturn = useCallback(
    (target: Omit<ReturnTarget, "id">) =>
      setReturnTarget({ ...target, id: ++returnSerial.current }),
    [],
  );
  const clearReturn = useCallback(
    (id: number) =>
      setReturnTarget((current) => (current?.id === id ? null : current)),
    [],
  );
  const voicePlayer = useVoicePlayer();
  const player = useChapterPlayer(source?.status ?? null, {
    stopOthers: voicePlayer.stop,
    projectTitle: source?.projectTitle,
    monitor: true,
  });
  const value = useMemo(
    () => ({
      player,
      setSource,
      returnTarget,
      requestReturn,
      clearReturn,
    }),
    [player, returnTarget, requestReturn, clearReturn],
  );
  return (
    <ChapterPlaybackContext.Provider value={value}>
      {children}
    </ChapterPlaybackContext.Provider>
  );
}

export function useChapterPlayback() {
  const value = useContext(ChapterPlaybackContext);
  if (!value) throw new Error("ChapterPlaybackProvider is required");
  return value;
}
