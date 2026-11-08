import { NativeSelect } from "@/components/ui/native-select";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HeadingRule } from "@/lib/bindings";

export function HeadingRulesEditor({
  initialRules,
  disabled,
  onApply,
}: {
  initialRules: HeadingRule[];
  disabled: boolean;
  onApply: (rules: HeadingRule[]) => void;
}) {
  const { t } = useLingui();
  const [rules, setRules] = useState(() =>
    initialRules.map((rule) => ({ ...rule, rowId: crypto.randomUUID() })),
  );
  return (
    <section className="space-y-3 border-t pt-3">
      <p className="text-muted-foreground text-xs">
        <Trans>
          逐行匹配；支持章节、卷与排除规则。不支持前后向断言和反向引用。
        </Trans>
      </p>
      {rules.map((rule, index) => (
        <div
          key={rule.rowId}
          className="grid gap-2 sm:grid-cols-[140px_110px_minmax(0,1fr)_auto]"
        >
          <Input
            aria-label={t`规则名称`}
            value={rule.name}
            onChange={(e) =>
              setRules((items) =>
                items.map((r, i) =>
                  i === index ? { ...r, name: e.target.value } : r,
                ),
              )
            }
          />
          <NativeSelect
            aria-label={t`规则类型`}
            value={rule.kind}
            onChange={(e) =>
              setRules((items) =>
                items.map((r, i) =>
                  i === index
                    ? {
                        ...r,
                        kind: e.target.value as HeadingRule["kind"],
                      }
                    : r,
                ),
              )
            }
          >
            <option value="chapter">{t`章节`}</option>
            <option value="volume">{t`卷`}</option>
            <option value="exclude">{t`排除`}</option>
          </NativeSelect>
          <Input
            aria-label={t`正则表达式`}
            value={rule.pattern}
            onChange={(e) =>
              setRules((items) =>
                items.map((r, i) =>
                  i === index ? { ...r, pattern: e.target.value } : r,
                ),
              )
            }
          />
          <Button
            variant="ghost"
            onClick={() =>
              setRules((items) => items.filter((_, i) => i !== index))
            }
          >
            <Trans comment="删除一条分章规则">移除</Trans>
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() =>
            setRules((items) => [
              ...items,
              {
                rowId: crypto.randomUUID(),
                name: t`自定义规则`,
                kind: "chapter",
                pattern: "^第.+章",
              },
            ])
          }
        >
          <Trans>添加规则</Trans>
        </Button>
        <Button
          disabled={disabled}
          onClick={() =>
            onApply(
              rules.map(({ name, kind, pattern }) => ({ name, kind, pattern })),
            )
          }
        >
          <Trans>应用规则并检查目录</Trans>
        </Button>
      </div>
    </section>
  );
}
