import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
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
import { NativeSelect } from "@/components/ui/native-select";
import { NumberField, NumberFieldInput } from "@/components/ui/number-field";
import type { ChapterPauseEdit } from "@/lib/bindings";

const pauseSchema = z.object({
  seconds: z
    .string()
    .refine((value) => value.trim() !== "", "required")
    .refine(
      (value) =>
        value.trim() === "" ||
        (Number.isFinite(Number(value)) &&
          Number(value) >= 0 &&
          Number(value) <= 10),
      "range",
    )
    .refine(
      (value) =>
        value.trim() === "" ||
        !Number.isFinite(Number(value)) ||
        Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) < 1e-8,
      "step",
    ),
});

/** The same editor serves source markers and track boundaries. */
export function ChapterPauseEditor({
  afterIndex,
  seconds,
  savedDurationMs,
  boundaries,
  occupied,
  busy,
  onSeconds,
  onEdit,
  onSelect,
  onClose,
  exitGuard,
  dirtyGuard,
  canLeave,
  targetChanged = false,
}: {
  afterIndex: number;
  seconds: string;
  savedDurationMs: number;
  boundaries: number[];
  occupied: number[];
  busy: boolean;
  onSeconds: (value: string) => void;
  onEdit: (edit: ChapterPauseEdit) => Promise<boolean>;
  onSelect: (index: number) => void;
  onClose: () => void;
  exitGuard?: React.RefObject<(() => Promise<boolean>) | null>;
  dirtyGuard?: React.RefObject<(() => boolean) | null>;
  canLeave?: () => boolean;
  targetChanged?: boolean;
}) {
  const id = useId();
  const { t } = useLingui();
  const [failed, setFailed] = useState(false);
  const [touched, setTouched] = useState(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const acknowledged = useRef({
    boundary: afterIndex,
    prop: savedDurationMs,
    value: savedDurationMs,
  });
  if (
    acknowledged.current.boundary !== afterIndex ||
    acknowledged.current.prop !== savedDurationMs
  ) {
    acknowledged.current = {
      boundary: afterIndex,
      prop: savedDurationMs,
      value: savedDurationMs,
    };
  }
  const composing = useRef(false);
  const form = useForm({
    resolver: zodResolver(pauseSchema),
    values: { seconds },
    mode: "onChange",
  });
  const validation = pauseSchema.safeParse({ seconds });
  const validationError = validation.success
    ? null
    : validation.error.issues[0]?.message;
  useEffect(() => {
    if (
      pauseSchema.safeParse({ seconds }).success &&
      Math.round(Number(seconds) * 1000) === savedDurationMs
    ) {
      setFailed(false);
      setTouched(false);
    }
  }, [seconds, savedDurationMs]);
  function save(retry = false, focusInvalid = false): Promise<boolean> {
    if (inFlight.current) return inFlight.current;
    const raw = form.getValues("seconds");
    const parsed = pauseSchema.safeParse({ seconds: raw });
    const ms = Math.round(Number(raw) * 1000);
    if (!parsed.success || composing.current) {
      if (focusInvalid) form.setFocus("seconds");
      return Promise.resolve(false);
    }
    if (!touched) return Promise.resolve(canLeave ? canLeave() : !busy);
    if (ms === acknowledged.current.value) return Promise.resolve(true);
    if (busy) return Promise.resolve(false);
    if (failed && !retry) return Promise.resolve(false);
    const operation = (async () => {
      try {
        const saved = await onEdit({
          kind: "set",
          after_index: afterIndex,
          duration_ms: ms,
        });
        if (saved && acknowledged.current.boundary === afterIndex)
          acknowledged.current.value = ms;
        if (saved) setTouched(false);
        setFailed(!saved);
        return saved;
      } catch {
        setFailed(true);
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = operation;
    return operation;
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  const dirtyRef = useRef(false);
  dirtyRef.current =
    touched || failed || inFlight.current !== null || composing.current;
  useEffect(() => {
    const guard = () => saveRef.current(false, true);
    const dirty = () => dirtyRef.current;
    if (exitGuard) exitGuard.current = guard;
    if (dirtyGuard) dirtyGuard.current = dirty;
    return () => {
      if (exitGuard?.current === guard) exitGuard.current = null;
      if (dirtyGuard?.current === dirty) dirtyGuard.current = null;
    };
  }, [exitGuard, dirtyGuard]);
  return (
    <form
      className="flex flex-col items-start gap-3 text-sm"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(true, true);
      }}
    >
      {targetChanged && (
        <p role="status" className="text-muted-foreground text-xs">
          <Trans>音频版本已变化；此输入仍属于原音频版本。</Trans>
        </p>
      )}
      <Controller
        control={form.control}
        name="seconds"
        render={({ field }) => (
          <Field data-invalid={!!validationError}>
            <FieldLabel htmlFor={`${id}-seconds`}>
              <Trans>额外停顿（秒）</Trans>
            </FieldLabel>
            <NumberField
              id={`${id}-seconds`}
              min={0}
              max={10}
              step={0.01}
              required
              allowOutOfRange
              locale="en-US"
              format={{ maximumFractionDigits: 10 }}
              disabled={busy}
              value={
                seconds.trim() !== "" && Number.isFinite(Number(seconds))
                  ? Number(seconds)
                  : null
              }
              onValueChange={(value, details) => {
                if (
                  details.reason === "keyboard" ||
                  details.reason === "increment-press" ||
                  details.reason === "decrement-press"
                ) {
                  const next = value == null ? "" : String(value);
                  field.onChange(next);
                  onSeconds(next);
                  setTouched(true);
                  setFailed(false);
                }
              }}
            >
              <NumberFieldInput
                ref={field.ref}
                className="w-24"
                role="spinbutton"
                aria-roledescription={t`数字输入`}
                inputMode="decimal"
                aria-valuemin={0}
                aria-valuemax={10}
                aria-valuenow={
                  seconds.trim() !== "" && Number.isFinite(Number(seconds))
                    ? Number(seconds)
                    : undefined
                }
                aria-valuetext={
                  seconds.trim() === "" ? undefined : t`${seconds} 秒`
                }
                aria-invalid={!!validationError}
                aria-describedby={`${id}-hint${validationError ? ` ${id}-error` : ""}`}
                onChange={(event) => {
                  field.onChange(event.currentTarget.value);
                  onSeconds(event.currentTarget.value);
                  setTouched(true);
                  setFailed(false);
                }}
                onBlur={() => {
                  field.onBlur();
                  void save();
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    !composing.current
                  ) {
                    event.preventDefault();
                    void save(true, true);
                  }
                }}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                }}
              />
            </NumberField>
            <FieldDescription id={`${id}-hint`}>
              <Trans>范围 0–10 秒，步长 0.01 秒；失焦或按 Enter 保存。</Trans>
            </FieldDescription>
            {validationError && (
              <FieldError id={`${id}-error`}>
                {validationError === "required" ? (
                  <Trans>请输入停顿时长。</Trans>
                ) : validationError === "step" ? (
                  <Trans>停顿时长以 0.01 秒为步长。</Trans>
                ) : (
                  <Trans>请输入 0 到 10 秒之间的数值。</Trans>
                )}
              </FieldError>
            )}
          </Field>
        )}
      />
      {touched &&
        (validationError || Number(seconds) * 1000 !== savedDurationMs) && (
          <p className="text-muted-foreground text-xs">
            <Trans>输入尚未保存，当前为 {savedDurationMs / 1000} 秒</Trans>
          </p>
        )}
      {failed && (
        <Button size="sm" type="submit" variant="outline" disabled={busy}>
          <Trans>重试保存停顿</Trans>
        </Button>
      )}
      {busy && (
        <p role="status" className="text-muted-foreground text-xs">
          <Trans>正在保存…</Trans>
        </p>
      )}
      <label htmlFor={`${id}-boundary`}>
        <Trans>移动到片段之后</Trans>
      </label>
      <NativeSelect
        id={`${id}-boundary`}
        value={afterIndex}
        disabled={busy || targetChanged}
        onChange={(e) => {
          const to = Number(e.target.value);
          if (to !== afterIndex)
            void save(false, true)
              .then(
                (ready) =>
                  ready &&
                  onEdit({
                    kind: "move",
                    after_index: afterIndex,
                    to_index: to,
                  }),
              )
              .then((saved) => {
                if (saved) onSelect(to);
              });
        }}
      >
        {boundaries.map((index) => (
          <option
            key={index}
            value={index}
            disabled={index !== afterIndex && occupied.includes(index)}
          >
            {index + 1}
          </option>
        ))}
      </NativeSelect>
      <Button
        size="sm"
        type="button"
        variant="ghost"
        disabled={busy || targetChanged}
        onClick={() =>
          void onEdit({
            kind: "set",
            after_index: afterIndex,
            duration_ms: 0,
          }).then((saved) => {
            if (saved) onClose();
          })
        }
      >
        <Trans>删除停顿</Trans>
      </Button>
      {(validationError || failed || targetChanged) && !busy && (
        <Button
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => {
            form.reset({ seconds: String(savedDurationMs / 1000) });
            onSeconds(String(savedDurationMs / 1000));
            setTouched(false);
            onClose();
          }}
        >
          <Trans>放弃修改并关闭</Trans>
        </Button>
      )}
      <Button
        size="sm"
        type="button"
        variant="ghost"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() =>
          void save(false, true).then((saved) => {
            if (saved) onClose();
          })
        }
      >
        <Trans>关闭</Trans>
      </Button>
    </form>
  );
}
