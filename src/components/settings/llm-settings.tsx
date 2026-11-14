import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { LoaderCircleIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { AppState } from "@/components/app-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  publishLlmSnapshot,
  useLlmConnections,
} from "@/hooks/use-llm-connections";
import type {
  AdvertisedReasoning,
  ConnectionChange_Deserialize,
  ListedModel,
  LlmConnection,
  LlmModel,
  LlmProtocol,
  ModelReasoning,
  ProbeKind,
  ReasoningSetting,
} from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import { llmErrorKey, llmErrors } from "@/lib/llm";
import { reasoningChoices, useReasoningLabels } from "@/lib/reasoning";

const endpoints: Record<LlmProtocol, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
};

/** 协议在品牌名维度展示，不翻译；与表单选项文案保持一致。 */
const protocolLabels: Record<LlmProtocol, string> = {
  openai: "OpenAI Compatible",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

/** 阶梯测试顺序：任一步失败即停，后续能力不再发起。 */
const probeKinds = ["connection", "tools", "structured"] as const;

/** token 容量的紧凑表示：1M / 204.8K / 32.8K / 800，一位小数、不四舍五入进整。 */
function compactTokens(value: number) {
  const compact = (scaled: number) => `${Number(scaled.toFixed(1))}`;
  if (value >= 1_000_000) return `${compact(value / 1_000_000)}M`;
  if (value >= 1000) return `${compact(value / 1000)}K`;
  return `${value}`;
}

function validText(value: string, limit: number) {
  return (
    !!value.trim() &&
    [...value].length <= limit &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || (code >= 127 && code <= 159);
    })
  );
}

const manualModelSchema = z
  .object({
    modelId: z.string().refine((value) => validText(value.trim(), 256)),
    modelName: z.string(),
  })
  .refine(
    (value) => validText(value.modelName.trim() || value.modelId.trim(), 120),
    { path: ["modelName"] },
  );

const optionalCapacity = z
  .string()
  .refine(
    (value) =>
      value === "" ||
      (/^[0-9]+$/.test(value) &&
        Number(value) >= 1 &&
        Number(value) <= 4294967295),
  );
const modelSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  name: z.string(),
  contextWindow: optionalCapacity,
  maxOutputTokens: optionalCapacity,
  reasoning: z
    .enum([
      "lowest",
      "provider_default",
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ])
    .optional(),
  advertisedReasoning: z.custom<AdvertisedReasoning>().nullish(),
});
type ModelDraft = z.infer<typeof modelSchema>;

function modelDraft(model: LlmModel): ModelDraft {
  return {
    ...model,
    contextWindow: model.contextWindow?.toString() ?? "",
    maxOutputTokens: model.maxOutputTokens?.toString() ?? "",
  };
}

function modelValue(model: ModelDraft): LlmModel {
  return {
    ...model,
    contextWindow:
      model.contextWindow === "" ? null : Number(model.contextWindow),
    maxOutputTokens:
      model.maxOutputTokens === "" ? null : Number(model.maxOutputTokens),
  };
}

const connectionSchema = z.object({
  name: z.string().refine((value) => validText(value, 120)),
  protocol: z.enum(["openai", "anthropic", "gemini"]),
  endpoint: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !!url.hostname &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }),
  models: z.array(modelSchema).max(256),
  removeKey: z.boolean(),
});

