import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronRightIcon, PlayIcon } from "lucide-react";
import type { ListView } from "@/components/list-view-toggle";
import { Button } from "@/components/ui/button";
import { formatVoiceDuration, formatVoiceSize } from "@/lib/voices";

export type VoiceListItem = {
  id: string;
  name: string;
  description?: string | null;
  source?: string | null;
  duration?: number | null;
  bytes?: number | null;
};

/**
 * 音色列表：表格视图整行可点、卡片视图为紧凑网格。
 * 批量选择（我的音色导出）只在有 onSelect 时出现，两种视图都保留。
 */
export function VoiceLibraryRows({
  items,
  preset = false,
  view = "table",
  selected,
  onSelect,
  onOpen,
}: {
  items: VoiceListItem[];
  preset?: boolean;
  view?: ListView;
  selected?: Set<string>;
  onSelect?: (id: string, checked: boolean) => void;
  onOpen?: (id: string) => void;
}) {
  const { t, i18n } = useLingui();
  if (!items.length) return null;

  const openLabel = (name: string) =>
    preset
      ? t({
          message: `试听音色「${name}」`,
          comment: "打开指定预置音色的模型试听面板",
        })
      : t({
          message: `查看音色「${name}」`,
          comment: "打开指定库内音色的详情面板",
        });

  const SelectBox = ({ id, name }: { id: string; name: string }) =>
    selected ? (
      <input
        type="checkbox"
        className="mt-0.5 shrink-0"
        checked={selected.has(id)}
        disabled={!onSelect}
        aria-label={t({
          message: `选择音色「${name}」`,
          comment: "音色列表的批量导出选择框，包含音色名",
        })}
        onChange={(event) => onSelect?.(id, event.target.checked)}
      />
    ) : null;

  const meta = (item: VoiceListItem) =>
    !preset && (item.duration != null || item.bytes != null)
      ? `${
          formatVoiceDuration(item.duration, i18n.locale) ?? "—"
        } s · ${formatVoiceSize(item.bytes, i18n.locale)}`
      : null;

  if (view === "cards") {
    return (
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3"
        aria-label={
          preset ? t({ message: "预置音色" }) : t({ message: "我的音色" })
        }
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="border-border bg-card hover:border-ring/50 group flex min-w-0 flex-col gap-2.5 rounded-lg border p-4 transition-colors hover:shadow-xs"
          >
            <div className="flex min-w-0 items-start gap-2">
              <SelectBox id={item.id} name={item.name} />
              <button
                type="button"
                className="focus-visible:ring-ring min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 disabled:cursor-default"
                disabled={!onOpen}
                onClick={() => onOpen?.(item.id)}
                aria-label={openLabel(item.name)}
              >
                <p className="text-sm font-medium wrap-anywhere">{item.name}</p>
              </button>
            </div>
            {!preset && item.description?.trim() ? (
              <p className="text-muted-foreground line-clamp-2 text-xs leading-5">
                {item.description.trim()}
              </p>
            ) : null}
            <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className="min-w-0 wrap-anywhere">
                {item.source?.trim() || "—"}
              </span>
              {meta(item) && (
                <span className="whitespace-nowrap tabular-nums">
                  {meta(item)}
                </span>
              )}
            </p>
            <div className="mt-auto flex justify-end pt-1">
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground group-hover:text-foreground"
                disabled={!onOpen}
                onClick={() => onOpen?.(item.id)}
              >
                {preset ? <PlayIcon /> : <ChevronRightIcon />}
                {preset ? (
                  <Trans comment="展开真实预置声音的合成试听">试听声音</Trans>
                ) : (
                  <Trans comment="打开真实音色资产详情">查看详情</Trans>
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const columns = preset
    ? "@min-[700px]:grid-cols-[minmax(0,1fr)_11rem_1.5rem]"
    : "@min-[700px]:grid-cols-[minmax(0,1fr)_9rem_9rem_1.5rem]";
  return (
    <div className="@container min-w-0">
      <div
        aria-hidden="true"
        className={`text-muted-foreground hidden gap-4 border-b px-3 py-2 text-xs @min-[700px]:grid ${columns}`}
      >
        <span>
          <Trans comment="音色列表的名称与描述列">音色</Trans>
        </span>
        <span>
          {preset ? (
            <Trans comment="预置音色所属的语音模型">所属模型</Trans>
          ) : (
            <Trans comment="声音的来源引擎或用户录音">来源</Trans>
          )}
        </span>
        {!preset && (
          <span>
            <Trans comment="音色录音时长与大小的组合列">录音</Trans>
          </span>
        )}
        <span />
      </div>
      <ul
        className="border-border border-b"
        aria-label={
          preset ? t({ message: "预置音色" }) : t({ message: "我的音色" })
        }
      >
        {items.map((item) => (
          <li key={item.id} className="border-border border-b last:border-b-0">
            <div className="flex items-center gap-3 px-3">
              <SelectBox id={item.id} name={item.name} />
              <button
                type="button"
                className={`focus-visible:ring-ring hover:bg-accent/50 grid w-full min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-md px-1 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 @min-[700px]:items-center ${columns} disabled:hover:bg-transparent`}
                disabled={!onOpen}
                onClick={() => onOpen?.(item.id)}
                aria-label={openLabel(item.name)}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium wrap-anywhere">
                    {item.name}
                  </span>
                  {!preset && item.description?.trim() ? (
                    <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                      {item.description.trim()}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground col-span-2 row-start-2 min-w-0 text-xs wrap-anywhere @min-[700px]:col-span-1 @min-[700px]:row-start-auto">
                  {item.source?.trim() || "—"}
                </span>
                {!preset && (
                  <span className="text-muted-foreground col-span-2 row-start-3 text-xs tabular-nums @min-[700px]:col-span-1 @min-[700px]:row-start-auto">
                    {meta(item) ?? "—"}
                  </span>
                )}
                <ChevronRightIcon className="text-muted-foreground col-start-2 row-start-1 size-4 justify-self-end @min-[700px]:col-start-auto @min-[700px]:row-start-auto" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
