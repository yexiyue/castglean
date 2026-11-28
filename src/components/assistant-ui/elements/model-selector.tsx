// Adapted from assistant-ui registry: elements-model-selector.
// Base UI Combobox provides the searchable popup and keyboard interaction.
import { Trans, useLingui } from "@lingui/react/macro";
import { SettingsIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";

type ModelOption = {
  key: string;
  short: string;
  name: string;
  connection: string;
};

type ModelGroup = { connection: string; items: ModelOption[] };

export function ModelSelector({
  models,
  value,
  onValueChange,
  label,
  onOpenSettings,
}: {
  models: ModelOption[];
  value: string;
  onValueChange: (key: string) => void;
  label: string;
  onOpenSettings: (returnFocusTo?: HTMLElement) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = models.find((model) => model.key === value);
  const byConnection = new Map<string, ModelOption[]>();
  for (const model of models) {
    const group = byConnection.get(model.connection);
    if (group) group.push(model);
    else byConnection.set(model.connection, [model]);
  }
  const groups = Array.from(byConnection, ([connection, items]) => ({
    connection,
    items,
  }));
  const searchLabel = t`搜索模型`;

  return (
    <Combobox
      items={groups}
      value={selected ?? null}
      open={open}
      onOpenChange={setOpen}
      itemToStringLabel={(model) => model.short}
      itemToStringValue={(model) => model.key}
      isItemEqualToValue={(model, current) => model.key === current.key}
      filter={(model: ModelOption, query) =>
        model.name
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())
      }
      onValueChange={(model) => {
        if (model) onValueChange(model.key);
      }}
    >
      <ComboboxTrigger
        ref={trigger}
        render={<Button size="sm" variant="ghost" />}
        data-slot="model-selector-trigger"
        className="min-w-0 gap-1 px-2 text-xs font-normal text-muted-foreground"
        aria-label={label}
        title={selected?.name ?? label}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="max-w-36 truncate">
          {selected?.short ?? t`选择模型`}
        </span>
      </ComboboxTrigger>

      <ComboboxContent side="top" aria-label={label} className="w-64 min-w-0">
        {models.length > 0 ? (
          <>
            <ComboboxInput
              showTrigger={false}
              aria-label={searchLabel}
              placeholder={searchLabel}
            />
            <ComboboxEmpty className="px-2">
              <Trans>没有匹配的模型</Trans>
            </ComboboxEmpty>
            <ComboboxList>
              {(group: ModelGroup) => (
                <ComboboxGroup key={group.connection} items={group.items}>
                  <ComboboxLabel>{group.connection}</ComboboxLabel>
                  <ComboboxCollection>
                    {(model: ModelOption) => (
                      <ComboboxItem
                        key={model.key}
                        value={model}
                        title={model.name}
                      >
                        <span className="min-w-0 truncate">{model.short}</span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </>
        ) : (
          <p className="p-2 text-xs text-muted-foreground">
            <Trans>无可用模型，先在服务连接中配置。</Trans>
          </p>
        )}
        <div className="border-t p-1">
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              onOpenSettings(trigger.current ?? undefined);
            }}
          >
            <SettingsIcon aria-hidden />
            <Trans>服务连接</Trans>
          </Button>
        </div>
      </ComboboxContent>
    </Combobox>
  );
}
