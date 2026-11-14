import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useStudioOperations } from "@/hooks/use-studio-operations";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type { BindingTarget, DesignDraft } from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";
import { AUDITION_TEXT } from "@/lib/voice-audition";

const bytes = (text: string) => new TextEncoder().encode(text).length;
const schema = z.object({
  name: z
    .string()
    .refine((value) => !!value.trim() && bytes(value) <= 256, "name"),
  description: z.string(),
  text: z
    .string()
    .refine(
      (value) =>
        !!value.trim() && !value.includes("\0") && [...value].length <= 500,
      "text",
    ),
  engine: z.string(),
  device: z.string(),
});
type Draft = z.infer<typeof schema>;

export function CharacterDesignDialog({
  projectId,
  target,
  targetLabel,
  initial,
  studio,
  onClose,
}: {
  projectId: string;
  target: BindingTarget;
  targetLabel: string;
  initial: DesignDraft;
  studio: VoiceStudio;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const operations = useStudioOperations();
  const identity = `character-design:${projectId}:${JSON.stringify(target)}`;
  const [baseline] = useWorkspaceState<Draft>(
    projectId,
    `${identity}:baseline`,
    {
      name: targetLabel,
      description: initial.prompt,
      text: AUDITION_TEXT,
      engine: initial.engine ?? "",
      device: "",
    },
  );
  const [draft, setDraft] = useWorkspaceState<Draft>(
    projectId,
    identity,
    baseline,
  );
  const form = useForm<Draft>({
    defaultValues: draft,
    resolver: zodResolver(schema),
  });
  const values = form.watch();
  const engine = values.engine
    ? studio.engines.find((entry) => entry.id === values.engine)
    : (studio.engines.find(
        (entry) => entry.ready && entry.devices.length > 0,
      ) ?? studio.engines[0]);
  const device = values.device
    ? engine?.devices.find((entry) => entry === values.device)
    : engine?.devices[0];
  const update = (field: keyof Draft, value: string) => {
    form.setValue(field, value, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
    form.clearErrors(field);
    setDraft((old) => ({ ...old, [field]: value }));
    const current = form.getValues();
    operations.setDraftDirty(
      identity,
      (Object.keys(baseline) as Array<keyof Draft>).some(
        (key) => current[key] !== baseline[key],
      ),
    );
  };
  const blocked =
    !studio.desktop ||
    studio.pending ||
    studio.loading ||
    studio.loadError ||
    !engine?.ready ||
    !device;
  const submit = form.handleSubmit((input) => {
    if (blocked || !engine || !device) return;
    if (
      !input.description.trim() ||
      bytes(input.description) >
        Math.min(16384, engine.description_max_bytes) ||
      (engine.description_max_chars != null &&
        [...input.description].length > engine.description_max_chars) ||
      (engine.forbid_parentheses && /[()（）]/.test(input.description))
    ) {
      form.setError(
        "description",
        { message: "description" },
        { shouldFocus: true },
      );
      return;
    }
    if ([...input.text].length > engine.text_max_chars) {
      form.setError("text", { message: "text" }, { shouldFocus: true });
      return;
    }
    void studio.start(
      {
        kind: "design",
        engine: engine.id,
        device,
        name: input.name.trim(),
        description: input.description.trim(),
        text: input.text,
        seed: null,
      },
      { projectId, target },
    );
    onClose();
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent scrollable="standard">
        <DialogHeader>
          <DialogTitle>
            <Trans>为「{targetLabel}」设计音色</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>生成候选后需试听并确认入库（描述必填），再回到绑定。</Trans>
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col gap-3"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <FieldGroup className="min-h-0 overflow-y-auto">
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor={`${id}-name`}>
                <Trans>音色名称</Trans>
              </FieldLabel>
              <Input
                id={`${id}-name`}
                ref={form.register("name").ref}
                value={values.name}
                aria-invalid={!!form.formState.errors.name}
                aria-describedby={
                  form.formState.errors.name ? `${id}-name-error` : undefined
                }
                onChange={(event) => update("name", event.target.value)}
              />
              <FieldError id={`${id}-name-error`}>
                {form.formState.errors.name && (
                  <Trans>请输入名称，最多 256 字节。</Trans>
                )}
              </FieldError>
            </Field>
            <Field data-invalid={!!form.formState.errors.description}>
              <FieldLabel htmlFor={`${id}-description`}>
                <Trans>声音描述</Trans>
              </FieldLabel>
              <Textarea
                id={`${id}-description`}
                ref={form.register("description").ref}
                value={values.description}
                aria-invalid={!!form.formState.errors.description}
                aria-describedby={
                  [
                    engine && `${id}-description-help`,
                    form.formState.errors.description &&
                      `${id}-description-error`,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onChange={(event) => update("description", event.target.value)}
              />
              {engine && (
                <FieldDescription id={`${id}-description-help`}>
                  <Trans>
                    最多 {Math.min(16384, engine.description_max_bytes)} 字节。
                  </Trans>{" "}
                  {engine.description_max_chars != null && (
                    <Trans>最多 {engine.description_max_chars} 个字符。</Trans>
                  )}{" "}
                  {engine.forbid_parentheses && <Trans>不能包含括号。</Trans>}
                </FieldDescription>
              )}
              <FieldError id={`${id}-description-error`}>
                {form.formState.errors.description && (
                  <Trans>请输入符合引擎限制的声音描述。</Trans>
                )}
              </FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-engine`}>
                <Trans>设计引擎</Trans>
              </FieldLabel>
              <Controller
                control={form.control}
                name="engine"
                render={({ field }) => (
                  <NativeSelect
                    id={`${id}-engine`}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={engine?.id ?? ""}
                    onChange={(event) => {
                      update("engine", event.target.value);
                      update("device", "");
                    }}
                  >
                    {!engine && (
                      <option value="" disabled>
                        {values.engine ? t`已选引擎不可用` : t`暂无可用引擎`}
                      </option>
                    )}
                    {studio.engines.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                        {entry.ready ? "" : t`（未就绪）`}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-device`}>
                <Trans>计算设备</Trans>
              </FieldLabel>
              <Controller
                control={form.control}
                name="device"
                render={({ field }) => (
                  <NativeSelect
                    id={`${id}-device`}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={device ?? ""}
                    onChange={(event) => update("device", event.target.value)}
                  >
                    {!device && (
                      <option value="" disabled>
                        {values.device ? t`已选设备不可用` : t`暂无可用设备`}
                      </option>
                    )}
                    {engine?.devices.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </NativeSelect>
                )}
              />
            </Field>
            <Field data-invalid={!!form.formState.errors.text}>
              <FieldLabel htmlFor={`${id}-text`}>
                <Trans>试音文本</Trans>
              </FieldLabel>
              <Textarea
                id={`${id}-text`}
                ref={form.register("text").ref}
                value={values.text}
                aria-invalid={!!form.formState.errors.text}
                aria-describedby={
                  form.formState.errors.text ? `${id}-text-error` : undefined
                }
                onChange={(event) => update("text", event.target.value)}
              />
              <FieldError id={`${id}-text-error`}>
                {form.formState.errors.text && (
                  <Trans>请输入符合长度限制且不含空字符的朗读文本。</Trans>
                )}
              </FieldError>
            </Field>
          </FieldGroup>
          {studio.loadError ? (
            <div role="alert" className="text-destructive text-xs">
              <Trans>无法读取声音工作室状态</Trans>{" "}
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={studio.retryLoad}
              >
                <Trans>重试读取</Trans>
              </Button>
            </div>
          ) : !engine ? (
            <p role="status" className="text-muted-foreground text-xs">
              {values.engine ? (
                <Trans>已选引擎不可用，请重新选择或等待其恢复。</Trans>
              ) : (
                <Trans>暂无可用引擎，无法生成音色候选。</Trans>
              )}
            </p>
          ) : !engine.ready ? (
            <p role="status" className="text-muted-foreground text-xs">
              <Trans>请先准备所选引擎资源。</Trans>
            </p>
          ) : !device ? (
            <p role="status" className="text-muted-foreground text-xs">
              {values.device ? (
                <Trans>已选设备不可用，请重新选择或等待其恢复。</Trans>
              ) : (
                <Trans>此引擎没有可用设备。</Trans>
              )}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={blocked}>
              <Trans>生成音色候选</Trans>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                form.reset(baseline);
                setDraft(baseline);
                operations.setDraftDirty(identity, false);
              }}
            >
              <Trans>重置设计草稿</Trans>
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              <Trans>暂时关闭</Trans>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
