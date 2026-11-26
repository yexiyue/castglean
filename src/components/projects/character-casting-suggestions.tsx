import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronRightIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type {
  BindingStateView_Serialize,
  BindingTarget,
  ModelEntry,
  ProfileView_Serialize,
  SuggestionView_Serialize,
} from "@/lib/bindings";
import { cn } from "@/lib/utils";
import { sameTarget, sameVoice } from "@/lib/voice-audition";
import { CastingSuggestionPanel } from "@/components/casting/suggestion-panel";
import {
  characterSectionClassName,
  CharacterDetailSection as Section,
} from "./character-detail-section";

export function CharacterCastingSuggestions({
  projectId,
  projectRevision,
  target,
  suggestion,
  binding,
  profile,
  studio,
  models,
  busy,
  open,
  onOpenChange,
  onSaved,
  onDesign,
}: {
  projectId: string;
  projectRevision: number;
  target: BindingTarget;
  suggestion: SuggestionView_Serialize;
  binding: BindingStateView_Serialize | null;
  profile: ProfileView_Serialize | null;
  studio: VoiceStudio;
  models: ModelEntry[];
  busy: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  onDesign: (target: BindingTarget) => void;
}) {
  const { t } = useLingui();
  const voice = binding?.voice;
  const suggestionEntry = suggestion.targets.find((item) =>
    sameTarget(item.target, target),
  );
  const candidateCount = suggestionEntry?.voiceCandidates.length ?? 0;
  const boundInSuggestions =
    voice && suggestionEntry
      ? suggestionEntry.voiceCandidates.some((candidate) =>
          sameVoice(voice, candidate.voice),
        )
      : false;
  const hasSuggestionEntry = !!suggestionEntry && candidateCount > 0;
  const suggestionContent = (
    <CastingSuggestionPanel
      projectId={projectId}
      projectRevision={projectRevision}
      target={target}
      suggestion={suggestion}
      binding={binding}
      profile={profile}
      models={models}
      studio={studio}
      disabled={busy}
      onAdopted={onSaved}
      onDesign={onDesign}
    />
  );

  return hasSuggestionEntry ? (
    voice ? (
      <Collapsible
        render={<section />}
        open={open}
        onOpenChange={onOpenChange}
        className={characterSectionClassName}
      >
        <h3 className="text-sm font-medium text-foreground">
          <CollapsibleTrigger className="group flex min-h-8 max-w-full items-center gap-2 rounded-sm text-start outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
            <span className="shrink-0 group-hover:underline">
              <Trans>选角建议</Trans>
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {boundInSuggestions ? (
                <Trans>与当前绑定一致</Trans>
              ) : (
                <Trans>候选 {candidateCount} 个</Trans>
              )}
            </span>
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="h-(--collapsible-panel-height) min-w-0 overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
          {suggestionContent}
        </CollapsibleContent>
      </Collapsible>
    ) : (
      <Section title={t`选角建议`}>{suggestionContent}</Section>
    )
  ) : null;
}
