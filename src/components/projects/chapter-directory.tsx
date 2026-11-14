import { Trans, useLingui } from "@lingui/react/macro";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ListTreeIcon,
  SearchIcon,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { SearchInput } from "@/components/ui/search-input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  selectedId,
  actions,
  review,
}: {
  project: LocalProjectSnapshot_Serialize;
  onLocate: (source: string, line: number) => void;
  onSelect: (chapter: Chapter_Serialize) => void;
  selectedId?: string;
  actions?: ReactNode;
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
    hasMore?: boolean;
    onQueryChange?: (query: string) => void;
    total?: number;
    failed?: boolean;
  };
}) {
  const { t } = useLingui();
  const id = useId();
  const [tab, setTab] = useState("directory");
  const [query, setQuery] = useState("");
  const [issueQuery, setIssueQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState("");
  const [selected, setSelected] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const viewport = useRef<HTMLDivElement>(null);
  const directoryTab = useRef<HTMLButtonElement>(null);
  const directoryScroll = useRef(0);
  const issueScroll = useRef(0);
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
    const search = query.trim().toLocaleLowerCase();
    const matching = groups
      .map((g) => ({
        ...g,
        children: g.children.filter(
          (r) =>
            !search ||
            (/^\d+$/.test(search)
              ? r.ordinal === Number(search)
              : r.title.toLocaleLowerCase().includes(search) ||
                g.title.toLocaleLowerCase().includes(search)),
        ),
      }))
      .filter((g) => g.children.length);
    const grouped = project.volumes.length > 0 || project.sources.length > 1;
    const result: Row[] = [];
    for (const [index, group] of matching.entries()) {
      if (grouped)
        result.push({
          key: group.key,
          title: group.title,
          level: 1,
          position: index + 1,
          size: matching.length,
        });
      if (!grouped || search || !collapsed.has(group.key))
        group.children.forEach((row, childIndex) => {
          result.push({
            ...row,
            parent: grouped ? group.key : undefined,
            level: grouped ? 2 : 1,
            position: grouped ? childIndex + 1 : result.length + 1,
            size: grouped
              ? group.children.length
              : matching.reduce((sum, g) => sum + g.children.length, 0),
          });
        });
    }
    return result;
  }, [
    groups,
    query,
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
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element) {
      const saved =
        tab === "directory" ? directoryScroll.current : issueScroll.current;
      element.scrollTop = saved;
      setScrollTop(element.scrollTop);
    }
  }, [tab]);
  function scrollToIndex(index: number) {
    const element = viewport.current;
    if (!element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight)
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
  }
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
  const filteredIssues = useMemo(() => {
    if (review?.onQueryChange) return issueRows;
    const search = issueQuery.trim().toLocaleLowerCase();
    return issueRows.filter(
      ({ issue, kind, chapterTitle, filename }) =>
        !search ||
        (/^\d+$/.test(search)
          ? issue.line + 1 === Number(search)
          : `${kind} ${chapterTitle} ${filename}`
              .toLocaleLowerCase()
              .includes(search)),
    );
  }, [issueRows, issueQuery, review?.onQueryChange]);
  const total = tab === "directory" ? rows.length : filteredIssues.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const end = Math.min(total, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 5);
  const indices = Array.from(
    { length: Math.max(0, end - start) },
    (_, i) => i + start,
  );
  if (tab === "directory" && activeRow && !indices.includes(activeIndex))
    indices.push(activeIndex);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        data-slot="directory-toolbar"
        className="flex h-14 shrink-0 items-center gap-1 border-b px-2"
      >
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (value) setTab(value);
          }}
        >
          <TabsList size="icon">
            <Tooltip>
              <TooltipTrigger
                render={
                  <TabsTrigger
                    value="directory"
                    ref={directoryTab}
                    aria-label={t`目录`}
                    size="icon"
                  />
                }
              >
                <ListTreeIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" sideOffset={8}>
                <Trans>目录</Trans> · {project.chapters.length}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <TabsTrigger
                    value="issues"
                    aria-label={t`待检查`}
                    size="icon"
                  />
                }
              >
                <AlertCircleIcon aria-hidden="true" />
                {issueCount > 0 ? (
                  <span className="bg-background text-warning rounded-item absolute -top-1 -right-1 px-0.5 text-xs leading-3 tabular-nums">
                    {issueCount}
                  </span>
                ) : null}
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" sideOffset={8}>
                {review?.description ?? (
                  <Trans>
                    本地检测结果，点击定位原文；不代表 AI 诊断结论。
                  </Trans>
                )}{" "}
                {review?.failed ? null : <>· {issueCount}</>}
              </TooltipContent>
            </Tooltip>
          </TabsList>
        </Tabs>
        <div className="min-w-0 flex-1">
          <SearchInput
            variant="quiet"
            aria-label={
              tab === "directory"
                ? t`搜索章节或目录序号`
                : review
                  ? t`搜索章节或分析说明`
                  : t`搜索问题、章节或原文行号`
            }
            placeholder={
              tab === "directory"
                ? t`搜索章节或序号…`
                : review
                  ? t`搜索章节或分析说明…`
                  : t`搜索问题或行号…`
            }
            title={
              tab === "directory"
                ? t`目录序号包含前置内容；输入后按 Enter 前往`
                : t`按问题类型、章节标题或原文行号筛选；按 Enter 定位`
            }
            value={tab === "directory" ? query : issueQuery}
            onValueChange={(value) => {
              if (tab === "directory") {
                setQuery(value);
                setActive("");
                directoryScroll.current = 0;
              } else {
                setIssueQuery(value);
                review?.onQueryChange?.(value);
                issueScroll.current = 0;
              }
              if (viewport.current) viewport.current.scrollTop = 0;
              setScrollTop(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (tab === "issues") {
                const first = filteredIssues[0]?.issue;
                if (
                  first &&
                  (event.key === "Enter" || event.key === "ArrowDown")
                ) {
                  event.preventDefault();
                  if (event.key === "Enter") {
                    locateIssue(first);
                    viewport.current?.focus();
                  } else viewport.current?.querySelector("button")?.focus();
                }
                return;
              }
              const first = rows.find((row) => row.chapter);
              if (!first) return;
              if (event.key === "Enter" || event.key === "ArrowDown") {
                event.preventDefault();
                setActive(first.key);
                if (event.key === "Enter") activate(first);
                scrollToIndex(rows.indexOf(first));
                viewport.current?.focus();
              }
            }}
          />
        </div>
        {actions}
      </header>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useAriaPropsSupportedByRole: Runtime role is a named tree or focusable issues region; keyboard tree navigation is handled here. */}
      <div
        ref={viewport}
        data-slot="chapter-directory-scroll"
        className="group/directory focus-visible:ring-ring min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset"
        role={tab === "directory" ? "tree" : "region"}
        aria-label={tab === "directory" ? t`章节树` : t`待检查`}
        tabIndex={0}
        aria-activedescendant={
          tab === "directory" && activeRow ? `${id}-${activeIndex}` : undefined
        }
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          if (
            tab === "issues" &&
            review?.hasMore &&
            event.currentTarget.scrollHeight -
              event.currentTarget.scrollTop -
              event.currentTarget.clientHeight <
              400
          )
            review.onLoadMore?.();
          if (tab === "directory")
            directoryScroll.current = event.currentTarget.scrollTop;
          else issueScroll.current = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          if (tab !== "directory" || !activeRow) return;
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
        {total === 0 ? (
          <Empty className="min-h-full gap-3">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {tab === "issues" && review?.failed ? (
                  <AlertCircleIcon aria-hidden="true" />
                ) : tab === "issues" && issueCount === 0 ? (
                  <CheckCircle2Icon aria-hidden="true" />
                ) : (
                  <SearchIcon aria-hidden="true" />
                )}
              </EmptyMedia>
              <EmptyTitle>
                {tab === "directory"
                  ? t`没有匹配的章节`
                  : issueCount === 0 || review?.failed
                    ? (review?.emptyTitle ?? t`暂无本地检查项`)
                    : t`没有匹配的问题`}
              </EmptyTitle>
              <EmptyDescription>
                {tab === "issues" && (issueCount === 0 || review?.failed)
                  ? (review?.emptyDescription ??
                    t`本地规则未发现待检查位置，AI 建议请在右侧助手中审阅。`)
                  : t`试试其他关键词，或清除当前搜索。`}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {tab === "issues" && issueCount === 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTab("directory");
                    directoryTab.current?.focus();
                  }}
                >
                  <Trans>返回目录</Trans>
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (tab === "directory") {
                      setQuery("");
                      directoryScroll.current = 0;
                      setActive("");
                    } else {
                      setIssueQuery("");
                      review?.onQueryChange?.("");
                      issueScroll.current = 0;
                    }
                    if (viewport.current) viewport.current.scrollTop = 0;
                    setScrollTop(0);
                    viewport.current?.focus();
                  }}
                >
                  <Trans>清除搜索</Trans>
                </Button>
              )}
            </EmptyContent>
          </Empty>
        ) : null}
        <div className="relative" style={{ height: total * ROW_HEIGHT }}>
          {indices.map((index) => {
            const row = rows[index];
            if (tab === "directory")
              return (
                <button
                  type="button"
                  tabIndex={-1}
                  key={row.key}
                  id={`${id}-${index}`}
                  role="treeitem"
                  aria-level={row.level}
                  aria-posinset={row.position}
                  aria-setsize={row.size}
                  aria-selected={row.key === (selectedId ?? selected)}
                  aria-expanded={
                    row.chapter
                      ? undefined
                      : !!query.trim() || !collapsed.has(row.key)
                  }
                  title={row.title}
                  style={{
                    top: index * ROW_HEIGHT + 2,
                    height: ROW_HEIGHT - 4,
                    paddingLeft: row.level === 2 ? 20 : 8,
                  }}
                  className={cn(
                    "rounded-item hover:bg-muted/70 absolute inset-x-1.5 flex cursor-pointer items-center gap-2 pr-2 text-sm transition-colors",
                    row.key === (selectedId ?? selected) &&
                      "bg-accent/50 text-foreground hover:bg-accent/65 font-medium",
                    row.key === activeRow?.key &&
                      "group-focus-visible/directory:ring-ring group-focus-visible/directory:ring-1 group-focus-visible/directory:ring-inset",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    viewport.current?.focus();
                    activate(row);
                  }}
                >
                  {row.chapter ? (
                    <span className="text-muted-foreground w-8 shrink-0 text-right text-xs tabular-nums">
                      {row.ordinal}
                    </span>
                  ) : collapsed.has(row.key) && !query.trim() ? (
                    <ChevronRightIcon className="size-4 shrink-0" />
                  ) : (
                    <ChevronDownIcon className="size-4 shrink-0" />
                  )}
                  <span className="line-clamp-2 min-w-0 leading-5 wrap-break-word">
                    {row.title}
                  </span>
                </button>
              );
            const { issue, kind, chapterTitle, filename, detail } =
              filteredIssues[index];
            return (
              <button
                type="button"
                key={`${issue.sourceId}-${issue.line}-${issue.kind}`}
                style={{ top: index * ROW_HEIGHT + 2, height: ROW_HEIGHT - 4 }}
                className="rounded-item hover:bg-muted/70 focus-visible:ring-ring absolute inset-x-1.5 flex flex-col justify-center px-3 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-inset"
                title={[chapterTitle, filename].filter(Boolean).join(" · ")}
                onClick={() => locateIssue(issue)}
              >
                <span>{kind}</span>
                <span className="text-muted-foreground text-xs">
                  {detail ?? <Trans>第 {issue.line + 1} 行</Trans>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
