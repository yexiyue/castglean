import { zodResolver } from "@hookform/resolvers/zod";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  GaugeIcon,
  HistoryIcon,
  PlusIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { ContextUsage } from "@/components/ai-elements/context-usage";
import { SessionInput } from "@/components/ai-elements/session-input";
import {
  StartRecovered,
  StartRecovery,
} from "@/components/ai-elements/start-recovery";
import { SessionMessages } from "@/components/ai-elements/session-messages";
import { useWorkspaceMode } from "@/components/projects/workspace-mode";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
import type { ModelBinding } from "@/lib/ai/transport";
import {
  commands,
  type LocalProjectSnapshot_Serialize,
  type ModelSelection,
  type ResultReference,
  type RunStatus,
} from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import {
  type SourceContext,
  sourcePrompt,
} from "@/lib/projects/source-context";
import { cn } from "@/lib/utils";

const runStatusLabels = {
  queued: msg`等待执行`,
  running: msg`正在诊断`,
  cancelling: msg`正在停止`,
  waiting_for_input: msg`等待审阅或继续讨论`,
  interrupted: msg`上次运行已中断，等待继续`,
  cancelled: msg`已停止`,
  failed: msg`诊断未完成，请检查后继续`,
  succeeded: msg`诊断已完成`,
} satisfies Record<RunStatus, ReturnType<typeof msg>>;

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
  const { t, i18n } = useLingui();
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
  const mode = useWorkspaceMode();
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButton = useRef<HTMLButtonElement>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const ai = useAiSession({
    projectId: project.id,
    taskKind: "chapter_splitting",
    title: t`分章诊断`,
    binding: () => modelBinding,
    failureText: t`诊断请求失败，已有记录仍保留。请检查连接后继续。`,
  });
  const { chat, snapshot, active } = ai;
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
  for (const message of snapshot?.messages ?? [])
    for (const part of message.parts.parts)
      if (part.type === "tool" && part.state === "completed" && part.result)
        toolReferences.set(part.id, part.result);
  const sourceName = context
    ? project.sources.find((source) => source.id === context.sourceId)?.filename
    : "";
  const sessionId = ai.sessionId;
  const sendPending = useRef(new Set<string>());
  async function send(text: string) {
    if (
      active ||
      ai.loading ||
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
            density="compact"
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
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
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
            <p className="text-muted-foreground text-xs leading-5">
              <Trans>发送目录摘要及按需正文，方案经确认后采用。</Trans>
            </p>
            <ContextUsage snapshot={snapshot} configuration={configuration} />
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`诊断历史`}
          title={t`诊断历史`}
          ref={historyButton}
          aria-haspopup="dialog"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((value) => !value)}
        >
          <HistoryIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`新建诊断`}
          title={t`新建诊断`}
          onClick={() => {
            ai.newSession();
            setSendFailure(false);
            onClearContext();
            setHistoryOpen(false);
          }}
        >
          <PlusIcon />
        </Button>
      </header>
      <Dialog
        open={(mode?.active ?? true) && historyOpen}
        onOpenChange={setHistoryOpen}
      >
        <DialogContent finalFocus={historyButton}>
          <DialogTitle>
            <Trans>诊断历史</Trans>
          </DialogTitle>
          <section
            className="max-h-80 min-w-0 overflow-y-auto"
            aria-label={t`诊断历史`}
            title={t`诊断历史`}
          >
            {ai.sessions.length === 0 ? (
              <p className="text-muted-foreground p-2 text-xs">
                <Trans>还没有诊断记录</Trans>
              </p>
            ) : null}
            {ai.sessions.map((item, index) => (
              <button
                type="button"
                key={item.id}
                aria-current={item.id === ai.sessionId ? "true" : undefined}
                className={cn(
                  "hover:bg-muted rounded-item block w-full truncate p-2 text-left text-sm",
                  item.id === ai.sessionId && "bg-accent/10",
                )}
                onClick={() => {
                  ai.selectSession(item.id);
                  setSendFailure(false);
                  onClearContext();
                  setHistoryOpen(false);
                }}
              >
                <span className="text-muted-foreground mr-2 text-xs">
                  {index + 1}
                </span>
                {item.title}
              </button>
            ))}
            {ai.hasMoreSessions ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void ai.loadSessions()}
              >
                <Trans>更多会话</Trans>
              </Button>
            ) : null}
          </section>
        </DialogContent>
      </Dialog>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {ai.loading ? (
          <p role="status" className="p-4 text-sm">
            <Trans>正在读取诊断记录…</Trans>
          </p>
        ) : null}
        {!ai.loading && chat.messages.length === 0 ? (
          <div className="space-y-3 p-4">
            <h3 className="text-sm font-medium">
              <Trans>一起检查章节划分</Trans>
            </h3>
            <p className="text-muted-foreground text-sm leading-6">
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
        ) : null}
        <SessionMessages
          key={sessionId}
          messages={chat.messages}
          streamingMessageId={
            snapshot?.messages.find(
              (message) =>
                message.role === "assistant" &&
                message.status === "streaming" &&
                message.runId === snapshot.run?.id,
            )?.id
          }
          label={t`分章诊断对话`}
          references={toolReferences}
          interruptedMessages={
            new Set(
              (snapshot?.messages ?? [])
                .filter((message) => message.status === "interrupted")
                .map((message) => message.id),
            )
          }
          onReview={onReview}
          hasOlder={ai.hasOlder}
          olderLoading={ai.olderLoading}
          onLoadOlder={ai.loadOlder}
        />
      </div>
      <div className="shrink-0 space-y-2 border-t p-3">
        {snapshot?.run ? (
          <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
            <span role="status">
              {i18n._(runStatusLabels[snapshot.run.status])}
            </span>{" "}
            {!active &&
            snapshot?.run &&
            ["failed", "interrupted", "cancelled"].includes(
              snapshot.run.status,
            ) ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!toolReady || !bindingConfirmed}
                onClick={() => {
                  setSendFailure(false);
                  void chat.regenerate().catch(() => setSendFailure(true));
                }}
              >
                <Trans>重试</Trans>
              </Button>
            ) : null}
          </div>
        ) : null}
        {ai.failure || chat.error || sendFailure ? (
          <Alert variant="destructive">
            <AlertDescription>
              <Trans>
                请求未完成，输入与已有记录仍保留。请检查连接后重试。
              </Trans>
              <Button
                variant="ghost"
                size="sm"
                disabled={ai.loading}
                onClick={() => void ai.refresh()}
              >
                <Trans>重新读取</Trans>
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {snapshot?.run?.error &&
        !["cancelled"].includes(snapshot.run.error) &&
        !ai.failure &&
        !chat.error &&
        !sendFailure ? (
          <p role="alert" className="text-destructive text-xs">
            <Trans>上次执行未完成，已有结果和用量已保留。</Trans>
          </p>
        ) : null}
        {context ? (
          <div className="border-accent flex items-start gap-2 border-l-2 pl-2 text-xs">
            <div className="min-w-0 flex-1">
              <p className="truncate">
                {sourceName} · <Trans>第 {context.line + 1} 行</Trans>
              </p>
              <p className="text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
                {context.text}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`移除原文引用`}
              onClick={onClearContext}
            >
              <XIcon />
            </Button>
          </div>
        ) : null}
        {ai.pendingStart && (
          <StartRecovery
            missing={ai.pendingStatus === "missing"}
            busy={ai.checkingPending}
            onCheck={() => void ai.checkPendingStart()}
            onRetry={() => void ai.retryPendingStart()}
            onStop={() => void ai.stopPendingRecovery()}
          />
        )}
        {ai.recoveredStart && (
          <StartRecovered
            outcome={ai.recoveredStart}
            onAcknowledge={ai.acknowledgeRecoveredStart}
          />
        )}
        <SessionInput
          key={sessionId}
          label={t`分章问题或补充说明`}
          placeholder={t`描述问题，或从原文添加上下文…`}
          value={drafts[sessionId] ?? ""}
          onChange={(value) =>
            setDrafts((values) => ({ ...values, [sessionId]: value }))
          }
          disabled={
            !toolReady ||
            !bindingConfirmed ||
            ai.loading ||
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
        (!bindingConfirmed || confirmedBinding !== explicitChoice.current) ? (
          <Controller
            control={selectionForm.control}
            name="confirmedBinding"
            render={({ field }) => (
              <Field orientation="horizontal" className="items-start text-xs">
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
          <p className="text-muted-foreground text-xs">
            <Trans>请先选择模型并完成连接与工具测试。人工分章仍可使用。</Trans>
          </p>
        ) : null}
      </div>
    </section>
  );
}
