import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDownIcon, SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
 * 打勾、键盘可导航），底部直达服务连接设置。参考 shadcn Model Selector
 * （DropdownMenu 方案）与 ChatGPT/Codex 的模型 pill 模式。
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
  onOpenSettings?: () => void;
}) {
  const { t } = useLingui();
  const selected = models.find((model) => model.key === value);
  const groups: { connection: string; models: ModelPickerOption[] }[] = [];
  for (const model of models) {
    const group = groups.find((entry) => entry.connection === model.connection);
    if (group) group.models.push(model);
    else groups.push({ connection: model.connection, models: [model] });
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="picker"
            disabled={disabled}
            aria-label={label}
            title={selected?.name ?? label}
          />
        }
      >
        <span className="max-w-36 truncate text-xs">
          {selected ? selected.short : t`选择模型`}
        </span>
        <ChevronDownIcon className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="max-h-72 w-60 overflow-y-auto"
      >
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
                    closeOnClick
                  >
                    <span className="max-w-full truncate">{model.short}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            <Trans>无可用模型，先在服务连接中配置。</Trans>
          </p>
        )}
        {onOpenSettings ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenSettings}>
              <SettingsIcon />
              <Trans>服务连接</Trans>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
