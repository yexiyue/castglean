import { Trans, useLingui } from "@lingui/react/macro";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPage,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { NativeSelect } from "@/components/ui/native-select";

export const VOICE_PAGE_SIZES = [20, 50, 100] as const;

/** 收敛页码列表：固定显示三个连续页码（当前页尽量居中），两侧以省略号示意更多页。 */
function pageList(
  page: number,
  pageCount: number,
): { key: string; page?: number }[] {
  const start = Math.max(0, Math.min(page - 1, pageCount - 3));
  const numbers = [0, 1, 2]
    .map((offset) => start + offset)
    .filter((candidate) => candidate < pageCount);
  const result: { key: string; page?: number }[] = [];
  if (numbers[0] > 0) result.push({ key: "gap-start" });
  for (const p of numbers) result.push({ key: `page-${p}`, page: p });
  if (numbers[numbers.length - 1] < pageCount - 1)
    result.push({ key: "gap-end" });
  return result;
}

/**
 * 音色列表分页栏：与表格容器分离的独立条。
 * 左侧是真实计数与每页行数，右侧是数字分页；批量导出时附带已选计数。
 */
export function VoiceTablePagination({
  total,
  page,
  pageCount,
  pageSize,
  selectedCount,
  onPageChange,
  onPageSizeChange,
}: {
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  /** 提供时（批量导出场景）在计数前显示已选数量。 */
  selectedCount?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const { t } = useLingui();
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    // 单行分页栏：左侧计数与行数，右侧页码；不做换行。
    <div className="flex items-center justify-between gap-4 pt-3">
      <p
        aria-live="polite"
        className="text-muted-foreground flex min-w-0 shrink-0 items-center gap-x-3 text-xs whitespace-nowrap"
      >
        {selectedCount != null && selectedCount > 0 ? (
          <span className="text-foreground">
            <Trans comment="分页栏的批量选择计数">
              已选择 {selectedCount} 项
            </Trans>
          </span>
        ) : null}
        <span className="tabular-nums">
          <Trans comment="当前页范围与过滤后总数">
            第 {from}–{to} 项，共 {total} 项
          </Trans>
        </span>
        <label className="flex items-center gap-1.5">
          <Trans comment="分页每页行数标签">每页</Trans>
          <NativeSelect
            className="w-14 tabular-nums"
            aria-label={t({
              comment: "分页每页行数选择框",
              message: "每页行数",
            })}
            density="compact"
            value={String(pageSize)}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {VOICE_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </NativeSelect>
        </label>
      </p>
      <div className="flex min-w-0 flex-1 justify-end">
        <Pagination
          aria-label={t({ comment: "音色列表分页导航", message: "音色分页" })}
        >
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                disabled={page === 0}
                onClick={() => onPageChange(page - 1)}
              >
                <Trans comment="分页上一页按钮">上一页</Trans>
              </PaginationPrevious>
            </PaginationItem>
            {pageList(page, pageCount).map(({ key, page: target }) =>
              target === undefined ? (
                <PaginationItem key={key}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={key}>
                  <PaginationPage
                    page={target + 1}
                    isActive={target === page}
                    onClick={() => onPageChange(target)}
                  />
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                disabled={page >= pageCount - 1}
                onClick={() => onPageChange(page + 1)}
              >
                <Trans comment="分页下一页按钮">下一页</Trans>
              </PaginationNext>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
