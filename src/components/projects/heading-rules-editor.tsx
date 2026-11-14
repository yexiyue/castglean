import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { HeadingRule } from "@/lib/bindings";

const rulesSchema = z.object({
  rules: z
    .array(
      z.object({
        name: z.string().refine((value) => [...value].length <= 120),
        kind: z.enum(["chapter", "volume", "exclude"]),
        pattern: z
          .string()
          .refine((value) => new TextEncoder().encode(value).length <= 4096),
      }),
    )
    .max(32),
});

export function HeadingRulesEditor({
  initialRules,
  disabled,
  onApply,
  onDraftChange,
  onDiscard,
}: {
  initialRules: HeadingRule[];
  disabled: boolean;
  onApply: (rules: HeadingRule[]) => void;
  onDraftChange?: (rules: HeadingRule[]) => void;
  onDiscard?: () => void;
}) {
  const { t } = useLingui();
  const form = useForm({
    resolver: zodResolver(rulesSchema),
    defaultValues: { rules: initialRules },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "rules",
  });
  useEffect(() => {
    const subscription = form.watch(() =>
      onDraftChange?.(form.getValues("rules")),
    );
    return () => subscription.unsubscribe();
  }, [form, onDraftChange]);
  return (
    <form
      className="space-y-3 border-t pt-3"
      onSubmit={form.handleSubmit(({ rules }) => onApply(rules))}
    >
      <p className="text-muted-foreground text-xs">
        <Trans>
          逐行匹配；支持章节、卷与排除规则。不支持前后向断言和反向引用。
        </Trans>
      </p>
      {fields.map((rule, index) => (
        <fieldset
          key={rule.id}
          className="grid gap-2 sm:grid-cols-[140px_110px_minmax(0,1fr)_auto]"
        >
          <legend className="sr-only">
            <Trans>规则 {index + 1}</Trans>
          </legend>
          <Input
            aria-label={t`规则名称`}
            aria-invalid={!!form.formState.errors.rules?.[index]?.name}
            disabled={disabled}
            {...form.register(`rules.${index}.name`)}
          />
          <NativeSelect
            aria-label={t`规则类型`}
            disabled={disabled}
            {...form.register(`rules.${index}.kind`)}
          >
            <option value="chapter">{t`章节`}</option>
            <option value="volume">{t`卷`}</option>
            <option value="exclude">{t`排除`}</option>
          </NativeSelect>
          <Input
            aria-label={t`正则表达式`}
            aria-invalid={!!form.formState.errors.rules?.[index]?.pattern}
            disabled={disabled}
            {...form.register(`rules.${index}.pattern`)}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            aria-label={t`移除规则 ${index + 1}`}
            onClick={() => remove(index)}
          >
            <Trans comment="删除一条分章规则">移除</Trans>
          </Button>
        </fieldset>
      ))}
      {Object.keys(form.formState.errors).length > 0 && (
        <p role="alert" className="text-destructive text-xs">
          <Trans>
            规则最多 32 条，名称最多 120 个字符，表达式最多 4096 字节。
          </Trans>
        </p>
      )}
      <div className="flex gap-2">
        {onDiscard && (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={onDiscard}
          >
            <Trans>放弃修改</Trans>
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            append({ name: t`自定义规则`, kind: "chapter", pattern: "^第.+章" })
          }
        >
          <Trans>添加规则</Trans>
        </Button>
        <Button type="submit" disabled={disabled}>
          <Trans>应用规则并检查目录</Trans>
        </Button>
      </div>
    </form>
  );
}
