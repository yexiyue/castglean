import { zodResolver } from "@hookform/resolvers/zod";
import { Trans } from "@lingui/react/macro";
import { useEffect, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { commands } from "@/lib/bindings";

const voiceNameSchema = z.object({
  name: z.string().refine((value) => !!value.trim()),
});
const voiceDescriptionSchema = z.object({ description: z.string() });

export type LibraryVoiceFeedback =
  | "saving"
  | "deleting"
  | "saved"
  | "cancelled"
  | "save-error"
  | "delete-error";

export function LibraryVoiceEditor({
  name,
  savedName,
  busy = false,
  feedback = null,
  onNameChange,
  onSave,
  onReset,
  onDelete,
}: {
  name: string;
  savedName: string;
  busy?: boolean;
  feedback?: LibraryVoiceFeedback | null;
  onNameChange?: (name: string) => void;
  onSave?: () => void;
  onReset?: () => void;
  onDelete?: () => void;
}) {
  const formId = useId();
  const form = useForm({
    resolver: zodResolver(voiceNameSchema),
    values: { name },
    mode: "onChange",
  });
  const dirty = name.trim() !== savedName;
  const failed = feedback?.endsWith("-error");
  const valid = voiceNameSchema.safeParse({ name }).success;
  return (
    <div className="space-y-5">
      <form
        className="space-y-3"
        onSubmit={form.handleSubmit(() => {
          if (!busy && dirty) onSave?.();
        })}
      >
        <Controller
          control={form.control}
          name="name"
          render={({ field }) => (
            <Field data-invalid={!valid}>
              <FieldLabel htmlFor={formId}>
                <Trans comment="编辑库内音色显示名称">音色名称</Trans>
              </FieldLabel>
              <Input
                {...field}
                id={formId}
                disabled={busy || !onNameChange}
                aria-invalid={!valid}
                aria-describedby={`${formId}-description${!valid ? ` ${formId}-validation` : ""}`}
                onChange={(event) => {
                  field.onChange(event);
                  onNameChange?.(event.target.value);
                }}
              />
              <FieldDescription id={`${formId}-description`}>
                <Trans>只修改显示名称，音色身份和原始录音保持不变。</Trans>
              </FieldDescription>
              {!valid && (
                <FieldError id={`${formId}-validation`}>
                  <Trans>请输入音色名称。</Trans>
                </FieldError>
              )}
            </Field>
          )}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={busy || !valid || !dirty || !onSave}
          >
            {feedback === "saving" ? (
              <Trans>正在保存名称…</Trans>
            ) : feedback === "save-error" ? (
              <Trans comment="重试保存音色的新名称">重试保存</Trans>
            ) : (
              <Trans comment="持久保存已有音色的新名称">保存名称</Trans>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || !dirty || !onReset}
            onClick={onReset}
          >
            <Trans comment="放弃尚未保存的音色名称修改">撤销修改</Trans>
          </Button>
        </div>
      </form>
      {feedback && (
        <p
          role={failed ? "alert" : "status"}
          className={
            failed
              ? "text-destructive text-sm leading-6"
              : "text-muted-foreground text-sm leading-6"
          }
        >
          {feedback === "saving" && <Trans>正在保存名称…</Trans>}
          {feedback === "saved" && <Trans>名称已保存。</Trans>}
          {feedback === "save-error" && (
            <Trans>
              名称未保存，输入已保留。请检查存储位置是否可写后重试。
            </Trans>
          )}
          {feedback === "deleting" && <Trans>等待系统确认或删除完成…</Trans>}
          {feedback === "cancelled" && (
            <Trans>已取消删除，音色仍保留在库中。</Trans>
          )}
          {feedback === "delete-error" && (
            <Trans>
              删除未完成。请等待试听、生成或导入导出任务结束后重试，并检查存储权限。
            </Trans>
          )}
        </p>
      )}
      <div className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium">
          <Trans comment="库内音色的永久删除操作">删除音色</Trans>
        </h3>
        <p className="text-muted-foreground text-sm leading-6">
          <Trans>
            删除会移除音色库中的原始录音，无法撤销。系统会再次要求确认。
          </Trans>
        </p>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy || !onDelete}
          onClick={onDelete}
        >
          {feedback === "deleting" ? (
            <Trans comment="等待系统确认或音色删除结束">正在处理删除…</Trans>
          ) : feedback === "delete-error" ? (
            <Trans comment="重新尝试删除库内音色">重试删除</Trans>
          ) : (
            <Trans comment="打开系统确认后永久删除库内音色">删除音色…</Trans>
          )}
        </Button>
      </div>
    </div>
  );
}

/// 描述编辑：直接调用宿主 describe 命令，身份与引用关系保持不变。
export function LibraryVoiceDescriptionEditor({
  voiceId,
  saved,
  busy = false,
  draft,
  onDraftChange,
  onSaved,
  perform,
  onUnknown,
}: {
  voiceId: string;
  saved: string | null;
  busy?: boolean;
  draft?: string;
  onDraftChange?: (value: string | null, expected?: string) => void;
  onSaved?: () => void | Promise<void>;
  perform?: (action: () => Promise<void>) => Promise<void>;
  onUnknown?: (
    draft: string,
    value: string | null,
    operationId: string,
    phase: "write" | "read",
  ) => void;
}) {
  const formId = useId();
  const form = useForm({
    resolver: zodResolver(voiceDescriptionSchema),
    defaultValues: { description: saved ?? "" },
  });
  const lastSnapshot = useRef(saved);
  const saving = useRef(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const dirty = form.formState.isDirty;
  const { reset } = form;
  const initialDraft = useRef(draft);
  useEffect(() => {
    if (initialDraft.current !== undefined)
      form.setValue("description", initialDraft.current, { shouldDirty: true });
  }, [form.setValue]);
  useEffect(() => {
    if (lastSnapshot.current === saved) return;
    lastSnapshot.current = saved;
    if (
      state !== "saving" &&
      (!dirty || form.getValues("description").trim() === (saved ?? ""))
    )
      reset({ description: saved ?? "" });
  }, [dirty, form.getValues, reset, saved, state]);
  return (
    <form
      className="space-y-3 border-t pt-4"
      onSubmit={form.handleSubmit(async ({ description }) => {
        if (busy || !dirty || saving.current) return;
        saving.current = true;
        setState("saving");
        const submitted = description.trim();
        const operationId = crypto.randomUUID();
        let confirmed = false;
        try {
          const write = async () => {
            await commands.describeLibraryVoice(
              voiceId,
              submitted || null,
              operationId,
            );
          };
          if (perform) await perform(write);
          else await write();
          confirmed = true;
          onDraftChange?.(null, description);
          reset({ description: submitted });
          setState("saved");
          await onSaved?.();
        } catch {
          if (onUnknown) {
            onUnknown(
              description,
              submitted || null,
              operationId,
              confirmed ? "read" : "write",
            );
            setState("idle");
          } else setState("error");
        } finally {
          saving.current = false;
        }
      })}
    >
      <Field>
        <FieldLabel htmlFor={formId}>
          <Trans comment="编辑库内音色的描述">声音描述</Trans>
        </FieldLabel>
        <Textarea
          {...form.register("description", {
            onChange: (event) => {
              setState("idle");
              const value = event.target.value;
              onDraftChange?.(
                value === form.formState.defaultValues?.description
                  ? null
                  : value,
              );
            },
          })}
          id={formId}
          className="min-h-20"
          aria-describedby={`${formId}-description`}
          disabled={busy || state === "saving"}
        />
        <FieldDescription id={`${formId}-description`}>
          <Trans>
            描述供选角建议匹配使用，修改不改音色身份与引用它的绑定。
          </Trans>
        </FieldDescription>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={busy || !dirty || state === "saving"}
        >
          {state === "saving" ? (
            <Trans>正在保存描述…</Trans>
          ) : state === "error" ? (
            <Trans>重试保存描述</Trans>
          ) : (
            <Trans>保存描述</Trans>
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || !dirty || state === "saving"}
          onClick={() => {
            reset();
            onDraftChange?.(null);
            setState("idle");
          }}
        >
          <Trans>撤销修改</Trans>
        </Button>
      </div>
      {state === "saved" ? (
        <p role="status" className="text-muted-foreground text-sm">
          <Trans>描述已保存。</Trans>
        </p>
      ) : null}
      {state === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          <Trans>描述未保存，请检查存储位置后重试。</Trans>
        </p>
      ) : null}
    </form>
  );
}
