import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { DelegatedToolContextValue } from "@/components/assistant-ui/tools/delegated-tool-card";
import { CastingSuggestionPanel } from "@/components/projects/casting-suggestion-panel";
import { Button } from "@/components/ui/button";
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
 * panel the character center uses, backed by the same host commands. The
 * design-draft flow stays in the character center via `onDesignInCenter`.
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
  }, [context.projectId, reference.id, revision, context.version]);
  const stale = suggestion
    ? suggestion.charactersStale || suggestion.catalogStale
    : false;
  return (
    <div data-casting-review={reference.id} className="space-y-1 px-4 py-2">
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
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs text-destructive">
            {modelResources.error ? (
              <Trans>模型资源读取失败。</Trans>
            ) : (
              <Trans>选角建议读取未完成，已有内容可能过时。</Trans>
            )}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (modelResources.error) void modelResources.refresh();
              if (failed) setRevision((value) => value + 1);
            }}
          >
            <Trans>重新读取</Trans>
          </Button>
        </div>
      ) : null}
      {suggestion
        ? suggestion.targets.map((entry) => {
            const binding =
              bindings.find((item) => sameTarget(item.target, entry.target)) ??
              null;
            const profile =
              profiles.find((item) => sameTarget(item.target, entry.target)) ??
              null;
            const open =
              expanded !== null && sameTarget(expanded, entry.target);
            const currentVoice = binding?.voice
              ? binding.origin?.origin === "manual"
                ? t`人工绑定`
                : t`已绑定`
              : t`未绑定`;
            return (
              <div key={targetKey(entry.target)} className="min-w-0">
                <button
                  type="button"
                  aria-expanded={open}
                  className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-1 text-start text-sm transition-colors hover:bg-accent"
                  onClick={() => setExpanded(open ? null : entry.target)}
                >
                  <ChevronRightIcon
                    aria-hidden
                    className={
                      open
                        ? "size-3.5 shrink-0 rotate-90 text-muted-foreground transition-transform"
                        : "size-3.5 shrink-0 text-muted-foreground transition-transform"
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {entry.target.kind === "narrator"
                      ? t`旁白`
                      : targetName(entry.target, context)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {currentVoice} · {t`${entry.voiceCandidates.length} 个候选`}
                  </span>
                </button>
                {open ? (
                  <div className="border-t px-1 pt-2">
                    <CastingSuggestionPanel
                      projectId={context.projectId}
                      projectRevision={context.projectRevision ?? 0}
                      target={entry.target}
                      suggestion={suggestion}
                      binding={binding}
                      profile={profile}
                      models={models}
                      studio={studio}
                      disabled={
                        reading ||
                        failed ||
                        modelResources.loading ||
                        !!modelResources.error
                      }
                      allowDesignIntake={false}
                      onAdopted={async () => setRevision((value) => value + 1)}
                      onRefresh={async () => {
                        await context.onRefreshProject?.();
                        setRevision((value) => value + 1);
                      }}
                      onDesign={(target, draft) =>
                        context.onDesignInCenter?.(target, draft)
                      }
                    />
                  </div>
                ) : null}
              </div>
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
    </div>
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
