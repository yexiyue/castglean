// Adapted from assistant-ui registry: elements-thread-list.
import { Trans, useLingui } from "@lingui/react/macro";
import { CheckIcon } from "lucide-react";
import type { Ref } from "react";
import { AppState } from "@/components/app-state";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

type ThreadItem = { id: string; title: string };

export function ThreadList({
  threads,
  activeId,
  inputRef,
  onSelect,
}: {
  threads: readonly ThreadItem[];
  activeId: string;
  inputRef: Ref<HTMLInputElement>;
  onSelect: (id: string) => void;
}) {
  const { t } = useLingui();
  const searchLabel = t`搜索会话`;
  return (
    <Combobox<ThreadItem>
      inline
      open
      autoHighlight
      items={threads}
      itemToStringLabel={(thread) => thread.title}
      itemToStringValue={(thread) => thread.id}
      onValueChange={(thread) => {
        if (thread) onSelect(thread.id);
      }}
    >
      <ComboboxInput
        ref={inputRef}
        aria-label={searchLabel}
        placeholder={searchLabel}
        showTrigger={false}
      />
      <ComboboxEmpty className="[&:not(:empty)]:flex">
        <AppState
          kind="search"
          compact
          className="min-h-32"
          title={<Trans>未找到会话</Trans>}
        />
      </ComboboxEmpty>
      <ComboboxList
        data-slot="thread-list"
        aria-label={t`会话`}
        className="max-h-64 shrink overflow-y-auto"
      >
        {(thread) => (
          <ComboboxItem
            key={thread.id}
            value={thread}
            aria-current={thread.id === activeId || undefined}
            className="min-h-8 aria-current:bg-muted"
          >
            <span className="min-w-0 flex-1 truncate" title={thread.title}>
              {thread.title}
            </span>
            {thread.id === activeId && (
              <CheckIcon aria-hidden className="size-3.5 shrink-0" />
            )}
          </ComboboxItem>
        )}
      </ComboboxList>
    </Combobox>
  );
}
