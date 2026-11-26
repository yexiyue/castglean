import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  type ChapterAudioBlocker_Serialize as ChapterAudioBlocker,
  type ChapterAudioInput,
  type ChapterAudioRedo,
  commands,
} from "@/lib/bindings";

/** Preflight results apply only to the exact input and generation plan that requested them. */
export function useChapterAudioPreflight({
  desktop,
  visible,
  active,
  projectId,
  chapterId,
  planInput,
  redoKey,
  analysisVersion,
  validationKey,
}: {
  desktop: boolean;
  visible: boolean;
  active: boolean;
  projectId: string;
  chapterId: string;
  planInput: ChapterAudioInput;
  redoKey: string | null | undefined;
  analysisVersion?: string | null;
  validationKey: string;
}) {
  const [checking, setChecking] = useState(false);
  const [preflight, setPreflight] = useState<{
    key: string;
    state: "checking" | "ready" | "blocked" | "failed";
    blockers?: ChapterAudioBlocker[];
    redo?: ChapterAudioRedo | null;
  } | null>(null);
  const checkSerial = useRef(0);
  const validationScope = useRef(validationKey);
  validationScope.current = validationKey;

  const block = useCallback(
    (blockers: ChapterAudioBlocker[]) => {
      checkSerial.current++;
      setChecking(false);
      setPreflight({ key: validationKey, state: "blocked", blockers });
    },
    [validationKey],
  );

  const check = async () => {
    if (!desktop || validationScope.current !== validationKey) return;
    const request = ++checkSerial.current;
    const current = () =>
      checkSerial.current === request &&
      validationScope.current === validationKey;
    setChecking(true);
    setPreflight({ key: validationKey, state: "checking" });
    try {
      const next = await commands.chapterAudioCheck(
        projectId,
        chapterId,
        planInput,
        redoKey ?? null,
      );
      if (current()) {
        setPreflight({
          key: validationKey,
          state: next.ready ? "ready" : "blocked",
          blockers: next.blockers.length ? next.blockers : undefined,
          redo: next.redo ?? null,
        });
      }
    } catch (error) {
      if (current()) setPreflight({ key: validationKey, state: "failed" });
      throw error;
    } finally {
      if (checkSerial.current === request) setChecking(false);
    }
  };
  const checkSelection = useEffectEvent(() => void check().catch(() => {}));
  const canCheck =
    desktop &&
    visible &&
    !active &&
    (planInput.mode === "narrator" ? !!planInput.voice : !!analysisVersion);
  const preflightKey = canCheck ? validationKey : null;
  useEffect(() => {
    if (preflightKey !== null) checkSelection();
    else setChecking(false);
    return () => {
      checkSerial.current++;
    };
  }, [preflightKey]);

  return {
    validationScope,
    check,
    checking,
    preflight: preflight?.key === validationKey ? preflight : null,
    block,
  };
}
