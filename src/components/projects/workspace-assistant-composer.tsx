import type { Unstable_SlashCommand } from "@assistant-ui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ModelSelector } from "@/components/assistant-ui/elements/model-selector";
import { ContextUsage } from "@/components/assistant-ui/input/context-usage";
import { ReasoningPicker } from "@/components/assistant-ui/input/reasoning-picker";
import { SessionInput } from "@/components/assistant-ui/input/session-input";
import { Button } from "@/components/ui/button";
import { useWorkspaceState } from "@/lib/desktop-session";
import type { useWorkspaceAssistant } from "./use-workspace-assistant";

type AssistantReference = { chapterId: string; line: number; text: string };

export function WorkspaceAssistantComposer({
  projectId,
  assistant,
  chapterCommands,
  context,
  contextTitleForDraft,
  clearReference,
  onOpenSettings,
}: {
  projectId: string;
  assistant: ReturnType<typeof useWorkspaceAssistant>;
  chapterCommands: readonly Unstable_SlashCommand[];
  context: AssistantReference | undefined;
  contextTitleForDraft: string;
  clearReference: (sessionId: string, reference: AssistantReference) => void;
  onOpenSettings: (returnFocusTo?: HTMLElement) => void;
}) {
  const { t } = useLingui();
  const {
    ai,
    configuration,
    models,
    selectedModel,
    effortChoices,
    effectiveEffort,
    needsModelConfirmation,
    requestUnavailable,
    reasoningFallback,
    chooseModel,
    chooseEffort,
    confirmModel,
  } = assistant;
  const [drafts, setDrafts] = useWorkspaceState<Record<string, string>>(
    projectId,
    "assistantDrafts",
    {},
  );
  const draft = drafts[ai.sessionId] ?? "";
  return (
    <div className="flex flex-col gap-2 pb-3">
      {needsModelConfirmation ? (
        <div role="alert" className="flex items-center gap-2 py-1 text-xs">
          <span className="min-w-0 flex-1">
            <Trans>
              模型配置已变化，确认后使用 {selectedModel?.name} 继续。
            </Trans>
            <span className="block break-all text-muted-foreground">
              {selectedModel?.endpoint}
            </span>
          </span>
          <Button size="sm" variant="outline" onClick={confirmModel}>
            <Trans>确认使用</Trans>
          </Button>
        </div>
      ) : null}
      {reasoningFallback ? (
        <p role="status" className="text-xs text-muted-foreground">
          <Trans>所选模型不支持原思考档位，已跟随模型默认。</Trans>
        </p>
      ) : null}
      <SessionInput
        focusToken={context}
        reference={
          context && {
            title: contextTitleForDraft,
            text: context.text,
            line: context.line,
            onRemove: () => clearReference(ai.sessionId, context),
          }
        }
        answering={(ai.snapshot?.interrupts.length ?? 0) > 0}
        answerTarget={`agent-answers-${ai.sessionId}`}
        label={t`工程问题或补充说明`}
        placeholder={t`询问原文，或输入 / 选择章节任务…`}
        commands={chapterCommands}
        value={draft}
        onChange={(value) =>
          setDrafts((old) => ({
            ...old,
            [ai.sessionId]: value,
          }))
        }
        disabled={requestUnavailable}
        stopping={ai.snapshot?.run?.status === "cancelling"}
        active={ai.active}
        onStop={ai.stop}
        onSend={async (text) => {
          const id = ai.sessionId;
          const sentContext = context;
          try {
            await ai.send(
              context
                ? `${text}\n\n${t`原文引用`} · ${contextTitleForDraft}（chapter_id=${context.chapterId}, ${context.line + 1}）：\n${context.text}`
                : text,
            );
          } catch {
            // useAiSession exposes the failure; keep this draft and reference.
            return;
          }
          setDrafts((old) => (old[id] === text ? { ...old, [id]: "" } : old));
          if (sentContext) clearReference(id, sentContext);
        }}
        toolbar={
          <>
            <ModelSelector
              models={models}
              value={selectedModel?.key ?? ""}
              onValueChange={chooseModel}
              label={t`下次请求使用的模型`}
              onOpenSettings={(returnFocusTo) => onOpenSettings(returnFocusTo)}
            />
            <ReasoningPicker
              choices={effortChoices}
              value={effectiveEffort}
              onChange={chooseEffort}
              label={t`思考强度`}
            />
            <ContextUsage
              snapshot={ai.snapshot}
              configuration={configuration}
              compactDisabled={
                !ai.snapshot?.messages.length || ai.active || requestUnavailable
              }
              onCompact={ai.compactContext}
            />
          </>
        }
      />
    </div>
  );
}
