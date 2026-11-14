import { Trans, useLingui } from "@lingui/react/macro";
import { AudioLinesIcon, ChevronRightIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import type { ListView } from "@/components/list-view-toggle";
import { ModelLogo } from "@/components/models/model-logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspaceState } from "@/lib/desktop-session";
import { formatVoiceDuration, formatVoiceSize } from "@/lib/voices";
import { VoiceTablePagination } from "./voice-table-pagination";

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
 * 音色列表：表格视图收进描边容器、真实 table 语义、容器内滚动并分页；
 * 卡片视图为内部滚动的紧凑网格。批量选择（我的音色导出）只在有 onSelect
 * 时出现，两种视图都保留；筛选条件变化时由 resetKey 把分页拨回第一页。
 */
export function VoiceLibraryRows({
  items,
  preset = false,
  view = "table",
  selected,
  onSelect,
  onOpen,
  resetKey,
}: {
  items: VoiceListItem[];
  preset?: boolean;
  view?: ListView;
  selected?: Set<string>;
  onSelect?: (id: string, checked: boolean) => void;
  onOpen?: (id: string) => void;
  /** 过滤条件的摘要（搜索词、模型筛选等），变化即回到第一页。 */
  resetKey?: string;
}) {
  const { t, i18n } = useLingui();
  const [pageSize, setPageSize] = useWorkspaceState<number>(
    "voices",
    "rowsPerPage",
    20,
  );
  // 分页状态在渲染期跟随筛选与行数变化重置，避免额外的副作用依赖。
  const [pager, setPager] = useState<{
    key: string | undefined;
    size: number;
    page: number;
  }>({ key: resetKey, size: pageSize, page: 0 });
  if (pager.key !== resetKey || pager.size !== pageSize) {
    setPager({ key: resetKey, size: pageSize, page: 0 });
  }
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(pager.page, pageCount - 1);
  const setPage = (next: number) =>
    setPager((previous) => ({ ...previous, page: next }));
  const pageItems = items.slice(safePage * pageSize, (safePage + 1) * pageSize);

  // 音色 ID 全部缺失或与名称相同时整列隐藏，避免一列「—」稀释表格结构。
  const showDetailColumn =
    preset &&
    items.some(
      (item) =>
        item.detail?.trim() &&
        item.detail.trim().toLocaleLowerCase() !==
          item.name.trim().toLocaleLowerCase(),
    );

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

  const pagination = (
    <VoiceTablePagination
      total={items.length}
      page={safePage}
      pageCount={pageCount}
      pageSize={pageSize}
      selectedCount={selected ? selected.size : undefined}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
    />
  );

  if (!items.length) return null;

  if (view === "cards") {
    return (
      <section
        className="flex min-h-0 flex-1 flex-col"
        aria-label={
          preset ? t({ message: "预置音色" }) : t({ message: "我的音色" })
        }
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] content-start gap-3 pr-1 min-h-0 flex-1 overflow-y-auto">
          {pageItems.map((item) => (
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
                  <p className="text-sm font-medium wrap-anywhere">
                    {item.name}
                  </p>
                  {showDetailColumn && item.detail?.trim() ? (
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
        </div>
        {pagination}
      </section>
    );
  }

  // 表格视图：真实 table 语义（表头可被读屏按列导航）。首格按钮的
  // ::after 铺满整行实现整行可点，勾选框格以 overlap 浮在覆盖层之上。
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label={
        preset ? t({ message: "预置音色" }) : t({ message: "我的音色" })
      }
    >
      <div className="border-border bg-card rounded-surface flex min-h-0 flex-1 flex-col overflow-hidden border">
        {/* 滚动接近边界时按整行吸附，避免半行悬停在容器边缘。 */}
        <div className="min-h-0 flex-1 overflow-auto [&_tr]:snap-start snap-y snap-proximity">
          <Table
            aria-label={
              preset ? t({ message: "预置音色" }) : t({ message: "我的音色" })
            }
          >
            <TableHeader sticky>
              <TableRow>
                {selected ? (
                  <TableHead width="icon">
                    <Checkbox
                      checked={
                        pageItems.length > 0 &&
                        pageItems.every((item) => selected.has(item.id))
                      }
                      disabled={!onSelect}
                      aria-label={t({
                        comment: "勾选后选中当前页显示的全部音色",
                        message: "选择本页全部音色",
                      })}
                      onCheckedChange={(checked) => {
                        for (const item of pageItems)
                          onSelect?.(item.id, checked);
                      }}
                    />
                  </TableHead>
                ) : null}
                <TableHead width="full">
                  <Trans comment="音色列表的名称与描述列">音色</Trans>
                </TableHead>
                {preset ? (
                  <>
                    {showDetailColumn && (
                      <TableHead truncate="sm">
                        <Trans comment="预置音色的稳定技术标识列">
                          音色 ID
                        </Trans>
                      </TableHead>
                    )}
                    <TableHead truncate="md">
                      <Trans comment="预置音色所属的语音模型">所属模型</Trans>
                    </TableHead>
                    <TableHead truncate="sm">
                      <Trans comment="预置音色所属后端及模型变体列">引擎</Trans>
                    </TableHead>
                  </>
                ) : (
                  <>
                    <TableHead truncate="sm">
                      <Trans comment="声音的来源引擎或用户录音">来源</Trans>
                    </TableHead>
                    <TableHead width="time">
                      <Trans comment="音色导入本设备音色库的时间列">
                        入库时间
                      </Trans>
                    </TableHead>
                    <TableHead width="time">
                      <Trans comment="音色录音时长与大小的组合列">录音</Trans>
                    </TableHead>
                  </>
                )}
                <TableHead width="icon">
                  <span className="sr-only">
                    <Trans comment="音色行末尾的操作列">操作</Trans>
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((item) => (
                <TableRow key={item.id} interactive={!!onOpen}>
                  {selected ? (
                    <TableCell width="icon" overlap>
                      {selectBox(item.id, item.name)}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <button
                      type="button"
                      className="focus-visible:ring-ring after:absolute after:inset-0 flex w-full min-w-0 items-center gap-2.5 rounded-item text-left outline-none focus-visible:ring-2 disabled:after:hidden disabled:cursor-default"
                      disabled={!onOpen}
                      aria-label={openLabel(item)}
                      onClick={() => onOpen?.(item.id)}
                    >
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
                    </button>
                  </TableCell>
                  {preset ? (
                    <>
                      {showDetailColumn && (
                        <TableCell
                          tone="muted"
                          numeric
                          truncate="sm"
                          title={item.detail?.trim() || undefined}
                        >
                          {item.detail?.trim() &&
                          item.detail.trim().toLocaleLowerCase() !==
                            item.name.trim().toLocaleLowerCase()
                            ? item.detail.trim()
                            : "—"}
                        </TableCell>
                      )}
                      <TableCell
                        tone="muted"
                        truncate="md"
                        title={item.source?.trim() || undefined}
                      >
                        {item.source?.trim() || "—"}
                      </TableCell>
                      <TableCell
                        tone="muted"
                        numeric
                        truncate="sm"
                        title={item.sourceDetail?.trim() || undefined}
                      >
                        {item.sourceDetail?.trim() || "—"}
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell
                        tone="muted"
                        truncate="sm"
                        title={item.source?.trim() || undefined}
                      >
                        {item.source?.trim() || "—"}
                      </TableCell>
                      <TableCell tone="muted" numeric>
                        {item.sourceDetail?.trim() || "—"}
                      </TableCell>
                      <TableCell tone="muted" numeric>
                        {meta(item) ?? "—"}
                      </TableCell>
                    </>
                  )}
                  <TableCell width="icon" tone="muted">
                    {preset ? (
                      <PlayIcon aria-hidden="true" className="size-4" />
                    ) : (
                      <ChevronRightIcon aria-hidden="true" className="size-4" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      {pagination}
    </section>
  );
}
