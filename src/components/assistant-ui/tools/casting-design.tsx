import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronRightIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "@/components/assistant-ui/elements/collapsible-root";
import { CharacterDesignForm } from "@/components/casting/design-form";
import { Button } from "@/components/ui/button";
import { InlineVoicePreview } from "@/components/voices/inline-voice-preview";
import { StudioJobs } from "@/components/voices/studio-jobs";
import { useVoicePlayer } from "@/components/voices/voice-player";
import { useBindingOperations } from "@/hooks/use-binding-operations";
import { useCandidateMutation } from "@/hooks/use-candidate-mutation";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type {
  BindingStateView_Serialize,
  BindingTarget,
  CandidateView,
  DesignDraft,
} from "@/lib/bindings";

export function castingDesignScope(
  projectId: string,
  runId: string,
  target: BindingTarget,
) {
  return JSON.stringify([
    "casting-design",
    projectId,
    runId,
    target.kind,
    target.kind === "character" ? target.character_id : null,
  ]);
}

export function CastingDesign({
  projectId,
  scope,
  candidates,
  target,
  name,
  draft,
  studio,
  binding,
  disabled,
}: {
  projectId: string;
  scope: string;
  candidates: CandidateView[];
  target: BindingTarget;
  name: string;
  draft: DesignDraft;
  studio: VoiceStudio;
  binding: BindingStateView_Serialize | null;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div data-slot="casting-design" className="min-w-0 space-y-2">
      <CollapsibleRoot open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          ref={trigger}
          render={<Button size="sm" variant="ghost" />}
          disabled={disabled && !open}
          className="group/casting-design h-auto max-w-full py-1.5 text-start whitespace-normal"
        >
          <ChevronRightIcon
            aria-hidden
            className="size-3 group-aria-expanded/casting-design:rotate-90"
          />
          <Trans>目录中没有合适的，编辑设计草稿</Trans>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <CharacterDesignForm
            projectId={projectId}
            target={target}
            targetLabel={name}
            initial={draft}
            studio={studio}
            scope={scope}
            disabled={disabled}
            onClose={() => {
              setOpen(false);
              trigger.current?.focus({ preventScroll: true });
            }}
          />
        </CollapsibleContent>
      </CollapsibleRoot>
      <StudioJobs studio={studio} scope={scope} inline />
      {candidates.map((candidate) => (
        <CastingDesignCandidate
          key={candidate.id}
          candidate={candidate}
          projectId={projectId}
          target={target}
          binding={binding}
          disabled={
            disabled || studio.pending || studio.loading || studio.loadError
          }
        />
      ))}
    </div>
  );
}

function CastingDesignCandidate({
  candidate,
  projectId,
  target,
  binding,
  disabled,
}: {
  candidate: CandidateView;
  projectId: string;
  target: BindingTarget;
  binding: BindingStateView_Serialize | null;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const player = useVoicePlayer();
  const mutation = useCandidateMutation(
    candidate.id,
    candidate.voice.name,
    player.stop,
  );
  const operations = useBindingOperations(projectId);
  const libraryId = candidate.saved_id;
  const bound =
    !!libraryId &&
    binding?.voice?.kind === "library" &&
    binding.voice.id === libraryId;

  return (
    <section
      data-slot="casting-design-candidate"
      className="min-w-0 space-y-1.5 border-t border-border/60 py-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="min-w-0 text-sm font-medium wrap-anywhere">
          {candidate.voice.name}
        </p>
        <p role="status" className="text-xs text-muted-foreground">
          {bound ? (
            <Trans>当前绑定</Trans>
          ) : libraryId ? (
            <Trans comment="候选已经正式保存到音色库">已保存到音色库</Trans>
          ) : (
            <Trans comment="候选还未正式保存">尚未保存</Trans>
          )}
        </p>
      </div>
      <p
        className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground"
        title={candidate.voice.transcript}
      >
        {candidate.voice.transcript}
      </p>
      <div className="flex flex-wrap items-start gap-1">
        <InlineVoicePreview
          audioId={candidate.audio}
          name={candidate.voice.name}
          label={t({ message: "试听设计候选" })}
          disabled={!!mutation.operation}
        />
        {libraryId ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={
              bound ||
              disabled ||
              operations.operation !== null ||
              operations.profileOperation !== null ||
              operations.identityOperation !== null
            }
            onClick={() =>
              void operations.start(target, {
                type: "bind",
                voice: { kind: "library", id: libraryId },
              })
            }
          >
            <Trans>绑定到此目标</Trans>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={
              disabled || !!mutation.operation || mutation.auditionPending
            }
            onClick={mutation.save}
          >
            <Trans comment="将候选正式加入个人音色库">保存到音色库</Trans>
          </Button>
        )}
      </div>
    </section>
  );
}
