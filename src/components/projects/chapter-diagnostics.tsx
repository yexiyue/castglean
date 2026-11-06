import { useChat } from "@ai-sdk/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { ProposalDirectory } from "@/components/projects/proposal-directory";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  publishLlmSnapshot,
  useLlmConnections,
} from "@/hooks/use-llm-connections";
import type {
  DiagnosticSnapshot,
  ImportSnapshot,
  ModelSelection,
} from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import { diagnosticMessages } from "@/lib/diagnostic-stream";
import {
  type DiagnosticModelBinding,
  DiagnosticRequestError,
  DiagnosticTransport,
} from "@/lib/diagnostic-transport";
import { llmErrorKey, llmErrors } from "@/lib/llm";

const diagnosticStatusMessages = {
  running: msg`正在诊断`,
  cancelling: msg`正在停止`,
  waiting_for_input: msg`等待确认或继续讨论`,
  interrupted: msg`上次运行已中断，等待继续`,
  cancelled: msg`已停止`,
  failed: msg`诊断未完成，请检查后继续`,
};
const diagnosticFailureMessages = {
  interrupted: msg({
    comment: "进程退出后的诊断恢复提示，不代表服务响应损坏",
    message: "上次诊断已中断。已有结果和用量已保留，可补充说明后继续。",
  }),
  budget_exhausted: msg`本次诊断已达到请求限额，请检查已有方案后再继续。`,
  invalid_tool_call: msg`模型提出了无效工具调用，诊断已停止。请检查已有结果后继续。`,
  unknown_tool: msg`模型提出了无效工具调用，诊断已停止。请检查已有结果后继续。`,
  diagnostic_failed: msg`诊断未能完成，已有结果已保留。请检查连接和方案后继续。`,
  diagnostic_storage_failed: msg`诊断记录无法保存。请检查存储空间和目录权限后重新读取。`,
  invalid_result_or_budget_exhausted: msg`模型结果未通过校验或已达到限额。请检查已有结果与用量后继续。`,
};

type ChapterDiagnosticsProps = {
  project: ImportSnapshot;
  onChange: (p: ImportSnapshot) => void;
  onLocate: (sourceId: string, line: number) => void;
};

