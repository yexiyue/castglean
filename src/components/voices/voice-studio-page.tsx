import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { AuxiliaryDialog } from "@/components/auxiliary-dialog";
import { BrowserPreviewGuide } from "@/components/browser-preview-guide";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useStudioOperations } from "@/hooks/use-studio-operations";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import type { InferenceDevice } from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";
import { DesignResources } from "./design-resources";
import { StudioJobs } from "./studio-jobs";
import { VoiceCandidate } from "./voice-candidate";

const byteLength = (value: string) => new TextEncoder().encode(value).length;
const initialDraft = {
  method: "design",
  name: "",
  description: "",
  transcript: "",
  text: "你好，欢迎收听今天的故事。山风吹过松林，星光照亮归途。",
  engine: "",
  device: "" as InferenceDevice | "",
  seed: "",
};
const schema = z
  .object({
    method: z.string(),
    name: z.string(),
    description: z.string(),
    transcript: z.string(),
    text: z.string(),
    engine: z.string(),
    device: z.custom<InferenceDevice | "">(),
    seed: z.string(),
  })
  .superRefine((value, context) => {
    if (!value.name.trim() || byteLength(value.name) > 256)
      context.addIssue({ code: "custom", path: ["name"], message: "name" });
    if (
      value.method === "recording" &&
      (!value.transcript.trim() || byteLength(value.transcript) > 16384)
    )
      context.addIssue({
        code: "custom",
        path: ["transcript"],
        message: "transcript",
      });
    if (
      value.method === "design" &&
      (!value.text.trim() ||
        value.text.includes("\0") ||
        [...value.text].length > 500)
    )
      context.addIssue({ code: "custom", path: ["text"], message: "text" });
  });

