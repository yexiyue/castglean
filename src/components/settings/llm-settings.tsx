import { Trans, useLingui } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  publishLlmSnapshot,
  useLlmConnections,
} from "@/hooks/use-llm-connections";
import type {
  LlmConnection,
  LlmModel,
  LlmProtocol,
  ProbeKind,
} from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import { llmErrorKey, llmErrors } from "@/lib/llm";

const endpoints: Record<LlmProtocol, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
};
const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-sm";

export function LlmSettings() {
  const { t, i18n } = useLingui();
  const formId = useId();
  const snapshot = useLlmConnections();
  const setSnapshot = publishLlmSnapshot;
  const [editing, setEditing] = useState<LlmConnection | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<LlmProtocol>("openai");
  const [endpoint, setEndpoint] = useState(endpoints.openai);
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [remote, setRemote] = useState<LlmModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [probeId, setProbeId] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (isTauri()) {
      void commands
        .llmSnapshot()
        .then((data) => {
          if (mounted.current) setSnapshot(data);
        })
        .catch((cause) => {
          if (mounted.current) setError(i18n._(llmErrors[llmErrorKey(cause)]));
        });
    }
    return () => {
      mounted.current = false;
    };
  }, [i18n]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current) setError(i18n._(llmErrors[llmErrorKey(cause)]));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setProbeId(null);
      }
    }
  }

  function edit(connection: LlmConnection | null) {
    setEditing(connection);
    setName(connection?.name ?? "");
    setProtocol(connection?.protocol ?? "openai");
    setEndpoint(connection?.endpoint ?? endpoints.openai);
    setModels(connection?.models ?? []);
    setKey("");
    setRemoveKey(false);
    setRemote([]);
    setModelId("");
    setModelName("");
    setError(null);
    setFormOpen(true);
  }

  async function save() {
    const credential = key
      ? { kind: "replace" as const, value: key }
      : removeKey
        ? { kind: "remove" as const }
        : { kind: "keep" as const };
    setKey("");
    await run(async () => {
      const next = await commands.llmUpdateConnection({
        id: editing?.id ?? null,
        expectedRevision: editing?.revision ?? null,
        name,
        protocol,
        endpoint,
        models,
        credential,
      });
      if (mounted.current) {
        setSnapshot(next);
        setFormOpen(false);
      }
    });
  }

  function addModel(model: LlmModel) {
    if (models.some((m) => m.modelId === model.modelId)) return;
    setModels((current) => [...current, model]);
  }

  async function probe(
    connection: LlmConnection,
    model: LlmModel,
    kind: ProbeKind,
  ) {
    const requestId = crypto.randomUUID();
    setProbeId(requestId);
    await run(async () => {
      const next = await commands.llmProbe(
        { connectionId: connection.id, modelId: model.id },
        kind,
        requestId,
      );
      if (mounted.current) setSnapshot(next);
    });
  }

  if (!isTauri())
    return (
      <Alert>
        <AlertDescription>
          <Trans>浏览器预览：请在桌面应用中配置和测试 LLM 连接。</Trans>
        </AlertDescription>
      </Alert>
    );

  return (
    <section
      className="space-y-5"
      aria-label={t({
        comment: "LLM 连接设置分区名称",
        message: "文本模型连接",
      })}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          <Trans>文本模型连接</Trans>
        </h3>
        <Button
          variant="outline"
          disabled={busy || !snapshot}
          onClick={() => edit(null)}
        >
          <Trans comment="添加 LLM 服务配置">添加连接</Trans>
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!snapshot ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => setSnapshot(await commands.llmSnapshot()))
          }
        >
          <Trans comment="重新读取 LLM 配置">重新读取</Trans>
        </Button>
      ) : null}
      {snapshot?.cleanupRequired ? (
        <div className="space-y-2 text-sm">
          <p>
            <Trans>部分旧密钥尚未清理，请解锁系统凭据库后重试。</Trans>
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () =>
                setSnapshot(await commands.llmCleanupCredentials()),
              )
            }
          >
            <Trans comment="重试删除不再使用的系统密钥">清理旧密钥</Trans>
          </Button>
        </div>
      ) : null}
      {snapshot?.connections.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <Trans>尚未添加连接。本地小说导入不需要配置模型。</Trans>
        </p>
      ) : null}
      {snapshot?.connections.map((connection) => (
        <div key={connection.id} className="space-y-3 border-b pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{connection.name}</span>
            <span className="text-muted-foreground text-xs">
              {connection.protocol}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => edit(connection)}
            >
              <Trans comment="编辑 LLM 连接">编辑</Trans>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setDeleting(connection.id)}
            >
              <Trans comment="删除 LLM 连接">删除</Trans>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs break-all">
            {connection.endpoint}
          </p>
          {deleting === connection.id ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                <Trans>删除此连接及其密钥？已有诊断记录会保留。</Trans>
              </span>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setSnapshot(
                      await commands.llmDeleteConnection(
                        connection.id,
                        connection.revision,
                      ),
                    );
                    setDeleting(null);
                  })
                }
              >
                <Trans comment="确认删除 LLM 连接">确认删除</Trans>
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                <Trans comment="取消删除连接">取消</Trans>
              </Button>
            </div>
          ) : null}
          {connection.models.map((model) => {
            const isDefault =
              snapshot.defaultModel?.connectionId === connection.id &&
              snapshot.defaultModel?.modelId === model.id;
            return (
              <div key={model.id} className="space-y-2 pl-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{model.name}</span>
                  <code className="text-muted-foreground text-xs break-all">
                    {model.modelId}
                  </code>
                  <Button
                    variant={isDefault ? "secondary" : "ghost"}
                    size="sm"
                    disabled={busy || isDefault}
                    onClick={() =>
                      void run(async () =>
                        setSnapshot(
                          await commands.llmSetDefault({
                            connectionId: connection.id,
                            modelId: model.id,
                          }),
                        ),
                      )
                    }
                  >
                    {isDefault ? (
                      <Trans comment="当前全局默认 LLM">默认模型</Trans>
                    ) : (
                      <Trans comment="设为全局默认 LLM">设为默认</Trans>
                    )}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["connection", "tools", "structured"] as const).map(
                    (kind) => {
                      const result = connection.probes.find(
                        (p) => p.modelId === model.id && p.kind === kind,
                      );
                      const label =
                        kind === "connection"
                          ? t({ message: "连接测试" })
                          : kind === "tools"
                            ? t({ message: "工具测试" })
                            : t({ message: "结构化测试" });
                      const status = !result
                        ? t({
                            comment: "模型能力尚无测试记录",
                            message: "未测试",
                          })
                        : result.revision !== connection.revision
                          ? t({
                              comment: "配置变化后旧测试失效",
                              message: "已过期",
                            })
                          : result.failure
                            ? i18n._(llmErrors[result.failure])
                            : t({ comment: "模型测试通过", message: "通过" });
                      return (
                        <div key={kind} className="max-w-full text-xs">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void probe(connection, model, kind)}
                          >
                            {label}
                          </Button>
                          <p
                            className="text-muted-foreground mt-1 max-w-48"
                            title={
                              result
                                ? new Date(
                                    Number(result.testedAt) * 1000,
                                  ).toLocaleString()
                                : undefined
                            }
                          >
                            {status}
                          </p>
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {probeId ? (
        <Button
          variant="outline"
          onClick={() => void commands.llmCancelProbe(probeId)}
        >
          <Trans comment="停止当前模型能力测试">停止测试</Trans>
        </Button>
      ) : null}
      {formOpen ? (
        <form
          className="space-y-4 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={`${formId}-name`} className="block space-y-1 text-sm">
            <span>
              <Trans comment="LLM 连接显示名称">连接名称</Trans>
            </span>
            <Input
              id={`${formId}-name`}
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>
              <Trans comment="LLM API 协议">协议</Trans>
            </span>
            <select
              className={`${selectClass} block w-full`}
              value={protocol}
              onChange={(e) => {
                const next = e.target.value as LlmProtocol;
                setProtocol(next);
                if (endpoint === endpoints[protocol])
                  setEndpoint(endpoints[next]);
              }}
            >
              <option value="openai">OpenAI Compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label
            htmlFor={`${formId}-endpoint`}
            className="block space-y-1 text-sm"
          >
            <span>
              <Trans>服务地址</Trans>
            </span>
            <Input
              id={`${formId}-endpoint`}
              type="url"
              required
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </label>
          <label htmlFor={`${formId}-key`} className="block space-y-1 text-sm">
            <span>
              <Trans>API 密钥</Trans>
            </span>
            <Input
              id={`${formId}-key`}
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setRemoveKey(false);
              }}
            />
            <span className="text-muted-foreground text-xs">
              {editing?.hasKey ? (
                <Trans>已保存密钥。留空保持原值，输入新值替换。</Trans>
              ) : (
                <Trans>密钥保存在系统凭据库。本地服务可留空。</Trans>
              )}
            </span>
          </label>
          {editing?.hasKey ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={removeKey}
                onChange={(e) => {
                  setRemoveKey(e.target.checked);
                  setKey("");
                }}
              />
              <Trans>移除密钥，改用无密钥连接</Trans>
            </label>
          ) : null}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              <Trans comment="当前连接中的模型列表">模型</Trans>
            </legend>
            {models.map((model) => (
              <div key={model.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 break-all">
                  {model.name} · {model.modelId}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    setModels((current) =>
                      current.filter((m) => m.id !== model.id),
                    )
                  }
                >
                  <Trans comment="从连接配置移除模型">移除</Trans>
                </Button>
              </div>
            ))}
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                aria-label={t({ message: "模型 ID" })}
                placeholder={t({ message: "模型 ID" })}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              />
              <Input
                aria-label={t({ message: "模型显示名称" })}
                placeholder={t({ message: "模型显示名称" })}
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !modelId.trim()}
              onClick={() => {
                addModel({
                  id: crypto.randomUUID(),
                  modelId: modelId.trim(),
                  name: modelName.trim() || modelId.trim(),
                });
                setModelId("");
                setModelName("");
              }}
            >
              <Trans comment="手动添加当前填写的模型">添加模型</Trans>
            </Button>
            {editing ? (
              <Button
                type="button"
                className="ml-2"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    setRemote(await commands.llmListRemoteModels(editing.id)),
                  )
                }
              >
                <Trans comment="从已保存的本地或远程服务连接获取模型列表">
                  获取模型列表
                </Trans>
              </Button>
            ) : (
              <p className="text-muted-foreground text-xs">
                <Trans comment="本地和远程服务都可提供模型列表">
                  保存连接后可以获取服务模型列表。
                </Trans>
              </p>
            )}
            {remote.length ? (
              <div className="max-h-48 overflow-auto border-t">
                {remote.map((model) => (
                  <div
                    key={model.id}
                    className="flex items-center justify-between gap-2 border-b py-2 text-sm"
                  >
                    <span className="break-all">{model.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={models.some((m) => m.modelId === model.modelId)}
                      onClick={() =>
                        addModel({ ...model, id: crypto.randomUUID() })
                      }
                    >
                      <Trans comment="从远程列表选择模型加入配置">加入</Trans>
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </fieldset>
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={busy || !name.trim() || !endpoint.trim()}
            >
              <Trans comment="保存 LLM 连接">保存连接</Trans>
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setFormOpen(false);
                setKey("");
              }}
            >
              <Trans comment="取消编辑 LLM 连接">取消</Trans>
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
