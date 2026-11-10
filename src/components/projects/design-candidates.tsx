import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  type CandidateAction,
  VoiceCandidateCard,
} from "@/components/voices/voice-candidate-card";
import { useVoicePlayer } from "@/components/voices/voice-player";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import {
  type BindingTarget,
  type CandidateView,
  commands,
} from "@/lib/bindings";

export type BindTargetOption = { target: BindingTarget; name: string };

function optionKey(target: BindingTarget): string {
  return target.kind === "narrator"
    ? "narrator"
    : `character:${target.character_id}`;
}

function DesignCandidateCard({
  candidate,
  studio,
  busy,
  options,
  initialTarget,
  onBind,
}: {
  candidate: CandidateView;
  studio: VoiceStudio;
  busy: boolean;
  options: BindTargetOption[];
  initialTarget: BindingTarget;
  onBind: (target: BindingTarget, libraryId: string) => void;
}) {
  const { t } = useLingui();
  const player = useVoicePlayer();
  const [action, setAction] = useState<CandidateAction | null>(null);
  const [failure, setFailure] = useState<CandidateAction | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [chosen, setChosen] = useState(() => optionKey(initialTarget));
  const libraryId = candidate.saved_id || savedId;
  const target = options.find(
    (option) => optionKey(option.target) === chosen,
  )?.target;
  return (
    <VoiceCandidateCard
      candidate={candidate}
      busy={busy || action !== null}
      action={action}
      failure={failure}
      onPlay={() =>
        void player.play(
          candidate.audio,
          candidate.voice.name,
          candidate.voice.transcript,
        )
      }
      onSave={() =>
        void studio.run(async () => {
          setAction("save");
          setFailure(null);
          try {
            const saved = await commands.saveVoiceCandidate(candidate.id);
            setSavedId(saved.id);
          } catch {
            setFailure("save");
          } finally {
            setAction(null);
          }
        })
      }
      onRemove={() =>
        void studio.run(async () => {
          setAction("remove");
          setFailure(null);
          try {
            await player.stop();
            await commands.discardVoiceCandidate(candidate.id);
          } catch {
            setFailure("remove");
          } finally {
            setAction(null);
          }
        })
      }
      footerActions={
        libraryId && target ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || action !== null}
              onClick={() => onBind(target, libraryId)}
            >
              <Trans>绑定到此目标</Trans>
            </Button>
            <NativeSelect
              aria-label={t`改选绑定目标`}
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
              className="min-w-0"
            >
              {options.map((option) => (
                <option
                  key={optionKey(option.target)}
                  value={optionKey(option.target)}
                >
                  {option.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null
      }
    />
  );
}

/**
 * Design candidates for one target: audition, save to the library, then bind
 * back — preselected to the target that motivated the design, changeable.
 */
export function DesignCandidates({
  candidates,
  studio,
  busy,
  preselected,
  options,
  onBind,
}: {
  candidates: CandidateView[];
  studio: VoiceStudio;
  busy: boolean;
  preselected: BindingTarget;
  options: BindTargetOption[];
  onBind: (target: BindingTarget, libraryId: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">
        <Trans>设计候选</Trans>
      </h3>
      {candidates.map((candidate) => (
        <DesignCandidateCard
          key={candidate.id}
          candidate={candidate}
          studio={studio}
          busy={busy}
          options={options}
          initialTarget={preselected}
          onBind={onBind}
        />
      ))}
    </section>
  );
}
