import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { GaugeIcon, SettingsIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { ContextUsage } from "@/components/assistant-ui/input/context-usage";
import { SessionInput } from "@/components/assistant-ui/input/session-input";
import { AgentWorkspace } from "@/components/assistant-ui/thread/agent-workspace";
import { SessionPalette } from "@/components/assistant-ui/thread/session-palette";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAiSession } from "@/hooks/use-ai-session";
import {
  publishLlmSnapshot,
  useLlmConnections,
} from "@/hooks/use-llm-connections";
import type { ModelBinding } from "@/lib/ai";
import {
  commands,
  type LocalProjectSnapshot_Serialize,
  type ModelSelection,
  type ResultReference,
} from "@/lib/bindings";
import { useDesktopSession, useWorkspaceState } from "@/lib/desktop-session";
import {
  type SourceContext,
  sourcePrompt,
} from "@/lib/projects/source-context";

const diagnosticSelectionSchema = z.object({
  model: z.string(),
  confirmedBinding: z.string().nullable(),
});

type Props = {
  project: LocalProjectSnapshot_Serialize;
  context: SourceContext | null;
  onClearContext: () => void;
  onReview: (reference: ResultReference) => void;
  onActivityChange: (active: boolean) => void;
};
export function ChapterDiagnostics({
  project,
  context,
  onClearContext,
  onReview,
  onActivityChange,
}: Props) {
  const { t } = useLingui();
  const formId = useId();
  const { openSettings } = useDesktopSession();
  const configuration = useLlmConnections();
  const userSelectedModel = useRef(false);
  const explicitChoice = useRef<string | null>(null);
  const [selected, setSelected] = useState<ModelSelection | null>(null);
  const [confirmedBinding, setConfirmedBinding] = useState<string | null>(null);
  const selectionForm = useForm({
    resolver: zodResolver(diagnosticSelectionSchema),
    values: {
      model: selected ? `${selected.connectionId}:${selected.modelId}` : "",
      confirmedBinding,
    },
  });
  const [sendFailure, setSendFailure] = useState(false);
  const [drafts, setDrafts] = useWorkspaceState<Record<string, string>>(
    project.id,
    "diagnosticDrafts",
    {},
  );
  const ai = useAiSession({
    projectId: project.id,
    taskKind: "chapter_splitting",
    title: t`分章诊断`,
    binding: () => modelBinding,
    failureText: t`诊断请求失败，已有记录仍保留。请检查连接后继续。`,
  });
  const { snapshot, active } = ai;
  const view = useRef({ sessionId: ai.sessionId, context });
  view.current = { sessionId: ai.sessionId, context };
  useEffect(() => onActivityChange(active), [active, onActivityChange]);
  const current = snapshot?.session.configuration;
  const ready = configuration?.connections.find(
    (c) => c.id === selected?.connectionId,
  );
  const bindingKey = JSON.stringify([selected, ready?.revision]);
  const needsRebind = !!(
    current &&
    selected &&
    ready &&
    (current.selection.connectionId !== selected.connectionId ||
      current.selection.modelId !== selected.modelId ||
      current.revision !== ready.revision)
  );
  const bindingConfirmed = !needsRebind || confirmedBinding === bindingKey;
  const modelBinding: ModelBinding | null =
    selected && ready
      ? {
          configuration: { selection: selected, revision: ready.revision },
          confirmRebind: needsRebind && bindingConfirmed,
          expectedProjectRevision: project.revision,
        }
      : null;
  const toolReady =
    ready &&
    selected &&
    ["connection", "tools"].every((kind) =>
      ready.probes.some(
        (p) =>
          p.modelId === selected.modelId &&
          p.kind === kind &&
          p.revision === ready.revision &&
          !p.failure,
      ),
    );
  useEffect(() => {
    let active = true;
    void commands
      .llmSnapshot()
      .then((config) => {
        if (active) publishLlmSnapshot(config);
      })
      .catch(() => {
        if (active) setSendFailure(true);
      });
    return () => {
      active = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A conversation change resets the explicit next-model choice.
  useEffect(() => {
    userSelectedModel.current = false;
    explicitChoice.current = null;
    setSelected(null);
    setConfirmedBinding(null);
  }, [ai.sessionId]);
  const restoredConnection =
    snapshot?.session.configuration?.selection.connectionId;
  const restoredModel = snapshot?.session.configuration?.selection.modelId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-run restoration after changing conversations, even if both use the same model.
  useEffect(() => {
    if (userSelectedModel.current) return;
    setSelected(
      (restoredConnection && restoredModel
        ? { connectionId: restoredConnection, modelId: restoredModel }
        : null) ??
        configuration?.defaultModel ??
        null,
    );
  }, [
    ai.sessionId,
    restoredConnection,
    restoredModel,
    configuration?.defaultModel,
  ]);
  const toolReferences = new Map<string, ResultReference>();
  for (const record of snapshot?.records ?? [])
    for (const [id, reference] of Object.entries(record.tools))
      toolReferences.set(id, reference);
  const sourceName = context
    ? project.sources.find((source) => source.id === context.sourceId)?.filename
    : "";
  const sessionId = ai.sessionId;
  const sendPending = useRef(new Set<string>());
  async function send(text: string) {
    if (
      active ||
      ai.loading ||
      ai.readFailure ||
      !toolReady ||
      !bindingConfirmed ||
      sendPending.current.has(sessionId)
    )
      return;
    sendPending.current.add(sessionId);
    setSendFailure(false);
    try {
      await ai.send(sourcePrompt(text, context, sourceName ?? "", t`原文引用`));
      setDrafts((values) =>
        values[sessionId] === text ? { ...values, [sessionId]: "" } : values,
      );
      if (
        view.current.sessionId === sessionId &&
        view.current.context === context
      )
        onClearContext();
    } catch {
      if (view.current.sessionId === sessionId) {
        setSendFailure(true);
        setDrafts((values) =>
          values[sessionId]?.trim() ? values : { ...values, [sessionId]: text },
        );
      }
    } finally {
      sendPending.current.delete(sessionId);
    }
  }
  const modelControls = (
    <div className="flex min-w-0 items-center gap-1">
      <Controller
        control={selectionForm.control}
        name="model"
        render={({ field }) => (
          <NativeSelect
            {...field}
            size="sm"
            className="max-w-48 min-w-0 flex-1"
            aria-label={t`诊断模型`}
            onChange={(event) => {
              field.onChange(event);
              userSelectedModel.current = true;
              setConfirmedBinding(null);
              const match = configuration?.connections
                .flatMap((connection) =>
                  connection.models.map((model) => ({
                    key: `${connection.id}:${model.id}`,
                    connectionId: connection.id,
                    modelId: model.id,
                  })),
                )
                .find((model) => model.key === event.target.value);
              const next = match
                ? { connectionId: match.connectionId, modelId: match.modelId }
                : null;
              setSelected(next);
              const connection = configuration?.connections.find(
                (c) => c.id === next?.connectionId,
              );
              explicitChoice.current = JSON.stringify([
                next,
                connection?.revision,
              ]);
              setConfirmedBinding(explicitChoice.current);
            }}
          >
            <option value="">{t`选择模型`}</option>
            {configuration?.connections.flatMap((connection) =>
              connection.models.map((model) => (
                <option
                  key={`${connection.id}:${model.id}`}
                  value={`${connection.id}:${model.id}`}
                >
                  {connection.name} / {model.name}
                </option>
              )),
            )}
          </NativeSelect>
        )}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        aria-label={t`模型设置`}
        title={t`模型设置`}
        onClick={() => openSettings("models")}
      >
        <SettingsIcon />
      </Button>
    </div>
  );
  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card"
      aria-label={t`分章诊断对话`}
    >
      <header className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-medium">
            <Trans>分章助手</Trans>
          </h2>
          <p className="sr-only">{snapshot?.session.title ?? t`新会话`}</p>
        </div>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                aria-label={t`会话信息`}
                title={t`上下文窗口`}
              />
            }
          >
            <GaugeIcon />
            <span>
              <Trans>上下文</Trans>
            </span>
          </PopoverTrigger>
          <PopoverContent align="end">
            <PopoverTitle>
              <Trans>会话信息</Trans>
            </PopoverTitle>
            <p className="text-xs leading-5 text-muted-foreground">
              <Trans>发送目录摘要及按需正文，方案经确认后采用。</Trans>
            </p>
            <ContextUsage snapshot={snapshot} configuration={configuration} />
          </PopoverContent>
        </Popover>
        <SessionPalette
          ai={ai}
          onNewSession={() => {
            ai.newSession();
            setSendFailure(false);
            onClearContext();
          }}
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {ai.loading ? (
          <p role="status" className="p-4 text-sm">
            <Trans>正在读取诊断记录…</Trans>
          </p>
        ) : null}
        <AgentWorkspace
          ai={ai}
          projectId={project.id}
          retryDisabled={!toolReady || !bindingConfirmed}
          key={sessionId}
          onReview={onReview}
          welcome={
            <div className="space-y-3 p-4">
              <h3 className="text-sm font-medium">
                <Trans>一起检查章节划分</Trans>
              </h3>
              <p className="text-sm leading-6 text-muted-foreground">
                <Trans>
                  检查漏章、目录误识别或标题规则。你也可以从原文中选择一处，告诉助手哪里不对。
                </Trans>
              </p>
              {!(drafts[sessionId] ?? "").trim() ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!toolReady || !bindingConfirmed || active}
                  onClick={() =>
                    void send(
                      t`请检查当前分章，找出遗漏或误识别，并提出可检查的修复方案。`,
                    )
                  }
                >
                  <Trans>检查当前分章</Trans>
                </Button>
              ) : null}
            </div>
          }
          composer={
            <div className="space-y-2 pb-3">
              {sendFailure && !ai.failure ? (
                <p role="alert" className="text-xs text-destructive">
                  <Trans>诊断配置读取未完成，请检查服务连接。</Trans>
                </p>
              ) : null}
              <SessionInput
                reference={
                  context
                    ? {
                        title: sourceName ?? t`原文引用`,
                        line: context.line,
                        text: context.text,
                        onRemove: onClearContext,
                      }
                    : undefined
                }
                answering={(ai.snapshot?.interrupts.length ?? 0) > 0}
                answerTarget={`agent-answers-${ai.sessionId}`}
                key={sessionId}
                label={t`分章问题或补充说明`}
                placeholder={t`描述问题，或从原文添加上下文…`}
                value={drafts[sessionId] ?? ""}
                onChange={(value) =>
                  setDrafts((values) => ({ ...values, [sessionId]: value }))
                }
                disabled={
                  (ai.snapshot?.interrupts.length ?? 0) > 0 ||
                  !toolReady ||
                  !bindingConfirmed ||
                  ai.loading ||
                  ai.readFailure ||
                  ai.pendingStart ||
                  !!ai.recoveredStart
                }
                active={active}
                stopping={snapshot?.run?.status === "cancelling"}
                onStop={ai.stop}
                onSend={send}
                toolbar={modelControls}
                focusToken={context}
              />

              {needsRebind &&
              ready &&
              (!bindingConfirmed ||
                confirmedBinding !== explicitChoice.current) ? (
                <Controller
                  control={selectionForm.control}
                  name="confirmedBinding"
                  render={({ field }) => (
                    <Field
                      orientation="horizontal"
                      className="items-start text-xs"
                    >
                      <Checkbox
                        id={`${formId}-confirm-binding`}
                        checked={bindingConfirmed}
                        onCheckedChange={(checked) => {
                          const value = checked ? bindingKey : null;
                          field.onChange(value);
                          setConfirmedBinding(value);
                        }}
                      />
                      <FieldLabel
                        htmlFor={`${formId}-confirm-binding`}
                        className="min-w-0 font-normal break-all"
                      >
                        <Trans>
                          确认改用当前配置，后续内容将发送到 {ready.endpoint}。
                        </Trans>
                      </FieldLabel>
                    </Field>
                  )}
                />
              ) : null}
              {!toolReady ? (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    请先选择模型并完成连接与工具测试。人工分章仍可使用。
                  </Trans>
                </p>
              ) : null}
            </div>
          }
        />
      </div>
    </section>
  );
}