export function VoiceStudioPage() {
  const { t } = useLingui();
  const formId = useId();
  const studio = useVoiceStudio();
  const operations = useStudioOperations();
  const [savedDraft, setDraft] = useWorkspaceState(
    "voice-studio",
    "creation-draft",
    initialDraft,
  );
  const form = useForm<z.infer<typeof schema>>({
    defaultValues: savedDraft,
    resolver: zodResolver(schema),
  });
  const draft = form.watch();
  const engine = draft.engine
    ? studio.engines.find((entry) => entry.id === draft.engine)
    : (studio.engines.find((entry) => entry.devices.length > 0) ??
      studio.engines[0]);
  const device = draft.device
    ? engine?.devices.find((entry) => entry === draft.device)
    : engine?.devices[0];
  const update = (key: keyof typeof draft, value: string) => {
    form.setValue(key, value, { shouldDirty: true });
    form.clearErrors(key);
    setDraft((old) => ({ ...old, [key]: value }));
    const current = form.getValues();
    operations.setDraftDirty(
      "studio:creation",
      (Object.keys(initialDraft) as Array<keyof typeof initialDraft>).some(
        (field) => current[field] !== initialDraft[field],
      ),
    );
  };
  const validSeed =
    !draft.seed ||
    (/^\d+$/.test(draft.seed) && Number(draft.seed) <= 0xffffffff);
  const validate = () => {
    let first: "name" | "description" | "text" | "transcript" | undefined;
    const error = (
      field: "name" | "description" | "text" | "transcript",
      message: string,
    ) => {
      form.setError(field, { message });
      first ??= field;
    };
    if (draft.method === "design" && engine) {
      if (
        !draft.description.trim() ||
        byteLength(draft.description) >
          Math.min(16384, engine.description_max_bytes) ||
        (engine.description_max_chars != null &&
          [...draft.description].length > engine.description_max_chars) ||
        (engine.forbid_parentheses && /[()（）]/.test(draft.description))
      )
        error("description", t`请输入符合引擎限制的声音描述。`);
      if ([...draft.text].length > Math.min(500, engine.text_max_chars))
        error("text", t`请输入符合长度限制且不含空字符的朗读文本。`);
    }
    if (first) form.setFocus(first);
    return !first && validSeed;
  };
  const fieldError = (message?: string) => {
    if (message === "name") return t`请输入名称，最多 256 字节。`;
    if (message === "transcript") return t`请输入准确转写，最多 16384 字节。`;
    if (message === "text")
      return t`请输入符合长度限制且不含空字符的朗读文本。`;
    return message;
  };
  return (
    <PageShell
      active="voices"
      title={t({ comment: "独立音色制作页标题", message: "创建音色" })}
      navigation={
        <div className="flex items-center gap-3">
          <Link
            to="/voices"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-item inline-flex items-center gap-1.5 text-sm outline-none focus-visible:ring-2"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            <Trans>音色中心</Trans>
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span className="text-sm font-medium">
            <Trans>创建音色</Trans>
          </span>
        </div>
      }
      description={t({
        message: "从声音描述或参考录音开始，试听满意后再加入音色库。",
      })}
    >
      {!studio.desktop ? (
        <div className="mx-auto w-full max-w-6xl px-6 py-12 pb-32">
          <BrowserPreviewGuide
            summary={
              <Trans>
                音色创建需要读取参考录音、加载本机模型并保存结果，请在桌面应用中使用。
              </Trans>
            }
          />
        </div>
      ) : (
        <div className="mx-auto grid max-w-6xl gap-5 p-5 pb-28 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col gap-4">
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  form.reset(initialDraft);
                  setDraft(initialDraft);
                  operations.setDraftDirty("studio:creation", false);
                }}
              >
                <Trans>重置创建草稿</Trans>
              </Button>
            </div>
            <Tabs
              value={draft.method}
              onValueChange={(value) => update("method", String(value))}
            >
              <TabsList
                variant="line"
                aria-label={t({
                  message: "创建方式",
                  comment: "选择文字描述或已有录音创建音色",
                })}
              >
                <TabsTrigger value="design">
                  <Trans comment="从描述生成参考音色的方法">文字设计</Trans>
                </TabsTrigger>
                <TabsTrigger value="recording">
                  <Trans comment="从本地录音创建音色的方法">参考录音</Trans>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="grid gap-3 sm:grid-cols-2">
              {" "}
              <Field data-invalid={!!form.formState.errors.name}>
                <FieldLabel htmlFor={`${formId}-1`}>
                  <Trans comment="正式入库时显示的音色名称">音色名称</Trans>
                </FieldLabel>
                <Input
                  id={`${formId}-1`}
                  ref={form.register("name").ref}
                  aria-invalid={!!form.formState.errors.name}
                  aria-describedby={
                    form.formState.errors.name
                      ? `${formId}-name-error`
                      : undefined
                  }
                  value={draft.name}
                  onChange={(e) => update("name", e.target.value)}
                />
                <FieldError id={`${formId}-name-error`}>
                  {fieldError(form.formState.errors.name?.message)}
                </FieldError>
              </Field>
              {draft.method === "design" && (
                <Field>
                  <FieldLabel htmlFor={`${formId}-engine`}>
                    <Trans comment="独立音色生成器选择">设计引擎</Trans>
                  </FieldLabel>
                  <Controller
                    control={form.control}
                    name="engine"
                    render={({ field }) => (
                      <NativeSelect
                        id={`${formId}-engine`}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={engine?.id ?? ""}
                        onChange={(e) => {
                          update("engine", e.target.value);
                          update("device", "");
                        }}
                      >
                        {!engine && (
                          <option value="" disabled>
                            {draft.engine ? t`已选引擎不可用` : t`暂无可用引擎`}
                          </option>
                        )}
                        {studio.engines.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  />
                </Field>
              )}
            </div>
            {draft.method === "design" ? (
              <>
                <Field data-invalid={!!form.formState.errors.description}>
                  <FieldLabel htmlFor={`${formId}-2`}>
                    <Trans comment="描述想设计的声音特征">声音描述</Trans>
                  </FieldLabel>
                  <Textarea
                    id={`${formId}-2`}
                    ref={form.register("description").ref}
                    aria-invalid={!!form.formState.errors.description}
                    aria-describedby={
                      [
                        engine && `${formId}-description-help`,
                        form.formState.errors.description &&
                          `${formId}-description-error`,
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    value={draft.description}
                    onChange={(e) => update("description", e.target.value)}
                  />
                  {engine && (
                    <FieldDescription id={`${formId}-description-help`}>
                      <Trans>
                        最多 {Math.min(16384, engine.description_max_bytes)}{" "}
                        字节。
                      </Trans>{" "}
                      {engine.description_max_chars != null && (
                        <Trans>
                          最多 {engine.description_max_chars} 个字符。
                        </Trans>
                      )}{" "}
                      {engine.forbid_parentheses && (
                        <Trans>不能包含括号。</Trans>
                      )}
                    </FieldDescription>
                  )}
                  <FieldError id={`${formId}-description-error`}>
                    {form.formState.errors.description?.message}
                  </FieldError>
                </Field>
                <Field data-invalid={!!form.formState.errors.text}>
                  <FieldLabel htmlFor={`${formId}-3`}>
                    <Trans comment="设计结果实际朗读的文字">朗读文本</Trans>
                  </FieldLabel>
                  <Textarea
                    id={`${formId}-3`}
                    ref={form.register("text").ref}
                    aria-invalid={!!form.formState.errors.text}
                    aria-describedby={
                      [
                        engine && `${formId}-text-help`,
                        form.formState.errors.text && `${formId}-text-error`,
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    value={draft.text}
                    onChange={(e) => update("text", e.target.value)}
                  />
                  {engine && (
                    <FieldDescription id={`${formId}-text-help`}>
                      <Trans>
                        最多 {Math.min(engine.text_max_chars, 500)}{" "}
                        个字符，描述最多 {engine.description_max_bytes} 字节。
                      </Trans>
                    </FieldDescription>
                  )}
                  <FieldError id={`${formId}-text-error`}>
                    {fieldError(form.formState.errors.text?.message)}
                  </FieldError>
                </Field>
                <AuxiliaryDialog
                  title={
                    <>
                      {" "}
                      <Trans comment="音色制作中较少调整的设备与随机种子">
                        高级选项
                      </Trans>{" "}
                    </>
                  }
                >
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor={`${formId}-device`}>
                        <Trans comment="音色设计推理的计算设备">计算设备</Trans>
                      </FieldLabel>
                      <Controller
                        control={form.control}
                        name="device"
                        render={({ field }) => (
                          <NativeSelect
                            id={`${formId}-device`}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={device ?? ""}
                            onChange={(e) =>
                              update(
                                "device",
                                e.target.value as InferenceDevice,
                              )
                            }
                          >
                            {!device && (
                              <option value="" disabled>
                                {draft.device
                                  ? t`已选设备不可用`
                                  : t`暂无可用设备`}
                              </option>
                            )}
                            {engine?.devices.map((d) => (
                              <option key={d}>{d}</option>
                            ))}
                          </NativeSelect>
                        )}
                      />
                    </Field>
                    <Field data-invalid={!validSeed}>
                      <FieldLabel htmlFor={`${formId}-4`}>
                        <Trans comment="可选的音色生成随机种子">
                          随机种子（可选）
                        </Trans>
                      </FieldLabel>
                      <Input
                        id={`${formId}-4`}
                        ref={form.register("seed").ref}
                        value={draft.seed}
                        inputMode="numeric"
                        onChange={(e) => update("seed", e.target.value)}
                        aria-invalid={!validSeed}
                        aria-describedby={
                          !validSeed ? `${formId}-seed-error` : undefined
                        }
                      />
                      <FieldError id={`${formId}-seed-error`}>
                        {!validSeed && (
                          <Trans>
                            随机种子请输入 0 到 4294967295 之间的整数。
                          </Trans>
                        )}
                      </FieldError>
                    </Field>
                  </div>
                </AuxiliaryDialog>
                {!validSeed && (
                  <p role="alert" className="text-destructive mt-2 text-sm">
                    <Trans>随机种子请输入 0 到 4294967295 之间的整数。</Trans>
                  </p>
                )}
                <Button
                  disabled={
                    !studio.desktop ||
                    studio.pending ||
                    studio.loading ||
                    studio.loadError ||
                    !engine?.ready ||
                    !device ||
                    !validSeed
                  }
                  onClick={() =>
                    void form.handleSubmit(() => {
                      if (engine && device && validate())
                        void studio.start({
                          kind: "design",
                          engine: engine.id,
                          device,
                          name: draft.name,
                          description: draft.description,
                          text: draft.text,
                          seed: draft.seed ? Number(draft.seed) : null,
                        });
                    })()
                  }
                >
                  <Trans comment="生成待确认候选，不直接入库">
                    生成音色候选
                  </Trans>
                </Button>
                {!studio.loading && !studio.loadError && !engine && (
                  <p role="status" className="text-muted-foreground text-sm">
                    {draft.engine ? (
                      <Trans>已选引擎不可用，请重新选择或等待其恢复。</Trans>
                    ) : (
                      <Trans>暂无可用引擎，无法生成音色候选。</Trans>
                    )}
                  </p>
                )}
                {engine && !device && (
                  <p role="status" className="text-muted-foreground text-sm">
                    {draft.device ? (
                      <Trans>
                        已选设备不可用，请在高级选项中重新选择或等待其恢复。
                      </Trans>
                    ) : (
                      <Trans>此引擎没有可用设备。</Trans>
                    )}
                  </p>
                )}
                {(!engine?.ready || studio.loadError) && (
                  <DesignResources studio={studio} query={engine?.name ?? ""} />
                )}
              </>
            ) : (
              <>
                <Field data-invalid={!!form.formState.errors.transcript}>
                  <FieldLabel htmlFor={`${formId}-5`}>
                    <Trans comment="与参考 WAV 完全对应的人工准确转写">
                      准确转写
                    </Trans>
                  </FieldLabel>
                  <Textarea
                    id={`${formId}-5`}
                    ref={form.register("transcript").ref}
                    aria-invalid={!!form.formState.errors.transcript}
                    aria-describedby={
                      form.formState.errors.transcript
                        ? `${formId}-transcript-error`
                        : undefined
                    }
                    value={draft.transcript}
                    onChange={(e) => update("transcript", e.target.value)}
                  />
                  <FieldError id={`${formId}-transcript-error`}>
                    {fieldError(form.formState.errors.transcript?.message)}
                  </FieldError>
                </Field>
                <p className="text-muted-foreground text-sm">
                  <Trans>
                    选择 25 MiB 以内的非空 WAV。试听和保存参考录音无需下载模型。
                  </Trans>
                </p>
                <Button
                  disabled={
                    !studio.desktop || studio.pending || !!operations.reference
                  }
                  onClick={() =>
                    void form.handleSubmit(() => {
                      if (validate())
                        void operations.startReference(
                          draft.name,
                          draft.transcript,
                        );
                    })()
                  }
                >
                  <Trans comment="打开系统选择器建立录音候选">
                    选择参考 WAV
                  </Trans>
                </Button>
              </>
            )}
          </section>
          <section className="bg-muted/25 border-border flex min-w-0 flex-col gap-4 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
            <h2 className="font-medium">
              <Trans comment="尚未正式保存的声音">音色候选</Trans>
            </h2>
            {!studio.candidates.length && (
              <p className="text-muted-foreground text-sm">
                <Trans>
                  候选会保留在当前应用会话中，确认保存后才能加入音色库。
                </Trans>
              </p>
            )}
            {studio.candidates.map((candidate) => (
              <VoiceCandidate
                key={candidate.id}
                candidate={candidate}
                studio={studio}
              />
            ))}
            <StudioJobs studio={studio} />
          </section>
        </div>
      )}
    </PageShell>
  );
}
