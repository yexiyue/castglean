import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { VoiceCandidateCard } from "@/components/voices/voice-candidate-card";
import { useVoicePlayer } from "@/components/voices/voice-player";
import { useCandidateMutation } from "@/hooks/use-candidate-mutation";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type { BindingTarget, CandidateView } from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";

export type BindTargetOption = { target: BindingTarget; name: string };
const targetSchema = z.object({ chosen: z.string().min(1) });

function optionKey(target: BindingTarget): string {
  return target.kind === "narrator"
    ? "narrator"
    : `character:${target.character_id}`;
}

function DesignCandidateCard({
  candidate,
  projectId,
  busy,
  options,
  initialTarget,
  onBind,
}: {
  candidate: CandidateView;
  projectId: string;
  busy: boolean;
  options: BindTargetOption[];
  initialTarget: BindingTarget | null;
  onBind: (target: BindingTarget, libraryId: string) => void;
}) {
  const { t } = useLingui();
  const player = useVoicePlayer();
  const mutation = useCandidateMutation(
    candidate.id,
    candidate.voice.name,
    player.stop,
  );
  const [draft, setDraft] = useWorkspaceState(
    projectId,
    `candidate-target:${candidate.id}`,
    { chosen: initialTarget ? optionKey(initialTarget) : "", touched: false },
  );
  const form = useForm({
    defaultValues: { chosen: draft.chosen },
    resolver: zodResolver(targetSchema),
  });
  const [query, setQuery] = useState<string | null>(null);
  const chosen = form.watch("chosen");
  const originKey = initialTarget ? optionKey(initialTarget) : "";
  useEffect(() => {
    if (!draft.touched && !draft.chosen && originKey) {
      form.setValue("chosen", originKey);
      setDraft({ chosen: originKey, touched: false });
    }
  }, [draft, originKey, form, setDraft]);
  const libraryId = candidate.saved_id;
  const target = options.find(
    (option) => optionKey(option.target) === chosen,
  )?.target;
  const choices = options.map((option) => ({
    value: optionKey(option.target),
    label: option.name,
  }));
  const selected = chosen
    ? (choices.find((option) => option.value === chosen) ?? {
        value: chosen,
        label: t`所选角色不可用`,
      })
    : null;
  return (
    <VoiceCandidateCard
      candidate={candidate}
      busy={busy || !!mutation.operation}
      mutationDisabled={mutation.auditionPending}
      action={mutation.operation?.busy ? mutation.operation.action : null}
      failure={mutation.stopFailed ? "remove" : null}
      onPlay={() =>
        void player.play(
          candidate.audio,
          candidate.voice.name,
          candidate.voice.transcript,
        )
      }
      onSave={mutation.save}
      onRemove={() => void mutation.remove()}
      footerActions={
        libraryId ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy || !!mutation.operation || !target || query !== null
              }
              onClick={() =>
                void form.handleSubmit(({ chosen: selectedKey }) => {
                  const selectedTarget = options.find(
                    (option) => optionKey(option.target) === selectedKey,
                  )?.target;
                  if (selectedTarget && query === null)
                    onBind(selectedTarget, libraryId);
                })()
              }
            >
              <Trans>绑定到此目标</Trans>
            </Button>
            <Controller
              control={form.control}
              name="chosen"
              render={({ field }) => (
                <Combobox
                  items={choices}
                  value={selected}
                  inputValue={query ?? selected?.label ?? ""}
                  onInputValueChange={(value, details) => {
                    if (details.reason === "input-change") setQuery(value);
                  }}
                  onOpenChange={(open) => {
                    if (!open) setQuery(null);
                  }}
                  isItemEqualToValue={(a, b) => a.value === b.value}
                  onValueChange={(item) => {
                    const value = item?.value ?? "";
                    setQuery(null);
                    field.onChange(value);
                    setDraft({ chosen: value, touched: true });
                  }}
                >
                  <ComboboxInput
                    aria-label={t`改选绑定目标`}
                    placeholder={t`请选择绑定目标`}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.nativeEvent.isComposing &&
                        query !== null &&
                        event.currentTarget.getAttribute("aria-expanded") ===
                          "true" &&
                        !event.currentTarget.getAttribute(
                          "aria-activedescendant",
                        )
                      ) {
                        // Highlight can lag a fast ArrowDown + Enter. Keep the
                        // query instead of closing and restoring the old target.
                        event.preventDefault();
                        (
                          event as typeof event & {
                            preventBaseUIHandler?: () => void;
                          }
                        ).preventBaseUIHandler?.();
                      }
                    }}
                    disabled={busy || !!mutation.operation}
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>
                      <Trans>没有匹配的角色</Trans>
                    </ComboboxEmpty>
                    <ComboboxList>
                      {(item: { value: string; label: string }) => (
                        <ComboboxItem key={item.value} value={item}>
                          <span className="min-w-0 wrap-break-word">
                            {item.label}
                          </span>
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              )}
            />
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
  projectId,
  studio,
  busy,
  options,
  onBind,
}: {
  candidates: CandidateView[];
  projectId: string;
  studio: VoiceStudio;
  busy: boolean;
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
          projectId={projectId}
          busy={busy}
          options={options}
          initialTarget={
            studio.originForCandidate(candidate.id)?.projectId === projectId
              ? (studio.originForCandidate(candidate.id)?.target ?? null)
              : null
          }
          onBind={onBind}
        />
      ))}
    </section>
  );
}
