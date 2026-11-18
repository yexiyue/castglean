import { Trans, useLingui } from "@lingui/react/macro";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  PencilIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProjectSearch } from "@/components/projects/project-search";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceChrome } from "@/components/workspace-chrome";
import type {
  Chapter_Serialize,
  LocalProjectSnapshot_Serialize,
} from "@/lib/bindings";
import { chapterLineIndex } from "@/lib/projects/chapter-reading";
import { cn } from "@/lib/utils";

type Row = {
  key: string;
  title: string;
  level: number;
  position: number;
  size: number;
  parent?: string;
  chapter?: Chapter_Serialize;
  ordinal?: number;
};
const ROW_HEIGHT = 48;

export function ChapterDirectory({
  project,
  onLocate,
  onSelect,
  onEdit,
  editDisabled,
  selectedId,
  review,
}: {
  project: LocalProjectSnapshot_Serialize;
  onLocate: (source: string, line: number) => void;
  onSelect: (chapter: Chapter_Serialize) => void;
  onEdit?: (chapter: Chapter_Serialize) => void;
  editDisabled?: boolean;
  selectedId?: string;
  review?: {
    issues: {
      id: string;
      sourceId: string;
      line?: number;
      detail?: string;
      title: string;
      chapterTitle: string;
      filename: string;
    }[];
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    onSelect: (id: string) => void;
    onLoadMore?: () => void;
    onRetry?: () => void;
    hasMore?: boolean;
    total?: number;
    failed?: boolean;
  };
}) {
  const { t } = useLingui();
  const id = useId();
  const chrome = useWorkspaceChrome();
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [issueTop, setIssueTop] = useState(0);
  const [issueHeight, setIssueHeight] = useState(0);
  const issueViewport = useRef<HTMLDivElement>(null);
  const revealChapter = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState("");
  const [selected, setSelected] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const viewport = useRef<HTMLDivElement>(null);
  const volumes = useMemo(
    () => new Map(project.volumes.map((v) => [v.id, v])),
    [project.volumes],
  );
  // Contiguous groups preserve the host's immutable source/chapter order.
  const groups = useMemo(() => {
    const result: { key: string; title: string; children: Row[] }[] = [];
    for (const [index, chapter] of project.chapters.entries()) {
      const volume = chapter.volumeId
        ? volumes.get(chapter.volumeId)
        : undefined;
      const base = `${chapter.sourceId}:${chapter.volumeId ?? ""}`;
      let group = result[result.length - 1];
      if (!group?.key.startsWith(`${base}:`)) {
        const source = project.sources.find((s) => s.id === chapter.sourceId);
        group = {
          key: `${base}:${index}`,
          title: volume?.title ?? source?.filename ?? chapter.sourceId,
          children: [],
        };
        result.push(group);
      }
      group.children.push({
        key: chapter.id,
        title: chapter.title,
        chapter,
        ordinal: index + 1,
        level: 1,
        position: 1,
        size: 1,
      });
    }
    return result;
  }, [project.chapters, project.sources, volumes]);
  const rows = useMemo(() => {
    const grouped = project.volumes.length > 0 || project.sources.length > 1;
    const result: Row[] = [];
    for (const [index, group] of groups.entries()) {
      if (grouped)
        result.push({
          key: group.key,
          title: group.title,
          level: 1,
          position: index + 1,
          size: groups.length,
        });
      if (!grouped || !collapsed.has(group.key))
        group.children.forEach((row, childIndex) => {
          result.push({
            ...row,
            parent: grouped ? group.key : undefined,
            level: grouped ? 2 : 1,
            position: grouped ? childIndex + 1 : result.length + 1,
            size: grouped ? group.children.length : project.chapters.length,
          });
        });
    }
    return result;
  }, [
    groups,
    project.chapters.length,
    collapsed,
    project.volumes.length,
    project.sources.length,
  ]);
  const activeIndex = Math.max(
    0,
    rows.findIndex((row) => row.key === active),
  );
  const activeRow = rows[activeIndex];
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scrollToIndex = useCallback((index: number) => {
    const element = viewport.current;
    if (!element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight)
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
  }, []);
  function toggle(row: Row) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  }
  function activate(row: Row) {
    setActive(row.key);
    if (row.chapter) {
      setSelected(row.key);
      onSelect(row.chapter);
    } else toggle(row);
  }
  const issueCount =
    review?.total ?? review?.issues.length ?? project.issues.length;
  function locateIssue(issue: {
    sourceId: string;
    line: number;
    kind: string;
  }) {
    if (review) review.onSelect(issue.kind);
    else onLocate(issue.sourceId, issue.line);
  }
  const issueRows = useMemo(() => {
    if (review)
      return review.issues.map((item) => ({
        issue: { sourceId: item.sourceId, line: item.line ?? 0, kind: item.id },
        kind: item.title,
        chapterTitle: item.chapterTitle,
        filename: item.filename,
        detail: item.detail,
      }));
    const chapterAtLine = chapterLineIndex(project.chapters);
    const filenames = new Map(
      project.sources.map((source) => [source.id, source.filename]),
    );
    return project.issues.map((issue) => {
      const chapterTitle =
        chapterAtLine(issue.sourceId, issue.line)?.title ?? "";
      const filename = filenames.get(issue.sourceId) ?? "";
      const kind =
        issue.kind === "duplicate_heading"
          ? t`标题重复`
          : issue.kind === "short_chapter"
            ? t`章节过短`
            : issue.kind === "long_chapter"
              ? t`章节过长`
              : issue.kind === "numbering_gap"
                ? t`章节编号跳变`
                : t`未识别到标题`;
      return {
        issue,
        kind,
        chapterTitle,
        filename,
        detail: undefined as string | undefined,
      };
    });
  }, [project.chapters, project.sources, project.issues, review, t]);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const end = Math.min(
    rows.length,
    Math.ceil((scrollTop + height) / ROW_HEIGHT) + 5,
  );
  const indices = Array.from(
    { length: Math.max(0, end - start) },
    (_, i) => i + start,
  );
  if (activeRow && !indices.includes(activeIndex)) indices.push(activeIndex);
  const firstIssue = Math.max(0, Math.floor(issueTop / ROW_HEIGHT) - 5);
  const lastIssue = Math.ceil((issueTop + issueHeight) / ROW_HEIGHT) + 8;

  useLayoutEffect(() => {
    if (revealChapter.current !== active || !activeRow?.chapter) return;
    revealChapter.current = null;
    scrollToIndex(activeIndex);
  }, [active, activeIndex, activeRow, scrollToIndex]);

  useEffect(() => {
    if (!issuesOpen || !issueViewport.current) return;
    const element = issueViewport.current;
    const observer = new ResizeObserver(() =>
      setIssueHeight(element.clientHeight),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [issuesOpen]);

  function selectSearchChapter(chapter: Chapter_Serialize) {
    const group = groups.find(({ children }) =>
      children.some((row) => row.key === chapter.id),
    );
    revealChapter.current = chapter.id;
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (group) next.delete(group.key);
      return next;
    });
    setActive(chapter.id);
    setSelected(chapter.id);
    onSelect(chapter);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        data-slot="directory-toolbar"
        className="flex h-12 shrink-0 items-center gap-1 border-b px-2"
      >
        <div className="min-w-0 flex-1">{chrome?.projectSwitcher}</div>
        <ProjectSearch
          chapters={project.chapters}
          onChapter={selectSearchChapter}
        />
        <Dialog
          open={issuesOpen}
          onOpenChange={(open) => {
            setIssuesOpen(open);
            if (open) setIssueTop(0);
          }}
        >
          <DialogTrigger
            render={
              <Button variant="ghost" size="icon-sm" className="relative" />
            }
            aria-label={t`待检查`}
            title={t`待检查`}
          >
            <AlertCircleIcon />
            {issueCount > 0 && (
              <span
                aria-hidden
                className="absolute -top-1 -right-1 rounded-md bg-background px-1 text-xs tabular-nums"
              >
                {issueCount}
              </span>
            )}
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>
              <Trans>待检查</Trans> · {issueCount}
            </DialogTitle>
            <DialogDescription>
              {review?.description ?? t`章节结构问题与人物归属审阅分别记录。`}
            </DialogDescription>
            {issueRows.length === 0 ? (
              <div className="space-y-1 py-4 text-sm">
                {review?.failed ? (
                  <AlertCircleIcon className="size-4" />
                ) : (
                  <CheckCircle2Icon className="size-4" />
                )}
                <p>{review?.emptyTitle ?? t`暂无本地检查项`}</p>
                <p className="text-muted-foreground">
                  {review?.emptyDescription}
                </p>
              </div>
            ) : (
              <div
                ref={issueViewport}
                data-slot="chapter-issues-scroll"
                className="max-h-[min(50vh,28rem)] overflow-y-auto"
                onScroll={(event) => {
                  const element = event.currentTarget;
                  setIssueTop(element.scrollTop);
                  if (
                    review?.hasMore &&
                    element.scrollHeight -
                      element.scrollTop -
                      element.clientHeight <
                      400
                  )
                    review.onLoadMore?.();
                }}
              >
                <div
                  className="relative"
                  style={{ height: issueRows.length * ROW_HEIGHT }}
                >
                  {issueRows
                    .slice(firstIssue, lastIssue)
                    .map(
                      (
                        { issue, kind, chapterTitle, filename, detail },
                        offset,
                      ) => (
                        <button
                          type="button"
                          key={`${issue.sourceId}-${issue.line}-${issue.kind}`}
                          style={{
                            top: (firstIssue + offset) * ROW_HEIGHT + 2,
                            height: ROW_HEIGHT - 4,
                          }}
                          className="absolute inset-x-1 flex flex-col justify-center rounded-md px-3 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                          title={[chapterTitle, filename]
                            .filter(Boolean)
                            .join(" · ")}
                          onClick={() => {
                            setIssuesOpen(false);
                            locateIssue(issue);
                          }}
                        >
                          <span>{kind}</span>
                          <span className="text-xs text-muted-foreground">
                            {detail ?? <Trans>第 {issue.line + 1} 行</Trans>}
                          </span>
                        </button>
                      ),
                    )}
                </div>
              </div>
            )}
            {review?.failed && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={review.onRetry}
              >
                <Trans>重试读取</Trans>
              </Button>
            )}
            {review?.hasMore && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={review.onLoadMore}
              >
                <Trans>读取更多</Trans>
              </Button>
            )}
          </DialogContent>
        </Dialog>
      </header>
      <div
        ref={viewport}
        data-slot="chapter-directory-scroll"
        className="group/directory min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        role="tree"
        aria-label={t`章节树`}
        tabIndex={0}
        aria-activedescendant={activeRow ? `${id}-${activeIndex}` : undefined}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || !activeRow) return;
          let next = activeIndex;
          if (event.key === "ArrowDown")
            next = Math.min(rows.length - 1, next + 1);
          else if (event.key === "ArrowUp") next = Math.max(0, next - 1);
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = rows.length - 1;
          else if (event.key === "ArrowRight") {
            if (!activeRow.chapter && collapsed.has(activeRow.key))
              toggle(activeRow);
            else if (!activeRow.chapter)
              next = Math.min(rows.length - 1, next + 1);
          } else if (event.key === "ArrowLeft") {
            if (!activeRow.chapter && !collapsed.has(activeRow.key))
              toggle(activeRow);
            else if (activeRow.parent)
              next = rows.findIndex((r) => r.key === activeRow.parent);
          } else if (event.key === "Enter" || event.key === " ")
            activate(activeRow);
          else return;
          event.preventDefault();
          setActive(rows[next].key);
          scrollToIndex(next);
        }}
      >
        <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
          {indices.map((index) => {
            const row = rows[index];
            const chapter = row.chapter;
            return (
              <div
                key={row.key}
                data-slot="chapter-directory-row"
                className="group/row absolute inset-x-1.5"
                style={{ top: index * ROW_HEIGHT + 2, height: ROW_HEIGHT - 4 }}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  id={`${id}-${index}`}
                  role="treeitem"
                  aria-level={row.level}
                  aria-posinset={row.position}
                  aria-setsize={row.size}
                  aria-selected={row.key === (selectedId ?? selected)}
                  aria-expanded={
                    row.chapter ? undefined : !collapsed.has(row.key)
                  }
                  title={row.title}
                  style={{
                    paddingLeft: row.level === 2 ? 20 : 8,
                  }}
                  className={cn(
                    "flex size-full cursor-pointer items-center gap-2 rounded-md pr-2 text-sm transition-colors hover:bg-muted/70",
                    chapter && onEdit && "pr-9",
                    row.key === (selectedId ?? selected) &&
                      "bg-accent/50 font-medium text-foreground hover:bg-accent/65",
                    row.key === activeRow?.key &&
                      "group-focus-visible/directory:ring-1 group-focus-visible/directory:ring-ring group-focus-visible/directory:ring-inset",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    viewport.current?.focus();
                    activate(row);
                  }}
                >
                  {row.chapter ? (
                    <span className="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {row.ordinal}
                    </span>
                  ) : collapsed.has(row.key) ? (
                    <ChevronRightIcon className="size-4 shrink-0" />
                  ) : (
                    <ChevronDownIcon className="size-4 shrink-0" />
                  )}
                  <span className="line-clamp-2 min-w-0 leading-5 wrap-break-word">
                    {row.title}
                  </span>
                </button>
                {chapter && onEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t`编辑章节`}
                          disabled={editDisabled}
                          tabIndex={row.key === activeRow?.key ? 0 : -1}
                          className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-open:opacity-100 pointer-coarse:opacity-100"
                        />
                      }
                    >
                      <EllipsisIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(chapter)}>
                        <PencilIcon />
                        <Trans>编辑章节</Trans>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
