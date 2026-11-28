import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "@/components/assistant-ui/elements/collapsible-root";
import { ErrorState } from "@/components/assistant-ui/elements/error-state";
import {
  CastingDesign,
  castingDesignScope,
} from "@/components/assistant-ui/tools/casting-design";
import type { DelegatedToolContextValue } from "@/components/assistant-ui/tools/delegated-tool-context";
import { CastingSuggestionPanel } from "@/components/casting/suggestion-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBindingOperations } from "@/hooks/use-binding-operations";
import { useModelResources } from "@/hooks/use-model-resources";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import {
  type BindingStateView_Serialize,
  type BindingTarget,
  commands,
  type ProfileView_Serialize,
  type ResultReference,
  type SuggestionView_Serialize,
} from "@/lib/bindings";
import { sameTarget } from "@/lib/voice-audition";

/**
 * In-card casting review: per-target accordion rows over the same comparison
 * panel the character center uses, backed by the same host commands.
 */
export function CastingResultSurface({
  reference,
  context,
}: {
  reference: ResultReference;
  context: DelegatedToolContextValue;
}) {
  const { t } = useLingui();
  const modelResources = useModelResources();
  const models =
    modelResources.loading || modelResources.error
      ? []
      : modelResources.entries;
  const studio = useVoiceStudio();
  const bindingOperations = useBindingOperations(context.projectId);
  const [suggestion, setSuggestion] = useState<SuggestionView_Serialize | null>(
    null,
  );
  const [bindings, setBindings] = useState<BindingStateView_Serialize[]>([]);
  const [profiles, setProfiles] = useState<ProfileView_Serialize[]>([]);
  const [reading, setReading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState<BindingTarget | null>(null);
  // Read again on version bumps (workspace returns, adoption elsewhere) and
  // after in-card adoption so both surfaces show one authoritative state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Mutable domain state revalidates on version bumps.
  useEffect(() => {
    let live = true;
    setFailed(false);
    setReading(true);
    async function read() {
      const [nextSuggestion, nextBindings, nextProfiles] = await Promise.all([
        commands.voiceBindingSuggestion(context.projectId, reference.id),
        commands.voiceBindingBindings(context.projectId),
        commands.voiceBindingProfiles(context.projectId),
      ]);
      if (!live) return;
      if (!nextSuggestion) throw new Error("not_found");
      setSuggestion(nextSuggestion);
      setBindings(nextBindings);
      setProfiles(nextProfiles);
    }
    void read()
      .catch(() => {
        if (live) setFailed(true);
      })
      .finally(() => {
        if (live) setReading(false);
      });
    return () => {
      live = false;
    };
  }, [
    context.projectId,
    reference.id,
    revision,
    context.version,
    bindingOperations.completion,
  ]);
  const stale = suggestion
    ? suggestion.charactersStale || suggestion.catalogStale
    : false;
  return (
    <Card
      size="sm"
      data-casting-review={reference.id}
      className="gap-2 bg-muted/50 ring-0"
    >
      <CardHeader>
        <CardTitle className="font-semibold">
          <Trans>选角建议</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {stale ? (
          <p className="text-xs text-warning-foreground">
            <Trans>目录或角色身份在建议生成后有变化，采用前请核对。</Trans>
          </p>
        ) : null}
        {reading && !suggestion ? (
          <p role="status" className="px-0 py-1 text-xs text-muted-foreground">
            <Trans>正在读取选角建议…</Trans>
          </p>
        ) : null}
        {failed || modelResources.error ? (
          <ErrorState
            title={
              modelResources.error
                ? t`模型资源读取失败。`
                : t`选角建议读取未完成，已有内容可能过时。`
            }
            retryLabel={t`重新读取`}
            retrying={reading || modelResources.loading}
            onRetry={() => {
              if (modelResources.error) void modelResources.refresh();
              if (failed) setRevision((value) => value + 1);
            }}
          />
        ) : null}
        {suggestion
          ? suggestion.targets.map((entry) => {
              const binding =
                bindings.find((item) =>
                  sameTarget(item.target, entry.target),
                ) ?? null;
              const profile =
                profiles.find((item) =>
                  sameTarget(item.target, entry.target),
                ) ?? null;
              const open =
                expanded !== null && sameTarget(expanded, entry.target);
              const name =
                entry.target.kind === "narrator"
                  ? t`旁白`
                  : targetName(entry.target, context);
              const disabled =
                reading ||
                failed ||
                modelResources.loading ||
                !!modelResources.error;
              const scope = castingDesignScope(
                context.projectId,
                suggestion.runId,
                entry.target,
              );
              const designedCandidates = studio.candidates.filter((candidate) =>
                studio.jobs.some(
                  (job) =>
                    job.state === "Succeeded" &&
                    job.candidate === candidate.id &&
                    studio.scopeForJob(job.id) === scope,
                ),
              );
              const previewCount = suggestion.previews.filter(
                (preview) =>
                  sameTarget(preview.target, entry.target) &&
                  preview.status === "available" &&
                  preview.candidate,
              ).length;
              const candidateCount =
                entry.voiceCandidates.length +
                designedCandidates.length +
                previewCount;
              const currentVoice = binding?.voice
                ? binding.origin?.origin === "manual"
                  ? t`人工绑定`
                  : t`已绑定`
                : t`未绑定`;
              return (
                <CollapsibleRoot
                  key={targetKey(entry.target)}
                  className="min-w-0 border-b border-border/60 pb-1 last:border-b-0"
                  open={open}
                  onOpenChange={(nextOpen) =>
                    setExpanded((current) =>
                      nextOpen
                        ? entry.target
                        : current && sameTarget(current, entry.target)
                          ? null
                          : current,
                    )
                  }
                >
                  <CollapsibleTrigger
                    render={<Button variant="ghost" />}
                    className="group/casting-target h-auto min-h-8 w-full flex-wrap justify-start p-1 text-start hover:bg-background/65 aria-expanded:bg-background/65"
                  >
                    <ChevronRightIcon
                      aria-hidden
                      className="size-3.5 text-muted-foreground group-aria-expanded/casting-target:rotate-90"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {currentVoice} · {t`${candidateCount} 个候选`}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="min-w-0 space-y-2 py-2 ps-3">
                    <CastingSuggestionPanel
                      projectId={context.projectId}
                      projectRevision={context.projectRevision ?? 0}
                      target={entry.target}
                      suggestion={suggestion}
                      binding={binding}
                      profile={profile}
                      models={models}
                      studio={studio}
                      disabled={disabled}
                      inline
                      onAdopted={async () => setRevision((value) => value + 1)}
                      onRefresh={async () => {
                        await context.onRefreshProject?.();
                        setRevision((value) => value + 1);
                      }}
                    />
                    {entry.design && (
                      <CastingDesign
                        projectId={context.projectId}
                        scope={scope}
                        candidates={designedCandidates}
                        target={entry.target}
                        name={name}
                        draft={entry.design}
                        studio={studio}
                        binding={binding}
                        disabled={disabled || suggestion.charactersStale}
                      />
                    )}
                  </CollapsibleContent>
                </CollapsibleRoot>
              );
            })
          : null}
        {suggestion && context.onReview ? (
          <div className="flex justify-start pt-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => context.onReview?.(reference)}
            >
              <Trans>在角色中心打开</Trans>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function targetKey(target: BindingTarget): string {
  return target.kind === "narrator"
    ? "narrator"
    : `character:${target.character_id}`;
}

function targetName(
  target: BindingTarget & { kind: "character" },
  context: DelegatedToolContextValue,
): string {
  return context.targetName?.(target) ?? target.character_id;
}
