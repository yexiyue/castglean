import { Trans } from "@lingui/react/macro";
import {
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { useStudioOperations } from "@/hooks/use-studio-operations";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import { commands, type LibraryVoice } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import { auditionIdentity, clearAuditionDraft } from "@/lib/studio-operations";
import type { VoiceEditOperations } from "@/lib/voice-edit-operations";
import type { VoiceInventory } from "@/lib/voices";
import { AuditionPanel } from "./audition-panel";
import {
  LibraryVoiceDescriptionEditor,
  LibraryVoiceEditor,
  type LibraryVoiceFeedback,
} from "./library-voice-editor";
import { StudioJobs } from "./studio-jobs";
import { VoiceBindingUsage } from "./voice-binding-usage";
import {
  LibraryVoiceProperties,
  VoiceDetailContent,
  VoiceReference,
} from "./voice-detail-content";
import { useVoicePlayer } from "./voice-player";

export function LibraryVoiceActions({
  voice,
  onChanged,
  onDeleted,
  exportAction,
  draft,
  onDraftChange,
  operations,
  onReconciled,
}: {
  voice: LibraryVoice;
  onChanged: () => Promise<void>;
  onDeleted: (name: string) => void;
  exportAction: ReactNode;
  draft?: { name?: string; description?: string };
  onDraftChange: (
    field: "name" | "description",
    value: string | null,
    expected?: string,
  ) => void;
  operations: VoiceEditOperations;
  onReconciled: (inventory: VoiceInventory) => void;
}) {
  const studio = useVoiceStudio();
  const player = useVoicePlayer();
  const auditions = useStudioOperations();
  const { workspace } = useDesktopSession();
  const auditionKey = auditionIdentity({ kind: "library", id: voice.id });
  const auditionPending = auditions.entries.has(auditionKey);
  useSyncExternalStore(
    operations.subscribe,
    operations.snapshot,
    operations.snapshot,
  );
  const editing = operations.isPending(voice.id);
  const unknown = operations.unknownEdit(voice.id);
  const [recovery, setRecovery] = useState<VoiceInventory | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [replayFailed, setReplayFailed] = useState(false);
  const [recoveryChanged, setRecoveryChanged] = useState(false);
  const [name, setName] = useState(draft?.name ?? voice.name);
  const [savedName, setSavedName] = useState(voice.name);
  useEffect(() => {
    if (voice.name === savedName) return;
    if (name === savedName) setName(voice.name);
    if (name === savedName || name.trim() === voice.name)
      setSavedName(voice.name);
  }, [name, savedName, voice.name]);
  const [feedback, setFeedback] = useState<
    LibraryVoiceFeedback | "play-error" | "referenced" | null
  >(null);
  const [referenced, setReferenced] = useState<
    { projectId: string; projectTitle: string }[]
  >([]);
  const save = () =>
    void operations
      .run(voice.id, () =>
        studio.run(async () => {
          setFeedback("saving");
          const nextName = name.trim();
          const operationId = crypto.randomUUID();
          try {
            await commands.renameLibraryVoice(voice.id, nextName, operationId);
          } catch {
            operations.markUnknown(voice.id, {
              field: "name",
              value: nextName,
              draft: name,
              operationId,
              phase: "write",
            });
            setFeedback(null);
            return;
          }
          setName(nextName);
          setSavedName(nextName);
          onDraftChange("name", null, name);
          setFeedback("saved");
          try {
            await onChanged();
          } catch {
            operations.markUnknown(voice.id, {
              field: "name",
              value: nextName,
              draft: name,
              operationId,
              phase: "read",
            });
            setFeedback(null);
          }
        }),
      )
      .catch(() => {});
  const remove = () =>
    auditionPending
      ? undefined
      : void operations
          .run(voice.id, () =>
            studio.run(async () => {
              setFeedback("deleting");
              setReferenced([]);
              try {
                await player.stop();
                if (!(await commands.deleteLibraryVoice(voice.id))) {
                  setFeedback("cancelled");
                  return;
                }
              } catch (cause) {
                const block = cause as { kind?: string; references?: unknown };
                if (
                  block?.kind === "referenced" &&
                  Array.isArray(block.references)
                ) {
                  setReferenced(
                    (
                      block.references as {
                        projectId: string;
                        projectTitle: string;
                      }[]
                    ).map((reference) => ({
                      projectId: reference.projectId,
                      projectTitle: reference.projectTitle,
                    })),
                  );
                  setFeedback("referenced");
                } else {
                  setFeedback("delete-error");
                }
                return;
              }
              clearAuditionDraft(workspace("voices"), auditions, auditionKey);
              onDeleted(savedName);
              await onChanged();
            }),
          )
          .catch(() => {});
  return (
    <VoiceDetailContent
      properties={<LibraryVoiceProperties voice={voice} />}
      references={<VoiceBindingUsage voiceId={voice.id} />}
      reference={
        <VoiceReference
          voice={voice}
          busy={studio.pending || !studio.desktop}
          failed={feedback === "play-error"}
          onPlay={() =>
            void studio.run(async () => {
              setFeedback(null);
              let audio: string;
              try {
                audio = await commands.voiceReferenceAudio(voice.id);
              } catch {
                setFeedback("play-error");
                return;
              }
              await player.play(audio, savedName, voice.transcript);
            })
          }
        />
      }
      audition={
        <AuditionPanel
          studio={studio}
          voice={{ kind: "library", id: voice.id }}
        />
      }
      results={<StudioJobs studio={studio} />}
      management={
        <>
          {exportAction}
          {unknown && (
            <div
              role="alert"
              className="flex flex-col items-start gap-2 text-sm"
            >
              <p>
                {unknown.phase === "read" ? (
                  <Trans>音色修改已确认，待读取当前音色。</Trans>
                ) : (
                  <Trans>
                    上次音色修改的结果尚未确认。重试会使用原操作身份。
                  </Trans>
                )}
              </p>
              {unknown.phase === "write" && (
                <p>
                  <Trans>原操作可能仍在完成，当前值之后仍可能变化。</Trans>
                </p>
              )}
              {replayFailed && (
                <p>
                  <Trans>
                    原操作仍未确认，请重试或读取当前值后决定如何处理。
                  </Trans>
                </p>
              )}
              {recoveryFailed && (
                <p>
                  <Trans>无法读取当前音色，请重试。</Trans>
                </p>
              )}
              {recovery && (
                <>
                  {unknown.phase === "write" ? (
                    <p>
                      {(unknown.field === "name"
                        ? recovery.voices.find((item) => item.id === voice.id)
                            ?.name
                        : recovery.voices.find((item) => item.id === voice.id)
                            ?.description) === unknown.value ? (
                        <Trans>
                          当前值与提交内容一致，但没有收到原操作的确认。
                        </Trans>
                      ) : (
                        <Trans>当前值与提交内容不同，原操作仍未确认。</Trans>
                      )}
                    </p>
                  ) : (
                    <p>
                      <Trans>
                        修改已经保存，采用当前值不会撤销已保存的修改。
                      </Trans>
                    </p>
                  )}
                  <p className="wrap-anywhere whitespace-pre-wrap">
                    <Trans>当前值：</Trans>{" "}
                    {(unknown.field === "name"
                      ? recovery.voices.find((item) => item.id === voice.id)
                          ?.name
                      : recovery.voices.find((item) => item.id === voice.id)
                          ?.description) || "—"}
                  </p>
                  {recoveryChanged && (
                    <p>
                      <Trans>音色内容已变化，请再次确认当前值。</Trans>
                    </p>
                  )}
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={recovering || editing}
                  onClick={() => {
                    setRecovering(true);
                    setReplayFailed(false);
                    setRecoveryFailed(false);
                    void operations
                      .resume(voice.id, async (edit) => {
                        if (edit.phase === "write") {
                          try {
                            if (edit.field === "name")
                              await commands.renameLibraryVoice(
                                voice.id,
                                edit.value ?? "",
                                edit.operationId,
                              );
                            else
                              await commands.describeLibraryVoice(
                                voice.id,
                                edit.value,
                                edit.operationId,
                              );
                          } catch {
                            setReplayFailed(true);
                            return;
                          }
                          operations.confirmUnknown(voice.id, edit.operationId);
                        }
                        const inventory = await commands.listLibraryVoices();
                        const current = inventory.voices.find(
                          (item) => item.id === voice.id,
                        );
                        if (!current) throw new Error("voice_unavailable");
                        if (edit.field === "name") {
                          setName(current.name);
                          setSavedName(current.name);
                        }
                        onReconciled(inventory);
                        operations.resolveUnknown(voice.id, edit.operationId);
                      })
                      .catch(() => setRecoveryFailed(true))
                      .finally(() => setRecovering(false));
                  }}
                >
                  {unknown.phase === "read" ? (
                    <Trans>重新读取已保存音色</Trans>
                  ) : (
                    <Trans>重试原音色修改</Trans>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={recovering}
                  onClick={() => {
                    setRecovering(true);
                    setRecoveryFailed(false);
                    setRecoveryChanged(false);
                    void commands
                      .listLibraryVoices()
                      .then((inventory) => {
                        if (
                          !inventory.voices.some((item) => item.id === voice.id)
                        )
                          throw new Error("voice_unavailable");
                        setRecovery(inventory);
                      })
                      .catch(() => {
                        setRecovery(null);
                        setRecoveryFailed(true);
                      })
                      .finally(() => setRecovering(false));
                  }}
                >
                  <Trans>读取当前音色</Trans>
                </Button>
                {recovery && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={recovering}
                    onClick={() => {
                      setRecovering(true);
                      setRecoveryFailed(false);
                      void commands
                        .listLibraryVoices()
                        .then((latest) => {
                          const previous = recovery.voices.find(
                            (item) => item.id === voice.id,
                          );
                          const current = latest.voices.find(
                            (item) => item.id === voice.id,
                          );
                          if (!current) throw new Error("voice_unavailable");
                          if (
                            current.name !== previous?.name ||
                            current.description !== previous.description
                          ) {
                            setRecovery(latest);
                            setRecoveryChanged(true);
                            return;
                          }
                          operations.abandonUnknown(voice.id);
                          onReconciled(latest);
                        })
                        .catch(() => setRecoveryFailed(true))
                        .finally(() => setRecovering(false));
                    }}
                  >
                    {unknown.phase === "read" ? (
                      <Trans>采用当前值并结束核对</Trans>
                    ) : (
                      <Trans>采用当前值并放弃本次修改</Trans>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
          {feedback === "referenced" ? (
            <div
              role="alert"
              className="border-destructive/25 rounded-surface space-y-2 border p-3"
            >
              <p className="text-sm font-medium">
                <Trans comment="删除被工程绑定引用阻止">
                  此音色正被工程使用，先解绑再删除。
                </Trans>
              </p>
              <ul className="text-muted-foreground list-inside list-disc text-xs">
                {referenced.map((reference) => (
                  <li key={reference.projectId}>
                    {reference.projectTitle || reference.projectId}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <LibraryVoiceEditor
            name={name}
            savedName={savedName}
            busy={
              studio.pending ||
              editing ||
              !!unknown ||
              auditionPending ||
              !studio.desktop
            }
            feedback={
              feedback === "play-error" || feedback === "referenced"
                ? null
                : feedback
            }
            onNameChange={(nextName) => {
              setName(nextName);
              onDraftChange("name", nextName === savedName ? null : nextName);
              setFeedback(null);
            }}
            onReset={() => {
              setName(savedName);
              onDraftChange("name", null);
              setFeedback(null);
            }}
            onSave={save}
            onDelete={remove}
          />
          <LibraryVoiceDescriptionEditor
            key={`${voice.id}:${unknown ? "recovering" : "editing"}`}
            voiceId={voice.id}
            saved={voice.description ?? null}
            draft={draft?.description}
            onSaved={onChanged}
            onDraftChange={(value, expected) =>
              onDraftChange("description", value, expected)
            }
            busy={
              studio.pending ||
              editing ||
              !!unknown ||
              auditionPending ||
              !studio.desktop
            }
            perform={(action) => operations.run(voice.id, action)}
            onUnknown={(draft, value, operationId, phase) =>
              operations.markUnknown(voice.id, {
                field: "description",
                draft,
                value,
                operationId,
                phase,
              })
            }
          />
        </>
      }
    />
  );
}