export function ChapterDiagnostics({
  project,
  onChange,
  onLocate,
}: ChapterDiagnosticsProps): ReactElement {
  const { t, i18n } = useLingui();
  const { openSettings } = useDesktopSession();
  const configuration = useLlmConnections();
  const setConfiguration = publishLlmSnapshot;
  const [selected, setSelected] = useState<ModelSelection | null>(null);
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [input, setInput] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [confirmedBinding, setConfirmedBinding] = useState<string | null>(null);
  const adoptionRequests = useRef(new Map<string, string>());
  const selectionRef = useRef<DiagnosticModelBinding | null>(null);
  const transport = useMemo(
    () =>
      new DiagnosticTransport(
        project.id,
        () => selectionRef.current,
        setSnapshot,
        t`诊断未能继续，请检查连接或重新读取。`,
      ),
    [project.id, t],
  );
  function reportFailure(error: unknown): void {
    if (
      error instanceof DiagnosticRequestError &&
      error.detail?.domain === "llm"
    ) {
      setFailure(i18n._(llmErrors[llmErrorKey(error.detail.error)]));
      return;
    }
    setFailure(t`诊断请求失败，已有草案仍保留。请检查连接后继续。`);
  }
  const chat = useChat({ id: project.id, transport, onError: reportFailure });
  const { setMessages, resumeStream, clearError } = chat;
  const active =
    snapshot?.status === "running" ||
    snapshot?.status === "cancelling" ||
    chat.status === "submitted" ||
    chat.status === "streaming";
  const ready = configuration?.connections.find(
    (c) => c.id === selected?.connectionId,
  );
  const bindingKey = JSON.stringify([
    snapshot?.sessionId,
    snapshot?.configurationRevision,
    selected?.connectionId,
    selected?.modelId,
    ready?.revision,
  ]);
  const needsRebind = !!(
    snapshot &&
    selected &&
    ready &&
    (snapshot.selection.connectionId !== selected.connectionId ||
      snapshot.selection.modelId !== selected.modelId ||
      snapshot.configurationRevision !== ready.revision)
  );
  const bindingConfirmed = !needsRebind || confirmedBinding === bindingKey;
  selectionRef.current =
    selected && ready
      ? {
          selection: selected,
          revision: ready.revision,
          confirmRebind: needsRebind && bindingConfirmed,
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
    let mounted = true;
    void Promise.all([
      commands.llmSnapshot(),
      commands.diagnosticSnapshot(project.id, null),
    ])
      .then(([config, restored]) => {
        if (!mounted) return;
        setConfiguration(config);
        setSelected(restored?.selection ?? config.defaultModel);
        setSnapshot(restored);
        setFailure(null);
        clearError();
        transport.restore(restored);
        if (restored) {
          const running =
            restored.status === "running" || restored.status === "cancelling";
          setMessages(
            diagnosticMessages(
              running ? restored.messages.slice(0, -1) : restored.messages,
            ),
          );
          if (running) void resumeStream();
        }
      })
      .catch(() => {
        if (mounted) setFailure(t`无法读取模型设置或诊断记录，原记录已保留。`);
      });
    return () => {
      mounted = false;
      transport.dispose();
    };
  }, [project.id, transport, setMessages, resumeStream, clearError, t]);
  async function send() {
    if (!input.trim() || !bindingConfirmed) return;
    const text = input;
    setInput("");
    setFailure(null);
    try {
      await chat.sendMessage({ text });
    } catch (error) {
      reportFailure(error);
    }
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
        <Button
          variant="ghost"
          disabled={active}
          onClick={() => {
            transport.reset();
            setConfirmedBinding(null);
            setSelected(configuration?.defaultModel ?? null);
            setSnapshot(null);
            setFailure(null);
            clearError();
            setMessages([]);
          }}
        >
          <Trans>新建诊断</Trans>
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
      {failure || chat.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {failure ?? t`诊断请求失败，已有草案仍保留。请检查连接后继续。`}
          </AlertDescription>
        </Alert>
      ) : null}
      {snapshot?.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {i18n._(
              diagnosticFailureMessages[
                snapshot.error as keyof typeof diagnosticFailureMessages
              ] ?? llmErrors[llmErrorKey(snapshot.error)],
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {snapshot ? (
        <p role="status" className="text-muted-foreground text-xs">
          {i18n._(diagnosticStatusMessages[snapshot.status])} ·{" "}
          <Trans>模型请求 {snapshot.requests}/64</Trans>
        </p>
      ) : null}
      <div
        role="log"
        aria-label={t`分章诊断对话`}
        className="max-h-[28rem] overflow-auto border-y"
      >
        {chat.messages.map((message) => (
          <Message key={message.id} from={message.role}>
            <span className="text-muted-foreground text-xs">
              {message.role === "user" ? t`你` : t`分章助手`}
            </span>
            <MessageContent>
              {message.parts.map((part, index) =>
                part.type === "text" ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Host message parts are append-only; the ordinal is their stable identity.
                  <p key={index}>{part.text}</p>
                ) : part.type === "dynamic-tool" ? (
                  <details
                    key={part.toolCallId}
                    className="border-l pl-3 text-xs"
                  >
                    <summary className="cursor-pointer">
                      {part.toolName} ·{" "}
                      {part.state === "output-available"
                        ? t`已完成`
                        : part.state === "output-error"
                          ? t`未完成`
                          : t`执行中`}
                    </summary>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                      {JSON.stringify(part.input, null, 2)}
                    </pre>
                    {part.state === "output-available" ? (
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify(part.output, null, 2)}
                      </pre>
                    ) : null}
                  </details>
                ) : null,
              )}
            </MessageContent>
          </Message>
        ))}
      </div>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Textarea
          maxLength={4000}
          aria-label={t`分章问题或补充说明`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t`例如：前面是目录，请检查正文里的章节标题。`}
        />
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={
              active || !toolReady || !bindingConfirmed || !input.trim()
            }
          >
            <Trans comment="开始或继续 AI 分章诊断">发送</Trans>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={active || !toolReady}
            onClick={() => {
              setInput(
                t`请检查当前分章，找出遗漏或误识别，并提出可检查的修复方案。`,
              );
            }}
          >
            <Trans>检查分章</Trans>
          </Button>
          {active ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // Keep the subscription open until the host confirms cancellation.
                // Stopping AI SDK locally first would hide that terminal snapshot.
                void transport
                  .stop()
                  .catch(() =>
                    setFailure(t`无法停止诊断，请重新读取状态后重试。`),
                  );
              }}
            >
              <Trans comment="停止正在运行的分章诊断">停止</Trans>
            </Button>
          ) : null}
        </div>
      </form>
      {snapshot?.proposals.map((proposal) => (
        <section key={proposal.id} className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-medium">
            <Trans>候选分章方案</Trans> · {proposal.chapters.length}
          </h3>
          <p className="text-muted-foreground text-xs">
            <Trans>
              新增 {proposal.addedLines.length} 个起点，移除{" "}
              {proposal.removedLines.length} 个起点。
            </Trans>
          </p>
          <ProposalDirectory chapters={proposal.chapters} onLocate={onLocate} />
          <details>
            <summary className="cursor-pointer text-sm">
              <Trans>分章规则</Trans>
            </summary>
            <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap">
              {proposal.rules
                .map((rule) => `${rule.name}: ${rule.pattern}`)
                .join("\n")}
            </pre>
          </details>
          {proposal.discarded ? (
            <p className="text-muted-foreground text-xs">
              <Trans comment="用户已放弃此候选分章方案">已放弃</Trans>
            </p>
          ) : null}
          {proposal.baseRevision !== project.revision && !proposal.adopted ? (
            <p className="text-muted-foreground text-xs">
              <Trans>草案已变化，此方案已过期。</Trans>
            </p>
          ) : null}
          <Button
            disabled={
              active ||
              adopting ||
              proposal.adopted ||
              proposal.discarded ||
              proposal.baseRevision !== project.revision
            }
            onClick={async () => {
              setAdopting(true);
              setFailure(null);
              try {
                onChange(
                  await commands.diagnosticAdopt(
                    project.id,
                    snapshot.sessionId,
                    proposal.id,
                    (() => {
                      let id = adoptionRequests.current.get(proposal.id);
                      if (!id) {
                        id = crypto.randomUUID();
                        adoptionRequests.current.set(proposal.id, id);
                      }
                      return id;
                    })(),
                  ),
                );
                const next = await commands.diagnosticSnapshot(
                  project.id,
                  snapshot.sessionId,
                );
                if (next) setSnapshot(next);
              } catch {
                setFailure(t`方案未采用，请重新读取并检查草案修订。`);
              } finally {
                setAdopting(false);
              }
            }}
          >
            {proposal.adopted ? (
              <Trans comment="分章方案已写入草案">已采用</Trans>
            ) : (
              <Trans comment="明确采用当前候选分章方案">采用方案</Trans>
            )}
          </Button>
          <Button
            variant="ghost"
            disabled={
              active || adopting || proposal.adopted || proposal.discarded
            }
            onClick={async () => {
              setAdopting(true);
              try {
                await commands.diagnosticDiscardProposal(
                  project.id,
                  snapshot.sessionId,
                  proposal.id,
                );
                const next = await commands.diagnosticSnapshot(
                  project.id,
                  snapshot.sessionId,
                );
                if (next) setSnapshot(next);
              } catch {
                setFailure(t`方案状态未能保存，请重新读取。`);
              } finally {
                setAdopting(false);
              }
            }}
          >
            <Trans comment="保留诊断记录但不采用候选分章">放弃方案</Trans>
          </Button>
        </section>
      ))}
    </section>
  );
}
