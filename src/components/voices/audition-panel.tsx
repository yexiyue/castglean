import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useModelResources } from "@/hooks/use-model-resources";
import { useStudioOperations } from "@/hooks/use-studio-operations";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type { InferenceDevice, VoiceSelection } from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";
import { modelId } from "@/lib/models";
import { auditionIdentity } from "@/lib/studio-operations";

const schema = z.object({
  model: z.string(),
  device: z.string(),
  style: z.string(),
  text: z
    .string()
    .refine((text) => !!text.trim(), "required")
    .refine((text) => [...text].length <= 500, "length")
    .refine((text) => !text.includes("\0"), "nul"),
});
type Draft = z.infer<typeof schema>;
type Props = {
  studio: VoiceStudio;
  voice: VoiceSelection;
  fixedModel?: string;
};

export function AuditionPanel(props: Props) {
  const identity = auditionIdentity(props.voice, props.fixedModel);
  return <AuditionForm key={identity} {...props} identity={identity} />;
}

function AuditionForm({
  studio,
  voice,
  fixedModel,
  identity,
}: Props & { identity: string }) {
  const formId = useId();
  const { t } = useLingui();
  const operations = useStudioOperations();
  const pendingOperation = operations.entries.get(identity);
  const busy =
    studio.pending ||
    !!pendingOperation ||
    (voice.kind === "candidate" && operations.candidates.has(voice.id));
  const seen = useRef(operations.completion);
  useEffect(() => {
    if (seen.current !== operations.completion) {
      seen.current = operations.completion;
      void studio.refresh().catch(() => {});
    }
  }, [operations.completion, studio.refresh]);
  const resources = useModelResources();
  const models = resources.entries.filter((model) =>
    fixedModel
      ? modelId(model) === fixedModel
      : model.capabilities.reference_cloning,
  );
  const [baseline] = useWorkspaceState<Draft>(
    "voices",
    `auditionBaseline:${identity}`,
    {
      model: "",
      device: "",
      style: "",
      text: t({
        message: "你好，欢迎收听今天的故事。山风吹过松林，星光照亮归途。",
      }),
    },
  );
  const [draft, setDraft] = useWorkspaceState<Draft>(
    "voices",
    `audition:${identity}`,
    baseline,
  );
  const form = useForm<Draft>({
    resolver: zodResolver(schema),
    defaultValues: draft,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const values = form.watch();
  const model = values.model
    ? models.find((entry) => modelId(entry) === values.model)
    : models[0];
  const device = values.device
    ? model?.available_devices.find((entry) => entry === values.device)
    : model?.available_devices[0];
  const blocked =
    !studio.desktop ||
    busy ||
    resources.loading ||
    !!resources.error ||
    !model ||
    model.resource !== "Ready" ||
    !device;
  const count = [...values.text].length;
  const textError = form.formState.errors.text?.message;
  function update(key: keyof Draft, value: string) {
    form.setValue(key, value, {
      shouldDirty: true,
      shouldValidate: key === "text" && form.formState.isSubmitted,
    });
    const next = form.getValues();
    operations.setDraftDirty(
      identity,
      (Object.keys(baseline) as Array<keyof Draft>).some(
        (field) => next[field] !== baseline[field],
      ),
    );
    setDraft((previous) => ({ ...previous, [key]: value }));
  }
  const submit = form.handleSubmit((input) => {
    if (blocked || !model || !device) return;
    if (
      model.capabilities.style &&
      new TextEncoder().encode(input.style).length > 4096
    ) {
      form.setError("style", { message: "length" }, { shouldFocus: true });
      return;
    }
    void operations.start(identity, {
      kind: "audition",
      backend: model.backend,
      model: model.model,
      device: device as InferenceDevice,
      voice,
      text: input.text,
      style:
        model.capabilities.style && input.style.trim() ? input.style : null,
    });
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <h3 className="text-sm font-medium">
        <Trans comment="用所选模型合成新文字，与原始参考区分">模型试听</Trans>
      </h3>
      {pendingOperation && (
        <p role="status" className="text-muted-foreground text-xs">
          <Trans>试听请求待确认，关闭此面板后可在页面顶部恢复。</Trans>
        </p>
      )}
      <p className="text-muted-foreground text-xs leading-5">
        <Trans>用新文本生成试听，结果显示在下方任务中。</Trans>
      </p>
      <FieldGroup layout="responsive-pair">
        <Field>
          <FieldLabel htmlFor={`${formId}-model`}>
            <Trans>模型</Trans>
          </FieldLabel>
          <Controller
            control={form.control}
            name="model"
            render={({ field }) => (
              <NativeSelect
                id={`${formId}-model`}
                className="w-full"
                disabled={
                  resources.loading ||
                  !!resources.error ||
                  !models.length ||
                  busy
                }
                value={model ? modelId(model) : ""}
                onBlur={field.onBlur}
                ref={field.ref}
                onChange={(event) => {
                  update("model", event.target.value);
                  update("device", "");
                  form.clearErrors("style");
                }}
              >
                <option value="" disabled>
                  {values.model ? t`已选模型不可用` : t`请选择模型`}
                </option>
                {models.map((entry) => (
                  <option key={modelId(entry)} value={modelId(entry)}>
                    {entry.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${formId}-device`}>
            <Trans>计算设备</Trans>
          </FieldLabel>
          <Controller
            control={form.control}
            name="device"
            render={({ field }) => (
              <NativeSelect
                id={`${formId}-device`}
                className="w-full"
                disabled={
                  !model?.available_devices.length ||
                  busy ||
                  resources.loading ||
                  !!resources.error
                }
                value={device ?? ""}
                onBlur={field.onBlur}
                ref={field.ref}
                onChange={(event) => update("device", event.target.value)}
              >
                {!device && (
                  <option value="" disabled>
                    {values.device ? t`已选设备不可用` : t`暂无可用设备`}
                  </option>
                )}
                {model?.available_devices.map((entry) => (
                  <option key={entry}>{entry}</option>
                ))}
              </NativeSelect>
            )}
          />
        </Field>
      </FieldGroup>
      <Field data-invalid={!!textError}>
        <FieldLabel htmlFor={`${formId}-text`}>
          <Trans>试听文本</Trans>
        </FieldLabel>
        <Controller
          control={form.control}
          name="text"
          render={({ field }) => (
            <Textarea
              {...field}
              id={`${formId}-text`}
              disabled={busy}
              aria-invalid={!!textError}
              aria-describedby={`${formId}-count${textError ? ` ${formId}-text-error` : ""}`}
              onChange={(event) => update("text", event.target.value)}
            />
          )}
        />
        <FieldDescription id={`${formId}-count`}>
          <Trans>{count} / 500 字符</Trans>
        </FieldDescription>
        {textError && (
          <FieldError id={`${formId}-text-error`}>
            {textError === "required" ? (
              <Trans>请填写试听文本。</Trans>
            ) : textError === "nul" ? (
              <Trans>试听文本不能包含空字符。</Trans>
            ) : (
              <Trans>试听文本不能超过 500 字符。</Trans>
            )}
          </FieldError>
        )}
      </Field>
      {model?.capabilities.style && (
        <Field data-invalid={!!form.formState.errors.style}>
          <FieldLabel htmlFor={`${formId}-style`}>
            <Trans>风格指令</Trans>
          </FieldLabel>
          <Controller
            control={form.control}
            name="style"
            render={({ field }) => (
              <Textarea
                {...field}
                id={`${formId}-style`}
                disabled={busy}
                aria-invalid={!!form.formState.errors.style}
                aria-describedby={
                  form.formState.errors.style
                    ? `${formId}-style-error`
                    : undefined
                }
                onChange={(event) => {
                  update("style", event.target.value);
                  if (
                    new TextEncoder().encode(event.target.value).length <= 4096
                  )
                    form.clearErrors("style");
                  else if (form.formState.isSubmitted)
                    form.setError("style", { message: "length" });
                }}
              />
            )}
          />
          {form.formState.errors.style && (
            <FieldError id={`${formId}-style-error`}>
              <Trans>风格指令不能超过 4096 字节。</Trans>
            </FieldError>
          )}
        </Field>
      )}
      {voice.kind !== "preset" && (
        <p className="text-muted-foreground text-xs">
          <Trans>参考录音是否兼容，以所选模型实际校验和生成结果为准。</Trans>
        </p>
      )}
      {!studio.desktop && (
        <p className="text-muted-foreground text-xs">
          <Trans>浏览器预览不读取本机模型，请在桌面应用中生成试听。</Trans>
        </p>
      )}
      {resources.loading && (
        <p role="status" className="text-muted-foreground text-xs">
          <Trans>正在读取模型目录…</Trans>
        </p>
      )}
      {resources.error && (
        <div role="alert" className="text-destructive text-xs">
          <Trans>模型目录读取失败。</Trans>{" "}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => void resources.refresh()}
          >
            <Trans>重试读取模型</Trans>
          </Button>
        </div>
      )}
      {!resources.loading && !resources.error && !model && (
        <p role="status" className="text-muted-foreground text-xs">
          {values.model && models.length > 0 ? (
            <Trans>已选模型不可用，请重新选择。</Trans>
          ) : (
            <Trans>没有可用的试听模型，请选择或准备模型。</Trans>
          )}
        </p>
      )}
      {model && model.resource !== "Ready" && (
        <Link
          to="/models"
          search={{ model: modelId(model) }}
          className={buttonVariants({ variant: "outline" })}
        >
          <Trans>前往准备模型资源</Trans>
        </Link>
      )}
      {model?.resource === "Ready" && !device && (
        <p role="status" className="text-muted-foreground text-xs">
          {values.device && model.available_devices.length > 0 ? (
            <Trans>已选设备不可用，请重新选择。</Trans>
          ) : (
            <Trans>所选模型没有可用的试听设备。</Trans>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={blocked}>
          <Trans comment="用当前声音和模型生成新试听">生成试听</Trans>
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            form.reset(baseline);
            setDraft(baseline);
            operations.setDraftDirty(identity, false);
          }}
        >
          <Trans>重置试听配置</Trans>
        </Button>
      </div>
    </form>
  );
}
