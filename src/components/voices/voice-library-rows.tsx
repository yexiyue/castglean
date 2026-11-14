import { Trans, useLingui } from "@lingui/react/macro";
import { AudioLinesIcon, ChevronRightIcon, PlayIcon } from "lucide-react";
import type { ListView } from "@/components/list-view-toggle";
import { ModelLogo } from "@/components/models/model-logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatVoiceDuration, formatVoiceSize } from "@/lib/voices";

export type VoiceListItem = {
  id: string;
  name: string;
  /** 预置音色所属模型的引擎标识，用于显示模型 logo。 */
  backend?: string | null;
  /** 预置音色的稳定标识（音色 ID）。 */
  detail?: string | null;
  description?: string | null;
  source?: string | null;
  /** 来源侧的次级标识（预置音色为引擎/模型，库内音色为入库时间）。 */
  sourceDetail?: string | null;
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

  const openLabel = (item: VoiceListItem) =>
    preset
      ? t({
          message: `打开音色「${item.name}」的试听配置，模型：${item.source ?? "—"}`,
          comment: "打开指定预置音色的试听配置，包含完整模型名称",
        })
      : t({
          message: `查看音色「${item.name}」`,
          comment: "打开指定库内音色的详情面板",
        });

  const selectBox = (id: string, name: string) =>
    selected ? (
      <Checkbox
        className="mt-0.5 shrink-0"
        checked={selected.has(id)}
        disabled={!onSelect}
        aria-label={t({
          message: `选择音色「${name}」`,
          comment: "音色列表的批量导出选择框，包含音色名",
        })}
        onCheckedChange={(checked) => onSelect?.(id, checked)}
      />
    ) : null;

  const meta = (item: VoiceListItem) =>
    !preset && (item.duration != null || item.bytes != null)
      ? `${
          formatVoiceDuration(item.duration, i18n.locale) ?? "—"
        } s · ${formatVoiceSize(item.bytes, i18n.locale)}`
      : null;

  // 行首标识：预置音色用所属模型的 logo，库内音色用通用音色图标。
  const rowIcon = (item: VoiceListItem) =>
    preset && item.backend ? (
      <ModelLogo backend={item.backend} size="sm" />
    ) : (
      <AudioLinesIcon
        aria-hidden="true"
        className="text-muted-foreground size-5 shrink-0"
      />
    );
  const cardIcon = (item: VoiceListItem) =>
    preset && item.backend ? (
      <ModelLogo backend={item.backend} />
    ) : (
      <span
        aria-hidden="true"
        className="border-border bg-muted/50 text-muted-foreground rounded-surface flex size-9 shrink-0 items-center justify-center border"
      >
        <AudioLinesIcon className="size-5" />
      </span>
    );

  if (view === "cards") {
    return (
      <section
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3"
        aria-label={
          preset ? t({ message: "预置音色" }) : t({ message: "我的音色" })
        }
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="border-border bg-card hover:border-ring/50 group rounded-surface flex min-w-0 flex-col gap-2.5 border p-4 transition-colors hover:shadow-xs"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {selectBox(item.id, item.name)}
              {cardIcon(item)}
              <button
                type="button"
                className="focus-visible:ring-ring rounded-item min-w-0 flex-1 text-left outline-none focus-visible:ring-2 disabled:cursor-default"
                disabled={!onOpen}
                onClick={() => onOpen?.(item.id)}
                aria-label={openLabel(item)}
              >
                <p className="text-sm font-medium wrap-anywhere">{item.name}</p>
                {item.detail?.trim() &&
                item.detail.trim().toLocaleLowerCase() !==
                  item.name.trim().toLocaleLowerCase() ? (
                  <p className="text-muted-foreground mt-0.5 truncate text-xs tabular-nums">
                    {item.detail.trim()}
                  </p>
                ) : null}
              </button>
            </div>
            {!preset && item.description?.trim() ? (
              <p className="text-muted-foreground line-clamp-2 text-xs leading-5">
                {item.description.trim()}
              </p>
            ) : null}
            <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className="min-w-0">
                <span className="block wrap-anywhere">
                  {item.source?.trim() || "—"}
                </span>
                {item.sourceDetail?.trim() ? (
                  <span className="block text-xs wrap-anywhere tabular-nums">
                    {item.sourceDetail.trim()}
                  </span>
                ) : null}
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
                aria-label={openLabel(item)}
              >
                {preset ? <PlayIcon /> : <ChevronRightIcon />}
                {preset ? (
                  <Trans comment="打开真实预置声音的试听配置">
                    打开试听配置
                  </Trans>
                ) : (
                  <Trans comment="打开真实音色资产详情">查看详情</Trans>
                )}
              </Button>
            </div>
          </div>
        ))}
      </section>
    );
  }

  // 表格视图的列：预置音色与库内音色各五列，信息均匀分布，不再堆叠次行。
  const columns = preset
    ? "@min-[700px]:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)_1.5rem]"
    : "@min-[700px]:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_7.5rem_9rem_1.5rem]";
  // 次级单元格：小屏跨满整行堆叠，大屏各占一列。
  const cellClass =
    "text-muted-foreground col-span-2 min-w-0 truncate text-xs @min-[700px]:col-span-1";
  return (
    <div className="@container min-w-0">
      <div
        aria-hidden="true"
        className={cn(
          "text-muted-foreground hidden gap-4 border-b px-3 py-2 text-xs @min-[700px]:grid",
          columns,
        )}
      >
        <span>
          <Trans comment="音色列表的名称与描述列">音色</Trans>
        </span>
        {preset ? (
          <>
            <span>
              <Trans comment="预置音色的稳定技术标识列">音色 ID</Trans>
            </span>
            <span>
              <Trans comment="预置音色所属的语音模型">所属模型</Trans>
            </span>
            <span>
              <Trans comment="预置音色所属后端及模型变体列">引擎</Trans>
            </span>
          </>
        ) : (
          <>
            <span>
              <Trans comment="声音的来源引擎或用户录音">来源</Trans>
            </span>
            <span>
              <Trans comment="音色导入本设备音色库的时间列">入库时间</Trans>
            </span>
            <span>
              <Trans comment="音色录音时长与大小的组合列">录音</Trans>
            </span>
          </>
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
              {selectBox(item.id, item.name)}
              <button
                type="button"
                className={cn(
                  "focus-visible:ring-ring hover:bg-accent/50 rounded-item resource-compact-columns grid w-full min-w-0 flex-1 items-center gap-x-4 gap-y-1.5 px-1 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 @min-[700px]:items-center disabled:hover:bg-transparent",
                  columns,
                )}
                disabled={!onOpen}
                onClick={() => onOpen?.(item.id)}
                aria-label={openLabel(item)}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  {rowIcon(item)}
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
                </span>
                {preset ? (
                  <>
                    <span className={cn(cellClass, "tabular-nums")}>
                      {item.detail?.trim() &&
                      item.detail.trim().toLocaleLowerCase() !==
                        item.name.trim().toLocaleLowerCase()
                        ? item.detail.trim()
                        : "—"}
                    </span>
                    <span className="text-muted-foreground col-span-2 min-w-0 text-xs wrap-anywhere @min-[700px]:col-span-1">
                      {item.source?.trim() || "—"}
                    </span>
                    <span className={cn(cellClass, "tabular-nums")}>
                      {item.sourceDetail?.trim() || "—"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={cellClass}>
                      {item.source?.trim() || "—"}
                    </span>
                    <span className={cn(cellClass, "tabular-nums")}>
                      {item.sourceDetail?.trim() || "—"}
                    </span>
                    <span className={cn(cellClass, "tabular-nums")}>
                      {meta(item) ?? "—"}
                    </span>
                  </>
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
