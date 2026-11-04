import { useLingui } from "@lingui/react/macro";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { previewModels } from "@/lib/preview-models";

export function ModelSelect({
  value,
  onChange,
  id,
  allowAll = false,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  allowAll?: boolean;
}) {
  const { t } = useLingui();
  const items = [
    ...(allowAll
      ? [
          {
            value: "all",
            label: t({
              comment: "不限制音色所属模型的筛选项",
              message: "全部模型",
            }),
          },
        ]
      : []),
    ...previewModels.map((model) => ({
      value: model.id,
      label: t(model.name),
    })),
  ];
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
    >
      <SelectTrigger
        id={id}
        className="w-full min-w-0 sm:w-56"
        aria-label={t({
          comment: "选择音色相关的示例模型，不修改任何工程",
          message: "选择模型",
        })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