export function LlmSettings() {
  const { t, i18n } = useLingui();
  const formId = useId();
  const snapshot = useLlmConnections();
  const { workspace } = useDesktopSession();
  const setSnapshot = publishLlmSnapshot;
  const [editing, setEditing] = useState<LlmConnection | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const form = useForm({
    resolver: zodResolver(connectionSchema),
    defaultValues: {
      name: "",
      protocol: "openai" as LlmProtocol,
      endpoint: endpoints.openai,
      models: [] as ModelDraft[],
      removeKey: false,
    },
  });
  const { protocol, endpoint, models, removeKey } = form.watch();
  const {
    fields: modelRows,
    append: appendModel,
    remove: removeModel,
  } = useFieldArray({
    control: form.control,
    name: "models",
    keyName: "rowKey",
  });
  const [key, setKey] = useState("");
  const manualModel = useForm({
    resolver: zodResolver(manualModelSchema),
    defaultValues: { modelId: "", modelName: "" },
  });
  const [manualOpen, setManualOpen] = useState(false);
  const [remote, setRemote] = useState<ListedModel[] | null>(null);
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const [reasoningChanged, setReasoningChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingSave, setPendingSave] = useState<{
    operationId: string;
    change: ConnectionChange_Deserialize;
  } | null>(null);
  const [recoveryRead, setRecoveryRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [probeId, setProbeId] = useState<string | null>(null);
  const [probing, setProbing] = useState<{
    connectionId: string;
    modelId: string;
  } | null>(null);
  const mounted = useRef(true);
  const saving = useRef(false);
  const unsavedConnection =
    formOpen &&
    (form.formState.isDirty ||
      manualModel.formState.isDirty ||
      !!key ||
      removeKey ||
      !!pendingSave ||
      busy);

  useEffect(() => {
    const settings = workspace("settings");
    settings.unsavedConnection = unsavedConnection;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!unsavedConnection) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      settings.unsavedConnection = false;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [unsavedConnection, workspace]);

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

  /** 关闭表单并丢弃未保存的编辑；密钥输入与能力提示一并复位。 */
  function cancelEdit() {
    setFormOpen(false);
    setReasoningChanged(false);
    setKey("");
  }

  function edit(connection: LlmConnection | null) {
    setEditing(connection);
    form.reset({
      name: connection?.name ?? "",
      protocol: connection?.protocol ?? "openai",
      endpoint: connection?.endpoint ?? endpoints.openai,
      models: (connection?.models ?? []).map(modelDraft),
      removeKey: false,
    });
    setKey("");
    setRemote(null);
    setReasoningChanged(false);
    manualModel.reset();
    setError(null);
    setFormOpen(true);
  }

  async function save(values: z.infer<typeof connectionSchema>) {
    if (saving.current || pendingSave) return;
    const { removeKey: removeKeyIntent, ...configuration } = values;
    const credential = key
      ? { kind: "replace" as const, value: key }
      : removeKeyIntent
        ? { kind: "remove" as const }
        : { kind: "keep" as const };
    const operation = {
      operationId: crypto.randomUUID(),
      change: {
        id: editing?.id ?? null,
        expectedRevision: editing?.revision ?? null,
        ...configuration,
        models: values.models.map(modelValue),
        credential,
      },
    };
    setPendingSave(operation);
    setRecoveryRead(false);
    await executeSave(operation);
  }

  async function executeSave(operation: {
    operationId: string;
    change: ConnectionChange_Deserialize;
  }) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await commands.llmUpdateConnection(
        operation.change,
        operation.operationId,
      );
      if (mounted.current) {
        setPendingSave(null);
        setKey("");
        setSnapshot(next);
        setFormOpen(false);
        setReasoningChanged(false);
      }
    } catch (cause) {
      if (mounted.current) setError(i18n._(llmErrors[llmErrorKey(cause)]));
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function addModel(model: LlmModel) {
    if (models.length >= 256 || models.some((m) => m.modelId === model.modelId))
      return;
    appendModel(modelDraft(model));
  }

  function setModels(update: (current: ModelDraft[]) => ModelDraft[]) {
    const updated = update(form.getValues("models"));
    updated.forEach((model, index) => {
      form.setValue(`models.${index}`, model, { shouldDirty: true });
    });
  }

  function clearAdvertised() {
    if (
      models.some(
        (model) =>
          model.advertisedReasoning &&
          model.reasoning !== "lowest" &&
          model.reasoning !== "provider_default",
      )
    )
      setReasoningChanged(true);
    setModels((current) =>
      current.map((model) =>
        model.advertisedReasoning
          ? { ...model, advertisedReasoning: null, reasoning: "lowest" }
          : model,
      ),
    );
  }

  /** 用当前表单的地址与凭据拉取远端模型列表，并同步已有模型的能力信息。 */
  function fetchRemoteModels() {
    if (!endpoint.trim()) return;
    setRemote(null);
    setFetchingRemote(true);
    void run(async () => {
      const listed = await commands.llmListRemoteModels(
        editing?.id ?? null,
        protocol,
        endpoint,
        key || (removeKey || !editing ? "" : null),
      );
      setRemote(listed);
      let resetReasoning = false;
      const updated = models.map((model) => {
        const found = listed.find(
          (entry) => entry.model.modelId === model.modelId,
        );
        if (!found?.model.advertisedReasoning) {
          if (!model.advertisedReasoning) return model;
          resetReasoning ||=
            model.reasoning !== "lowest" &&
            model.reasoning !== "provider_default";
          return {
            ...model,
            advertisedReasoning: null,
            reasoning: "lowest" as const,
          };
        }
        const advertisedReasoning = found.model.advertisedReasoning;
        const allowed =
          model.reasoning === "lowest" ||
          model.reasoning === "provider_default" ||
          advertisedReasoning.levels.includes(model.reasoning ?? "lowest");
        resetReasoning ||= !allowed;
        return {
          ...model,
          advertisedReasoning,
          reasoning: allowed ? model.reasoning : ("lowest" as const),
        };
      });
      setModels(() => updated);
      setReasoningChanged((current) => current || resetReasoning);
    }).finally(() => {
      if (mounted.current) setFetchingRemote(false);
    });
  }

  /** 单按钮阶梯测试：连接 → 工具 → 结构化，任一步失败即停，每步结果都落库并即时展示。 */
  async function runTests(connection: LlmConnection, model: LlmModel) {
    const requestId = crypto.randomUUID();
    setProbeId(requestId);
    setProbing({ connectionId: connection.id, modelId: model.id });
    await run(async () => {
      for (const kind of probeKinds) {
        const next = await commands.llmProbe(
          { connectionId: connection.id, modelId: model.id },
          kind,
          requestId,
        );
        if (mounted.current) setSnapshot(next);
        const current = next.connections.find(
          (entry) => entry.id === connection.id,
        );
        const result = current?.probes.find(
          (probe) => probe.modelId === model.id && probe.kind === kind,
        );
        if (!current || !result || result.failure) break;
      }
    });
    if (mounted.current) setProbing(null);
  }

  function kindLabel(kind: ProbeKind) {
    return kind === "connection"
      ? t({ comment: "连接测试类别简称", message: "连接" })
      : kind === "tools"
        ? t({ comment: "工具测试类别简称", message: "工具" })
        : t({ comment: "结构化测试类别简称", message: "结构化" });
  }

  const protocolHints: Record<LlmProtocol, string> = {
    openai: t({
      comment: "OpenAI 兼容协议说明",
      message: "任何兼容 OpenAI Chat Completions 的服务，填入 base URL。",
    }),
    anthropic: t({
      comment: "Anthropic 协议说明",
      message: "Anthropic Messages API 官方端点或兼容代理。",
    }),
    gemini: t({
      comment: "Gemini 协议说明",
      message: "Google Gemini API 官方端点或兼容代理。",
    }),
  };

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
      className="space-y-4"
      aria-label={t({
        comment: "LLM 连接设置分区名称",
        message: "文本模型连接",
      })}
    >
      {!formOpen && (snapshot?.connections.length ?? 0) > 0 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !snapshot}
            onClick={() => edit(null)}
          >
            <Trans comment="添加 LLM 服务配置">添加连接</Trans>
          </Button>
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {pendingSave && !busy && (
        <Alert>
          <AlertDescription>
            <div className="space-y-2">
              <p>
                <Trans>
                  保存结果尚未确认。重试会使用原请求；停止核对不会撤销可能已经完成的保存。
                </Trans>
              </p>
              {recoveryRead && (
                <div>
                  <p>
                    <Trans>
                      已重新读取连接。列表不能确认密钥内容或证明本次保存是否完成。
                    </Trans>
                  </p>
                  {snapshot?.connections.length ? (
                    <ul>
                      {snapshot.connections.map((connection) => (
                        <li key={connection.id}>
                          {connection.name} · {connection.endpoint} ·{" "}
                          {connection.revision}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      <Trans>当前没有连接。</Trans>
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void executeSave(pendingSave)}
                >
                  <Trans>重试原保存</Trans>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void run(async () => {
                      const next = await commands.llmSnapshot();
                      if (mounted.current) {
                        setSnapshot(next);
                        setRecoveryRead(true);
                      }
                    })
                  }
                >
                  <Trans>重新读取连接</Trans>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!recoveryRead}
                  onClick={() => {
                    setPendingSave(null);
                    setRecoveryRead(false);
                    setError(null);
                  }}
                >
                  <Trans>停止核对并继续编辑</Trans>
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {reasoningChanged ? (
        <Alert>
          <AlertDescription>
            <Trans>
              模型的可用档位已变化，部分模型已恢复自动档，请检查后保存。
            </Trans>
          </AlertDescription>
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
      {!formOpen && snapshot?.connections.length === 0 ? (
        <AppState
          kind="empty"
          title={<Trans>尚未添加连接</Trans>}
          description={
            <Trans>
              配置 OpenAI 兼容、Anthropic 或 Gemini
              服务的地址与密钥；本地小说导入不需要配置模型。
            </Trans>
          }
          actions={
            <Button disabled={busy} onClick={() => edit(null)}>
              <Trans comment="添加 LLM 服务配置">添加连接</Trans>
            </Button>
          }
        />
      ) : null}
      {!formOpen &&
        snapshot?.connections.map((connection) => (
          // 拉伸按钮卡片：名称是真按钮，::after 铺满整卡承载点击；
          // 其余操作按钮是兄弟节点叠在上层（relative），无需 stopPropagation。
          <div
            key={connection.id}
            className="border-border bg-card rounded-control hover:border-input focus-within:border-ring relative space-y-3 border p-4 transition-colors"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm leading-6 font-medium">
                    <button
                      type="button"
                      disabled={busy}
                      className="after:rounded-control after:absolute after:inset-0 cursor-pointer text-left outline-none focus-visible:after:ring-ring/50 focus-visible:after:ring-3"
                      aria-label={t`编辑连接 ${connection.name}`}
                      onClick={() => edit(connection)}
                    >
                      {connection.name}
                    </button>
                  </h3>
                  <Badge variant="outline-muted">
                    {protocolLabels[connection.protocol]}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs break-all">
                  {connection.endpoint}
                </p>
              </div>
              <div className="relative flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={t`删除连接 ${connection.name}`}
                  onClick={() => setDeleting(connection.id)}
                >
                  <Trans comment="删除 LLM 连接">删除</Trans>
                </Button>
              </div>
            </div>
            {deleting === connection.id ? (
              <div className="relative flex flex-wrap items-center gap-2 text-sm">
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
            <div className="relative min-w-0 space-y-1.5">
              {connection.models.map((model) => {
                const isDefault =
                  snapshot.defaultModel?.connectionId === connection.id &&
                  snapshot.defaultModel?.modelId === model.id;
                const isProbingThis =
                  probing?.connectionId === connection.id &&
                  probing?.modelId === model.id &&
                  !!probeId;
                const failures = connection.probes.filter(
                  (probe) =>
                    probe.modelId === model.id &&
                    probe.revision === connection.revision &&
                    probe.failure,
                );
                return (
                  <div key={model.id} className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm">
                      <span className="min-w-0 break-all">{model.name}</span>
                      {model.modelId !== model.name && (
                        <code className="text-muted-foreground text-xs break-all">
                          {model.modelId}
                        </code>
                      )}
                      {isDefault ? (
                        <Badge variant="secondary">
                          <Trans comment="当前全局默认模型标记">默认</Trans>
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={busy}
                          aria-label={t`将 ${model.name} 设为默认模型`}
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
                          <Trans comment="设为全局默认 LLM">设为默认</Trans>
                        </Button>
                      )}
                      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
                        {probeKinds.map((kind) => {
                          const result = connection.probes.find(
                            (probe) =>
                              probe.modelId === model.id && probe.kind === kind,
                          );
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
                                ? t({
                                    comment: "模型测试未通过",
                                    message: "失败",
                                  })
                                : t({
                                    comment: "模型测试通过",
                                    message: "通过",
                                  });
                          const variant = !result
                            ? "outline-muted"
                            : result.revision !== connection.revision
                              ? "warning"
                              : result.failure
                                ? "destructive"
                                : "success";
                          return (
                            <Badge
                              key={kind}
                              variant={variant}
                              title={
                                result
                                  ? `${status}${result.failure ? `：${i18n._(llmErrors[result.failure])}` : ""} · ${new Date(Number(result.testedAt) * 1000).toLocaleString()}`
                                  : undefined
                              }
                            >
                              {kindLabel(kind)} · {status}
                            </Badge>
                          );
                        })}
                        {isProbingThis ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (probeId)
                                void commands.llmCancelProbe(probeId);
                            }}
                          >
                            <span
                              data-icon="inline-start"
                              className="motion-safe:animate-spin"
                            >
                              <LoaderCircleIcon />
                            </span>
                            <Trans comment="停止当前模型能力测试">
                              停止测试
                            </Trans>
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            aria-label={t`测试模型 ${model.name}`}
                            onClick={() => void runTests(connection, model)}
                          >
                            <Trans comment="对单个模型运行连接、工具与结构化阶梯测试">
                              运行测试
                            </Trans>
                          </Button>
                        )}
                      </div>
                    </div>
                    {failures.length ? (
                      <ul className="space-y-0.5">
                        {failures.map((probe) => (
                          <li
                            key={probe.kind}
                            className="text-destructive text-xs"
                          >
                            {kindLabel(probe.kind)}：
                            {probe.failure
                              ? i18n._(llmErrors[probe.failure])
                              : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      {formOpen ? (
        <>
          <form
            className="space-y-4 border-t pt-4"
            noValidate
            onSubmit={form.handleSubmit(
              (values) => void save(values),
              (errors) => {
                if (errors.name || errors.endpoint || errors.protocol) return;
                const index = Array.isArray(errors.models)
                  ? errors.models.findIndex(
                      (error) => error?.contextWindow || error?.maxOutputTokens,
                    )
                  : -1;
                if (index < 0) return;
                const field = errors.models?.[index]?.contextWindow
                  ? "contextWindow"
                  : "maxOutputTokens";
                requestAnimationFrame(() => {
                  form.setFocus(`models.${index}.${field}`);
                });
              },
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium">
                {editing ? (
                  <Trans comment="编辑现有文本模型服务连接的表单标题">
                    编辑连接
                  </Trans>
                ) : (
                  <Trans comment="新建文本模型服务连接的表单标题">
                    添加连接
                  </Trans>
                )}
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={t({
                  comment: "关闭连接编辑表单并丢弃未保存修改",
                  message: "取消编辑",
                })}
                onClick={cancelEdit}
              >
                <XIcon />
              </Button>
            </div>
            <fieldset disabled={busy || !!pendingSave} className="space-y-4">
              <Field data-invalid={!!form.formState.errors.name}>
                <FieldLabel htmlFor={`${formId}-name`}>
                  <Trans comment="LLM 连接显示名称">连接名称</Trans>
                </FieldLabel>
                <Input
                  {...form.register("name")}
                  id={`${formId}-name`}
                  className="max-w-md"
                  required
                  maxLength={120}
                  aria-invalid={!!form.formState.errors.name}
                  aria-describedby={
                    form.formState.errors.name
                      ? `${formId}-name-error`
                      : undefined
                  }
                />
                {form.formState.errors.name && (
                  <FieldError id={`${formId}-name-error`}>
                    <Trans>请输入有效的连接名称。</Trans>
                  </FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel>
                  <Trans comment="LLM API 协议">协议</Trans>
                </FieldLabel>
                <Tabs
                  value={protocol}
                  onValueChange={(next) => {
                    if (next === protocol) return;
                    const target = next as LlmProtocol;
                    form.setValue("protocol", target, { shouldDirty: true });
                    setRemote(null);
                    setModels((current) =>
                      current.map((model) => ({
                        ...model,
                        reasoning: "lowest",
                        advertisedReasoning: null,
                      })),
                    );
                    if (endpoint === endpoints[protocol])
                      form.setValue("endpoint", endpoints[target], {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                  }}
                >
                  <TabsList>
                    <TabsTrigger value="openai">OpenAI Compatible</TabsTrigger>
                    <TabsTrigger value="anthropic">Anthropic</TabsTrigger>
                    <TabsTrigger value="gemini">Gemini</TabsTrigger>
                  </TabsList>
                </Tabs>
                <FieldDescription>{protocolHints[protocol]}</FieldDescription>
              </Field>
              <Field data-invalid={!!form.formState.errors.endpoint}>
                <FieldLabel htmlFor={`${formId}-endpoint`}>
                  <Trans>服务地址</Trans>
                </FieldLabel>
                <Input
                  {...form.register("endpoint")}
                  id={`${formId}-endpoint`}
                  className="max-w-md"
                  type="url"
                  required
                  aria-invalid={!!form.formState.errors.endpoint}
                  aria-describedby={
                    form.formState.errors.endpoint
                      ? `${formId}-endpoint-error`
                      : undefined
                  }
                  onChange={(e) => {
                    void form.register("endpoint").onChange(e);
                    setRemote(null);
                    clearAdvertised();
                  }}
                />
                {form.formState.errors.endpoint && (
                  <FieldError id={`${formId}-endpoint-error`}>
                    <Trans>
                      请输入不含凭据、查询或片段的 HTTP 或 HTTPS 地址。
                    </Trans>
                  </FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor={`${formId}-key`}>
                  <Trans>API 密钥</Trans>
                </FieldLabel>
                <Input
                  id={`${formId}-key`}
                  className="max-w-md"
                  type="password"
                  autoComplete="off"
                  aria-describedby={`${formId}-key-description`}
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    form.setValue("removeKey", false, { shouldDirty: true });
                    setRemote(null);
                    clearAdvertised();
                  }}
                />
                <FieldDescription id={`${formId}-key-description`}>
                  {editing?.hasKey ? (
                    <Trans>已保存密钥。留空保持原值，输入新值替换。</Trans>
                  ) : (
                    <Trans>密钥保存在系统凭据库。本地服务可留空。</Trans>
                  )}
                </FieldDescription>
              </Field>
              {editing?.hasKey ? (
                <Controller
                  control={form.control}
                  name="removeKey"
                  render={({ field }) => (
                    <Field orientation="horizontal">
                      <Checkbox
                        id={`${formId}-remove-key`}
                        ref={field.ref}
                        checked={field.value}
                        disabled={busy || !!pendingSave}
                        onBlur={field.onBlur}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          setKey("");
                          setRemote(null);
                          clearAdvertised();
                        }}
                      />
                      <FieldLabel htmlFor={`${formId}-remove-key`}>
                        <Trans>移除密钥，改用无密钥连接</Trans>
                      </FieldLabel>
                    </Field>
                  )}
                />
              ) : null}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="text-sm font-medium">
                    <Trans comment="当前连接中的模型列表">模型</Trans>
                  </h5>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || !endpoint.trim()}
                      onClick={fetchRemoteModels}
                    >
                      {fetchingRemote ? (
                        <span
                          data-icon="inline-start"
                          className="motion-safe:animate-spin"
                        >
                          <LoaderCircleIcon />
                        </span>
                      ) : null}
                      <Trans comment="使用当前连接表单的地址和凭据获取模型列表">
                        获取模型列表
                      </Trans>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || models.length >= 256}
                      onClick={() => setManualOpen(true)}
                    >
                      <Trans comment="打开手动添加模型弹窗">添加模型</Trans>
                    </Button>
                  </div>
                </div>
                {modelRows.map((row, index) => {
                  const model = models[index] ?? row;
                  const errors = form.formState.errors.models?.[index];
                  const contextWindow = Number(model.contextWindow);
                  return (
                    <div
                      key={row.rowKey}
                      className="border-border space-y-3 rounded-control border p-3"
                    >
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                        <span className="min-w-0 font-medium break-all">
                          {model.name}
                        </span>
                        {model.modelId !== model.name && (
                          <code className="text-muted-foreground min-w-0 text-xs break-all">
                            {model.modelId}
                          </code>
                        )}
                        {contextWindow > 0 && (
                          <Badge
                            variant="outline-muted"
                            title={t({
                              comment: "模型上下文容量徽章说明",
                              message: "上下文窗口",
                            })}
                          >
                            {compactTokens(contextWindow)}
                          </Badge>
                        )}
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          className="ml-auto"
                          disabled={busy}
                          onClick={() => removeModel(index)}
                          aria-label={t`移除模型 ${model.name}`}
                        >
                          <Trans comment="从连接配置移除模型">移除</Trans>
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Controller
                          control={form.control}
                          name={`models.${index}.reasoning`}
                          render={({ field }) => (
                            <ReasoningSelect
                              id={`${formId}-${model.id}-reasoning`}
                              model={{ ...model, reasoning: field.value }}
                              protocol={protocol}
                              catalog={snapshot?.reasoningCatalog ?? []}
                              disabled={busy || !!pendingSave}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              inputRef={field.ref}
                            />
                          )}
                        />
                        <Field data-invalid={!!errors?.contextWindow}>
                          <FieldLabel htmlFor={`${formId}-${model.id}-context`}>
                            <Trans>上下文窗口（tokens，可选）</Trans>
                          </FieldLabel>
                          <Input
                            type="text"
                            inputMode="numeric"
                            id={`${formId}-${model.id}-context`}
                            disabled={busy}
                            placeholder={t`未知`}
                            {...form.register(`models.${index}.contextWindow`)}
                            aria-invalid={!!errors?.contextWindow}
                            aria-describedby={
                              errors?.contextWindow
                                ? `${formId}-${model.id}-context-error`
                                : undefined
                            }
                          />
                          {errors?.contextWindow && (
                            <FieldError
                              id={`${formId}-${model.id}-context-error`}
                            >
                              <Trans>
                                请输入 1 至 4294967295 的整数，或留空。
                              </Trans>
                            </FieldError>
                          )}
                        </Field>
                        <Field data-invalid={!!errors?.maxOutputTokens}>
                          <FieldLabel htmlFor={`${formId}-${model.id}-output`}>
                            <Trans>输出上限（tokens，可选）</Trans>
                          </FieldLabel>
                          <Input
                            type="text"
                            inputMode="numeric"
                            id={`${formId}-${model.id}-output`}
                            disabled={busy}
                            placeholder={t`服务商默认`}
                            {...form.register(
                              `models.${index}.maxOutputTokens`,
                            )}
                            aria-invalid={!!errors?.maxOutputTokens}
                            aria-describedby={
                              errors?.maxOutputTokens
                                ? `${formId}-${model.id}-output-error`
                                : undefined
                            }
                          />
                          {errors?.maxOutputTokens && (
                            <FieldError
                              id={`${formId}-${model.id}-output-error`}
                            >
                              <Trans>
                                请输入 1 至 4294967295 的整数，或留空。
                              </Trans>
                            </FieldError>
                          )}
                        </Field>
                      </div>
                    </div>
                  );
                })}
                <p className="text-muted-foreground text-xs leading-5">
                  <Trans>
                    留空不设置应用上限。窗口容量用于显示和章节分窗估计；部分协议要求输出参数，实际限制由服务商决定。
                  </Trans>
                </p>
                {models.length >= 256 && (
                  <FieldDescription>
                    <Trans>每个连接最多添加 256 个模型。</Trans>
                  </FieldDescription>
                )}
                {remote && remote.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    <Trans>服务未返回模型，可手动添加。</Trans>
                  </p>
                ) : null}
                {remote?.length ? (
                  <div className="max-h-64 overflow-y-auto border-border border-t">
                    {remote.map(({ model, outputLimit }) => (
                      <div
                        key={model.id}
                        className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b py-2 text-sm [&:last-child]:border-b-0"
                      >
                        <span className="min-w-0 font-medium break-all">
                          {model.name}
                        </span>
                        {model.modelId !== model.name && (
                          <code className="text-muted-foreground min-w-0 text-xs break-all">
                            {model.modelId}
                          </code>
                        )}
                        {model.contextWindow || outputLimit ? (
                          <span className="text-muted-foreground text-xs">
                            {model.contextWindow ? (
                              <>
                                <Trans comment="模型列表中服务商提供的上下文或输入容量">
                                  上下文
                                </Trans>{" "}
                                {compactTokens(model.contextWindow)}
                              </>
                            ) : null}
                            {model.contextWindow && outputLimit ? " · " : null}
                            {outputLimit ? (
                              <>
                                <Trans comment="模型列表中服务商提供的输出能力上限，不是请求参数">
                                  输出上限
                                </Trans>{" "}
                                {compactTokens(outputLimit)}
                              </>
                            ) : null}
                          </span>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="ml-auto"
                          disabled={
                            models.length >= 256 ||
                            models.some((m) => m.modelId === model.modelId)
                          }
                          onClick={() =>
                            addModel({ ...model, id: crypto.randomUUID() })
                          }
                        >
                          <Trans comment="从远程列表选择模型加入配置">
                            加入
                          </Trans>
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  <Trans comment="保存 LLM 连接">保存连接</Trans>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={cancelEdit}
                >
                  <Trans comment="取消编辑 LLM 连接">取消</Trans>
                </Button>
              </div>
            </fieldset>
          </form>
          <Dialog open={manualOpen} onOpenChange={setManualOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  <Trans comment="手动添加模型弹窗标题">添加模型</Trans>
                </DialogTitle>
                <DialogDescription>
                  <Trans>
                    填入服务商提供的模型 ID；显示名称可留空，留空时以 ID 显示。
                  </Trans>
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                noValidate
                onSubmit={manualModel.handleSubmit(({ modelId, modelName }) => {
                  if (
                    models.some((model) => model.modelId === modelId.trim())
                  ) {
                    manualModel.setError(
                      "modelId",
                      { type: "duplicate" },
                      { shouldFocus: true },
                    );
                    return;
                  }
                  addModel({
                    id: crypto.randomUUID(),
                    reasoning: "lowest",
                    modelId: modelId.trim(),
                    name: modelName.trim() || modelId.trim(),
                  });
                  manualModel.reset();
                  setManualOpen(false);
                })}
              >
                <Field data-invalid={!!manualModel.formState.errors.modelId}>
                  <FieldLabel htmlFor={`${formId}-new-model-id`}>
                    <Trans>模型 ID</Trans>
                  </FieldLabel>
                  <Input
                    id={`${formId}-new-model-id`}
                    {...manualModel.register("modelId")}
                    aria-invalid={!!manualModel.formState.errors.modelId}
                    aria-describedby={
                      manualModel.formState.errors.modelId
                        ? `${formId}-new-model-id-error`
                        : undefined
                    }
                  />
                  {manualModel.formState.errors.modelId && (
                    <FieldError id={`${formId}-new-model-id-error`}>
                      {manualModel.formState.errors.modelId.type ===
                      "duplicate" ? (
                        <Trans>此模型 ID 已在连接中。</Trans>
                      ) : (
                        <Trans>请输入有效的模型 ID，最多 256 个字符。</Trans>
                      )}
                    </FieldError>
                  )}
                </Field>
                <Field data-invalid={!!manualModel.formState.errors.modelName}>
                  <FieldLabel htmlFor={`${formId}-new-model-name`}>
                    <Trans>模型显示名称</Trans>
                  </FieldLabel>
                  <Input
                    id={`${formId}-new-model-name`}
                    {...manualModel.register("modelName")}
                    aria-invalid={!!manualModel.formState.errors.modelName}
                    aria-describedby={
                      manualModel.formState.errors.modelName
                        ? `${formId}-new-model-name-error`
                        : undefined
                    }
                  />
                  {manualModel.formState.errors.modelName && (
                    <FieldError id={`${formId}-new-model-name-error`}>
                      <Trans>请输入有效的显示名称，最多 120 个字符。</Trans>
                    </FieldError>
                  )}
                </Field>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || !!pendingSave}
                    onClick={() => setManualOpen(false)}
                  >
                    <Trans comment="取消手动添加模型">取消</Trans>
                  </Button>
                  <Button
                    type="submit"
                    disabled={busy || !!pendingSave || models.length >= 256}
                  >
                    <Trans comment="确认添加手动填写的模型">添加</Trans>
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </section>
  );
}

/** The host supplies the allowlist; the browser does not infer capabilities from model names. */
export function ReasoningSelect({
  id,
  model,
  protocol,
  catalog,
  disabled,
  onChange,
  onBlur,
  inputRef,
}: {
  id: string;
  model: Pick<LlmModel, "modelId" | "advertisedReasoning" | "reasoning">;
  protocol: LlmProtocol;
  catalog: ModelReasoning[];
  disabled: boolean;
  onChange: (setting: ReasoningSetting) => void;
  onBlur?: () => void;
  inputRef?: React.Ref<HTMLSelectElement>;
}) {
  const { t } = useLingui();
  const labels = useReasoningLabels();
  const choices = reasoningChoices(
    catalog,
    protocol,
    model.modelId,
    model.advertisedReasoning,
  );
  const minimumLabel = choices.length ? labels[choices[0]] : "";
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        <Trans comment="模型生成回答时的推理强度设置">思考强度</Trans>
      </FieldLabel>
      <NativeSelect
        id={id}
        ref={inputRef}
        onBlur={onBlur}
        value={model.reasoning ?? "lowest"}
        disabled={disabled || choices.length === 0}
        onChange={(event) => {
          const value = event.target.value as ReasoningSetting;
          if (
            value === "lowest" ||
            value === "provider_default" ||
            choices.includes(value)
          )
            onChange(value);
        }}
      >
        <option value="lowest">
          {choices.length
            ? t({
                comment:
                  "自动选用当前模型最低支持的思考档位；minimumLabel 是本地化档位名称",
                message: `自动（最低：${minimumLabel}）`,
              })
            : t`服务商默认（无已知可调档位）`}
        </option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {labels[choice]}
          </option>
        ))}
        {choices.length ? (
          <option value="provider_default">{t`服务商默认`}</option>
        ) : null}
      </NativeSelect>
      <FieldDescription>
        {choices.length ? (
          <Trans>保存后用于新任务。可选档位来自模型能力信息。</Trans>
        ) : (
          <Trans>未确认可调思考能力，不发送思考参数。</Trans>
        )}
      </FieldDescription>
    </Field>
  );
}
