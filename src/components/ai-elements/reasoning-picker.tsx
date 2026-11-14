import { Trans, useLingui } from "@lingui/react/macro";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ReasoningSetting } from "@/lib/bindings";
import { useReasoningLabels } from "@/lib/reasoning";

const DEFAULT_CHOICE = "__default";

/**
 * 会话输入栏的思考强度选择：覆盖服务连接中该模型的默认档，仅展示该
 * 模型目录支持的档位；「跟随模型默认」不发送覆盖。
 */
export function ReasoningPicker({
  choices,
  value,
  onChange,
  label,
}: {
  choices: ReasoningSetting[];
  value: ReasoningSetting | null;
  onChange: (setting: ReasoningSetting | null) => void;
  label: string;
}) {
  const { t } = useLingui();
  const labels = useReasoningLabels();
  if (choices.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="picker"
            aria-label={label}
            title={label}
          />
        }
      >
        <BrainIcon className="size-3.5 opacity-70" />
        <span className="max-w-28 truncate text-xs">
          {value ? labels[value] : t`默认思考`}
        </span>
        <ChevronDownIcon className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={value ?? DEFAULT_CHOICE}
          onValueChange={(next) => {
            if (next === DEFAULT_CHOICE) onChange(null);
            else {
              const choice = choices.find((choice) => choice === next);
              if (choice) onChange(choice);
            }
          }}
        >
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuRadioItem value={DEFAULT_CHOICE} closeOnClick>
            <Trans>跟随模型默认</Trans>
          </DropdownMenuRadioItem>
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={choice} closeOnClick>
              {labels[choice]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
