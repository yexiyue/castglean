import { Trans, useLingui } from "@lingui/react/macro";
import { SettingsIcon } from "lucide-react";
import { useRef } from "react";
import { ComposerModelTrigger } from "@/components/assistant-ui/elements/composer-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export type ModelPickerOption = {
  key: string;
  /** 展示用短名（模型名）；完整名「连接 / 模型」用于 title。 */
  short: string;
  name: string;
  /** 所属服务连接名，作为分组标题。 */
  connection: string;
};

/**
 * 会话输入栏的模型选择器：胶囊触发器 + 按服务连接分组的下拉（当前项
 * 打勾、键盘可导航），底部直达服务连接设置。
 */
export function ModelPicker({
  models,
  value,
  onValueChange,
  label,
  disabled,
  onOpenSettings,
}: {
  models: ModelPickerOption[];
  value: string;
  onValueChange: (key: string) => void;
  label: string;
  disabled?: boolean;
  onOpenSettings?: (returnFocusTo?: HTMLElement) => void;
}) {
  const { t } = useLingui();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = models.find((model) => model.key === value);
  const groups: { connection: string; models: ModelPickerOption[] }[] = [];
  for (const model of models) {
    const group = groups.find((entry) => entry.connection === model.connection);
    if (group) group.models.push(model);
    else groups.push({ connection: model.connection, models: [model] });
  }
  return (
    <DropdownMenu>
      <ComposerModelTrigger
        triggerRef={triggerRef}
        disabled={disabled}
        label={label}
        title={selected?.name ?? label}
        model={selected?.short ?? t`选择模型`}
      />
      <DropdownMenuContent side="top" align="start" className="w-60">
        {models.length ? (
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => onValueChange(String(next))}
          >
            {groups.map((group) => (
              <DropdownMenuGroup key={group.connection}>
                <DropdownMenuLabel>{group.connection}</DropdownMenuLabel>
                {group.models.map((model) => (
                  <DropdownMenuRadioItem
                    key={model.key}
                    value={model.key}
                    title={model.name}
                    closeOnClick
                  >
                    <span className="max-w-full truncate">{model.short}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <p className="p-2 text-xs text-muted-foreground">
            <Trans>无可用模型，先在服务连接中配置。</Trans>
          </p>
        )}
        {onOpenSettings ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onOpenSettings?.(triggerRef.current ?? undefined)}
            >
              <SettingsIcon />
              <Trans>服务连接</Trans>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
