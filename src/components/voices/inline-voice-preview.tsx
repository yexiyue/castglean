import { Trans, useLingui } from "@lingui/react/macro";
import { LoaderCircleIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useVoicePlayer } from "./voice-player";

export function InlineVoicePreview({
  label,
  name,
  audioId,
  loadAudio,
  disabled,
}: {
  label: string;
  name: string;
  audioId?: string;
  loadAudio?: () => Promise<string>;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const { playingId, reserveInline, toggleInline, stopInline, inlineErrorId } =
    useVoicePlayer();
  const mounted = useRef(false);
  const activeId = useRef<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = audioId ?? resolved;
  const playing = !!current && current === playingId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (activeId.current) stopInline(activeId.current);
    };
  }, [stopInline]);

  async function toggle() {
    if (loading || (!audioId && !loadAudio)) return;
    const isCurrentRequest = reserveInline();
    setLoading(true);
    setFailed(false);
    try {
      // The host can replace the asset referenced by a result. Resolve it
      // again on retry, but reuse the active lease when pausing/resuming.
      const id =
        audioId ??
        (current === inlineErrorId ? null : current) ??
        (await loadAudio?.());
      if (!mounted.current || !isCurrentRequest() || !id) return;
      activeId.current = id;
      if (!audioId) setResolved(id);
      await toggleInline(id, name);
    } catch {
      if (mounted.current) {
        setResolved(null);
        setFailed(true);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  return (
    <div className="min-w-0">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled || loading}
        onClick={() => void toggle()}
      >
        {loading ? (
          <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
        ) : playing ? (
          <PauseIcon aria-hidden />
        ) : (
          <PlayIcon aria-hidden />
        )}
        {playing
          ? t({ message: "暂停", comment: "试听播放器暂停按钮" })
          : label}
      </Button>
      {(failed || (!!current && current === inlineErrorId)) && (
        <p role="alert" className="text-xs text-destructive">
          <Trans>无法播放这段音频，请重新选择试听。</Trans>
        </p>
      )}
    </div>
  );
}
