import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { SessionInput } from "@/components/ai-elements/session-input";
import { SessionMessages } from "@/components/ai-elements/session-messages";
import { SplitProposal } from "@/components/projects/split-proposal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

const runStatusLabels = {
  queued: msg`正在诊断`,
  running: msg`正在诊断`,
  cancelling: msg`正在停止`,
  waiting_for_input: msg`等待确认或继续讨论`,
  interrupted: msg`上次运行已中断，等待继续`,
  cancelled: msg`已停止`,
  failed: msg`诊断未完成，请检查后继续`,
  succeeded: msg`诊断已完成`,
} satisfies Record<RunStatus, ReturnType<typeof msg>>;

type Props = {
  project: LocalProjectSnapshot_Serialize;
  onChange: (project: LocalProjectSnapshot_Serialize) => void;
  onLocate: (sourceId: string, line: number) => void;
};
export function ChapterDiagnostics({ project, onChange, onLocate }: Props) {
  const { t, i18n } = useLingui();
  const { openSettings } = useDesktopSession();
  const configuration = useLlmConnections();
  const [selected, setSelected] = useState<ModelSelection | null>(null);
  const [confirmedBinding, setConfirmedBinding] = useState<string | null>(null);
  const [sendFailure, setSendFailure] = useState(false);
  const ai = useAiSession({
    projectId: project.id,
    taskKind: "chapter_splitting",
    title: t`分章诊断`,
    binding: () => modelBinding,
    failureText: t`诊断请求失败，已有记录仍保留。请检查连接后继续。`,
  });
  const { chat, snapshot, active } = ai;
  const current = snapshot?.session.configuration;
  const ready = configuration?.connections.find(
    (c) => c.id === selected?.connectionId,
  );
  const bindingKey = JSON.stringify([current, selected, ready?.revision]);
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
  const restoredConnection =
    snapshot?.session.configuration?.selection.connectionId;
  const restoredModel = snapshot?.session.configuration?.selection.modelId;
  useEffect(() => {
    setSelected(
      (restoredConnection && restoredModel
        ? { connectionId: restoredConnection, modelId: restoredModel }
        : null) ??
        configuration?.defaultModel ??
        null,
    );
    setConfirmedBinding(null);
  }, [restoredConnection, restoredModel, configuration?.defaultModel]);
  const references = new Map<string, ResultReference>();
  for (const message of snapshot?.messages ?? [])
    for (const part of message.parts.parts) {
      if (part.type === "tool" && part.state === "completed" && part.result)
        references.set(`${part.result.kind}:${part.result.id}`, part.result);
    }
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          <span className="sr-only">
            <Trans>诊断模型</Trans>
          </span>
          <select
            className="border-input bg-background h-8 max-w-full rounded-md border px-2 text-sm"
            disabled={active}
            value={
              selected ? `${selected.connectionId}:${selected.modelId}` : ""
            }
            onChange={(e) => {
              setConfirmedBinding(null);
              const value = e.target.value;
              const match = configuration?.connections
                .flatMap((c) =>
                  c.models.map((m) => ({
                    key: `${c.id}:${m.id}`,
                    connectionId: c.id,
                    modelId: m.id,
                  })),
                )
                .find((m) => m.key === value);
              setSelected(
                match
                  ? { connectionId: match.connectionId, modelId: match.modelId }
                  : null,
              );
            }}
          >
            <option value="">{t`选择模型`}</option>
            {configuration?.connections.flatMap((c) =>
              c.models.map((m) => (
                <option key={`${c.id}:${m.id}`} value={`${c.id}:${m.id}`}>
                  {c.name} / {m.name}
                </option>
              )),
            )}
          </select>
        </label>
        <Button variant="outline" onClick={() => openSettings("models")}>
          <Trans>模型设置</Trans>
        </Button>

        <Button variant="ghost" onClick={ai.newSession}>
          <Trans>新建诊断</Trans>
        </Button>
        <select
          className="border-input bg-background h-8 max-w-full rounded-md border px-2 text-sm"
          aria-label={t`诊断历史`}
          value={
            ai.sessions.some((item) => item.id === ai.sessionId)
              ? ai.sessionId
              : ""
          }
          onChange={(event) => ai.selectSession(event.target.value)}
        >
          <option value="">{t`新会话`}</option>
          {ai.sessions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        {ai.hasMoreSessions ? (
          <Button variant="ghost" onClick={() => void ai.loadSessions()}>
            <Trans>更多会话</Trans>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          disabled={ai.loading}
          onClick={() => void ai.refresh()}
        >
          <Trans>重新读取</Trans>
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        <Trans>
          启动后，所选服务会接收目录摘要和按需读取的有限正文。不会自动发送整本小说，建议须确认后采用。
        </Trans>
      </p>
      {needsRebind && ready ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={bindingConfirmed}
            disabled={active}
            onChange={(event) =>
              setConfirmedBinding(event.target.checked ? bindingKey : null)
            }
          />
          <span>
            <Trans comment="诊断使用的服务或模型配置变化后，用户必须确认新的发送目的地">
              确认使用当前模型配置继续。后续对话和按需读取的正文会发送到{" "}
              {ready.endpoint}。
            </Trans>
          </span>
        </label>
      ) : null}
      {!toolReady ? (
        <p className="text-muted-foreground text-sm">
          <Trans>
            请选择模型并在设置中完成连接与工具测试。本地分章仍然可用。
          </Trans>
        </p>
      ) : null}

      {ai.failure || chat.error || sendFailure ? (
        <Alert variant="destructive">
          <AlertDescription>
            <Trans>诊断请求失败，已有记录仍保留。请检查连接后继续。</Trans>
          </AlertDescription>
        </Alert>
      ) : null}
      {snapshot?.run ? (
        <p role="status" className="text-muted-foreground text-xs">
          {i18n._(runStatusLabels[snapshot.run.status])} ·{" "}
          <Trans>模型请求 {snapshot.session.budget.requests}/64</Trans>
        </p>
      ) : null}
      {snapshot?.run?.error && snapshot.run.error !== "cancelled" ? (
        <p role="alert" className="text-destructive text-sm">
          <Trans>
            上次执行未完成，已有结果和用量已保留。请检查连接、工程修订和限额后继续。
          </Trans>
        </p>
      ) : null}
      {ai.loading ? (
        <p role="status">
          <Trans>正在读取诊断记录…</Trans>
        </p>
      ) : null}
      {ai.hasOlder ? (
        <Button
          variant="ghost"
          disabled={ai.olderLoading || active}
          onClick={() => void ai.loadOlder()}
        >
          <Trans>更早的消息</Trans>
        </Button>
      ) : null}
      <SessionMessages messages={chat.messages} label={t`分章诊断对话`} />
      <SessionInput
        key={ai.sessionId}
        label={t`分章问题或补充说明`}
        placeholder={t`例如：前面是目录，请检查正文里的章节标题。`}
        suggestion={{
          label: t`检查分章`,
          text: t`请检查当前分章，找出遗漏或误识别，并提出可检查的修复方案。`,
        }}
        disabled={!toolReady || !bindingConfirmed || ai.loading}
        active={active}
        onStop={ai.stop}
        onSend={async (text) => {
          setSendFailure(false);
          try {
            await chat.sendMessage({ text });
          } catch {
            setSendFailure(true);
          }
        }}
      />
      {!active &&
      snapshot?.run &&
      ["failed", "interrupted", "cancelled"].includes(snapshot.run.status) ? (
        <Button
          variant="outline"
          disabled={!toolReady || !bindingConfirmed}
          onClick={() => {
            setSendFailure(false);
            void chat.regenerate().catch(() => setSendFailure(true));
          }}
        >
          <Trans comment="明确创建新的后台执行，保留旧执行和用量">
            重试上次执行
          </Trans>
        </Button>
      ) : null}
      {[...references.values()].map((reference) => (
        <SplitProposal
          key={`${reference.kind}:${reference.id}`}
          reference={reference}
          project={project}
          disabled={active}
          onChange={onChange}
          onLocate={onLocate}
        />
      ))}
    </section>
  );
}
