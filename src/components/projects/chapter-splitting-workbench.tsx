import { Trans, useLingui } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  AlertTriangleIcon,
  AlignJustifyIcon,
  ArrowRightIcon,
  CheckIcon,
  EllipsisIcon,
  FolderTreeIcon,
  InfoIcon,
  ListCollapseIcon,
  LoaderCircleIcon,
  LocateFixedIcon,
  MessageSquareIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PencilIcon,
  Undo2Icon,
} from "lucide-react";
import {
  type ComponentProps,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChapterDiagnostics } from "@/components/projects/chapter-diagnostics";
import { ChapterDirectory } from "@/components/projects/chapter-directory";
import { HeadingRulesEditor } from "@/components/projects/heading-rules-editor";
import { PanelResizeHandle } from "@/components/projects/panel-resize-handle";
import { SplitProposal } from "@/components/projects/split-proposal";
import { VirtualSourceReader } from "@/components/projects/virtual-source-reader";
import { useWorkspaceMode } from "@/components/projects/workspace-mode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspaceChrome } from "@/components/workspace-chrome";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  type Chapter_Serialize,
  commands,
  type LocalProjectSnapshot_Serialize,
  type ProjectEdit_Deserialize,
  type ResultReference,
} from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";
import { appHotkeys } from "@/lib/hotkeys";
import {
  chapterAtByte,
  chapterReadingRange,
} from "@/lib/projects/chapter-reading";
import { type SourceContext, utf8Excerpt } from "@/lib/projects/source-context";
import { sourceSelection } from "@/lib/projects/source-selection";
import type { SourceDisplay } from "@/lib/projects/source-whitespace";

function IconAction({
  label,
  hint,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string; hint?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint ?? label}</TooltipContent>
    </Tooltip>
  );
}

export function ChapterSplittingWorkbench({
  project: current,
  onChange,
  onAddSources,
  onContinue,
}: {
  project: LocalProjectSnapshot_Serialize;
  onChange: (project: LocalProjectSnapshot_Serialize) => void;
  onAddSources: () => void;
  onContinue: () => void;
}) {
  const { t } = useLingui();
  const formId = useId();
  const chrome = useWorkspaceChrome();
  const mode = useWorkspaceMode();
  const visible = mode?.active ?? true;
  const wide = useMediaQuery("(min-width: 1280px)");
  const narrow = useMediaQuery("(max-width: 850px)");
  const editButton = useRef<HTMLButtonElement>(null);
  const directoryButton = useRef<HTMLButtonElement>(null);
  const assistantButton = useRef<HTMLButtonElement>(null);
  const directoryPanel = useRef<HTMLElement>(null);
  const assistantPanel = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [aiActive, setAiActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState(current.sources[0]?.id ?? "");
  const [line, setLine] = useState(0);
  const [positionByte, setPositionByte] = useState(0);
  const [sourceDisplay, setSourceDisplay] = useWorkspaceState<SourceDisplay>(
    current.id,
    "split-source-display",
    "compact",
  );
  const navigation = useRef(0);
  const [locatedLine, setLocatedLine] = useState(0);
  const [targetOffset, setTargetOffset] = useState(44);
  const [jumpLine, setJumpLine] = useState("1");
  const [jumpError, setJumpError] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const jumpInput = useRef<HTMLInputElement>(null);
  const [selectionContext, setSelectionContext] =
    useState<SourceContext | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterLine, setChapterLine] = useState<number | null>(null);
  const [volumeId, setVolumeId] = useState("");
  const [volumeTitle, setVolumeTitle] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useWorkspaceState<boolean | null>(
    current.id,
    "split-directory-open",
    null,
  );
  const [assistantOpen, setAssistantOpen] = useWorkspaceState(
    current.id,
    "split-assistant-open",
    true,
  );
  const [directoryWidth, setDirectoryWidth] = useWorkspaceState(
    current.id,
    "split-directory-width",
    304,
  );
  const [assistantWidth, setAssistantWidth] = useWorkspaceState(
    current.id,
    "split-assistant-width",
    360,
  );
  const directoryVisible =
    (directoryOpen ?? wide) && !(narrow && assistantOpen);
  const assistantVisible = assistantOpen;
  const toggleDirectory = () => {
    const next = !directoryVisible;
    setDirectoryOpen(next);
    if (next && narrow) setAssistantOpen(false);
    directoryButton.current?.focus();
  };
  const toggleAssistant = () => {
    const next = !assistantVisible;
    setAssistantOpen(next);
    if (next && narrow) setDirectoryOpen(false);
    assistantButton.current?.focus();
  };
  // 回调随渲染同步，无需 ref；IME/输入框语义由库处理，重复按键由清单 requireReset 防护
  useHotkey(appHotkeys["workspace.toggleDirectory"], toggleDirectory, {
    enabled: visible,
  });
  useHotkey(appHotkeys["splitting.toggleAssistant"], toggleAssistant, {
    enabled: visible,
  });
  useHotkey(appHotkeys["splitting.jumpToChapter"], () => setJumpOpen(true), {
    enabled: visible,
  });
  useEffect(() => {
    if (!visible) return;
    if (
      !directoryVisible &&
      directoryPanel.current?.contains(document.activeElement)
    )
      directoryButton.current?.focus();
    if (
      !assistantVisible &&
      assistantPanel.current?.contains(document.activeElement)
    )
      assistantButton.current?.focus();
  }, [visible, directoryVisible, assistantVisible]);
  const [context, setContext] = useState<SourceContext | null>(null);
  const [review, setReview] = useState<ResultReference | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [textReload, setTextReload] = useState(0);
  const sourceRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing the file also discards an unsubmitted jump field.
  useEffect(() => {
    setJumpLine(String(locatedLine + 1));
  }, [locatedLine, sourceId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new source page invalidates a captured DOM selection.
  useEffect(() => {
    if (!visible) return;
    setSelectionContext(null);
    const capture = () => {
      const selected = sourceSelection(sourceRef.current);
      const next =
        selected && selected.text.length > 0
          ? { sourceId, line: selected.line, text: utf8Excerpt(selected.text) }
          : null;
      setSelectionContext((previous) =>
        previous?.sourceId === next?.sourceId &&
        previous?.line === next?.line &&
        previous?.text === next?.text
          ? previous
          : next,
      );
    };
    document.addEventListener("selectionchange", capture);
    return () => document.removeEventListener("selectionchange", capture);
  }, [visible, sourceId, line]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const commandIds = useRef(new Map<string, string>());
  function commandId(operation: string, value: unknown) {
    const key = JSON.stringify([operation, value]);
    let id = commandIds.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      commandIds.current.set(key, id);
    }
    return id;
  }
  function accept(project: LocalProjectSnapshot_Serialize) {
    if (mounted.current) onChange(project);
  }
  async function editProject(
    id: string,
    revision: number,
    edit: ProjectEdit_Deserialize,
  ) {
    await commands.localProjectEdit(
      id,
      revision,
      commandId("edit", [id, revision, edit]),
      edit,
    );
    return commands.localProjectSnapshot(id);
  }
  async function undoProject(id: string, revision: number) {
    await commands.localProjectUndo(
      id,
      revision,
      commandId("undo", [id, revision]),
    );
    return commands.localProjectSnapshot(id);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      if (mounted.current)
        setError(t`操作未完成，已有目录仍保留。请重新读取后重试。`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const activeChapter =
    chapterAtByte(current.chapters, sourceId, positionByte) ??
    current.chapters.find((chapter) => chapter.sourceId === sourceId);
  const activeIndex = activeChapter
    ? current.chapters.findIndex((chapter) => chapter.id === activeChapter.id)
    : -1;
  const sourceInfo = (
    <div
      data-slot="source-info-details"
      className="flex min-w-0 flex-col gap-1"
    >
      <p className="wrap-anywhere">
        {current.sources.find((source) => source.id === sourceId)?.filename ??
          t`原文文件`}
      </p>
      {activeIndex >= 0 ? (
        <p className="text-xs tabular-nums">
          <Trans>
            目录位置 {activeIndex + 1}/{current.chapters.length}（含前置内容）
          </Trans>
        </p>
      ) : null}
    </div>
  );
  const previousChapter = current.chapters[activeIndex - 1];
  const nextChapter =
    activeIndex >= 0 ? current.chapters[activeIndex + 1] : undefined;
  const readingRange = activeChapter
    ? chapterReadingRange(current.chapters, activeChapter)
    : undefined;
  function navigateChapter(chapter: Chapter_Serialize) {
    setTargetOffset(44);
    navigation.current++;
    setChapterLine(chapter.heading ?? 0);
    setChapterTitle(chapter.title);
    setVolumeId(chapter.volumeId ?? "");
    setPositionByte(chapter.start);
    setSourceId(chapter.sourceId);
    setLine(chapter.heading ?? 0);
    setLocatedLine(chapter.heading ?? 0);
    setTextReload((value) => value + 1);
    setReviewOpen(false);
  }
  async function locate(source: string, target: number) {
    const ticket = ++navigation.current;
    try {
      const page = await commands.localProjectText(
        current.id,
        source,
        target,
        1,
      );
      if (!mounted.current || ticket !== navigation.current) return;
      const row = page.lines[0];
      if (
        !row ||
        row.line !== target ||
        page.sourceId !== source ||
        page.sha256 !==
          current.sources.find((item) => item.id === source)?.sha256
      )
        throw new Error("Invalid location");
      const chapter = chapterAtByte(current.chapters, source, row.start);
      setChapterLine(null);
      setSourceId(source);
      setPositionByte(row.start);
      setLine(
        Math.max(
          chapter
            ? chapterReadingRange(current.chapters, chapter).startLine
            : 0,
          target - 2,
        ),
      );
      setTextReload((value) => value + 1);
      setLocatedLine(target);
      setReviewOpen(false);
    } catch {
      if (mounted.current && ticket === navigation.current)
        setError(t`无法读取原文，请重新读取。`);
    }
  }
  const readingLocation = mode?.location;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only activation/navigation handoffs reposition reading; edits and normal selection must not restore an old anchor.
  useEffect(() => {
    if (!visible || !readingLocation) return;
    const next =
      chapterAtByte(
        current.chapters,
        readingLocation.sourceId,
        readingLocation.byte,
      ) ?? current.chapters.find((c) => c.id === readingLocation.chapterId);
    if (next) {
      navigateChapter(next);
      setTargetOffset(readingLocation.offset);
      setLine(
        Math.max(
          chapterReadingRange(current.chapters, next).startLine,
          readingLocation.line,
        ),
      );
      setLocatedLine(readingLocation.line);
    }
  }, [visible, readingLocation]);
  const chaptersByHeading = useMemo(
    () =>
      new Map(
        current.chapters
          .filter((chapter) => chapter.sourceId === sourceId)
          .map((chapter) => [chapter.heading, chapter]),
      ),
    [current.chapters, sourceId],
  );
  const leadingControl = (
    <IconAction
      ref={directoryButton}
      label={t`目录`}
      hint={
        directoryVisible
          ? t`收起目录（⌘ / Ctrl + B）`
          : t`显示目录（⌘ / Ctrl + B）`
      }
      aria-expanded={directoryVisible}
      aria-controls={`${formId}-directory`}
      aria-keyshortcuts="Meta+B Control+B"
      aria-pressed={directoryVisible}
      onClick={toggleDirectory}
      className="mx-2"
    >
      {directoryVisible ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
    </IconAction>
  );
  const trailingControls = (
    <>
      <span
        role="status"
        aria-label={busy ? t`正在保存…` : error ? t`更改未确认` : t`已自动保存`}
        title={busy ? t`正在保存…` : error ? t`更改未确认` : t`已自动保存`}
        className="text-muted-foreground inline-flex items-center px-1"
      >
        {busy ? (
          <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
        ) : error ? (
          <AlertTriangleIcon className="text-destructive size-3.5" />
        ) : (
          <CheckIcon className="size-3.5" />
        )}
      </span>
      {current.canUndo && (
        <IconAction
          label={t`撤销调整`}
          disabled={busy}
          onClick={() =>
            void run(async () =>
              accept(await undoProject(current.id, current.revision)),
            )
          }
        >
          <Undo2Icon />
        </IconAction>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`更多操作`}
              title={t`更多操作`}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setShowRules(true)}>
              <Trans>分章规则</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAddSources}>
              <Trans>追加文件</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {!mode && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={t`进入章节制作`}
          disabled={!current.chapters.length}
          onClick={onContinue}
        >
          <Trans comment="分章检查后进入制作工作区的紧凑顶栏动作">
            继续制作
          </Trans>
          <ArrowRightIcon />
        </Button>
      )}
      <IconAction
        ref={assistantButton}
        label={t`分章助手`}
        hint={
          assistantVisible
            ? t`收起助手（⌘ / Ctrl + Alt + B）`
            : t`显示助手（⌘ / Ctrl + Alt + B）`
        }
        aria-expanded={assistantVisible}
        aria-controls={`${formId}-assistant`}
        aria-keyshortcuts="Meta+Alt+B Control+Alt+B"
        aria-pressed={assistantVisible}
        onClick={toggleAssistant}
      >
        {assistantVisible ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
      </IconAction>
    </>
  );
  return (
    <main
      className="splitting-workbench bg-card flex h-full min-h-0 flex-col overflow-hidden"
      aria-label={t`分章检查`}
      data-source-id={sourceId}
      data-chapter-id={activeChapter?.id}
      data-chapter-byte={activeChapter?.start}
    >
      <h1 className="sr-only">
        {current.title} · <Trans>分章检查</Trans>
      </h1>
      {!visible ? null : chrome ? (
        <>
          {chrome.leading && createPortal(leadingControl, chrome.leading)}
          {chrome.trailing && createPortal(trailingControls, chrome.trailing)}
        </>
      ) : (
        <header
          data-slot="split-fallback-toolbar"
          className="flex h-10 shrink-0 items-center gap-1 border-b px-2"
        >
          {leadingControl}
          <span className="mr-auto min-w-0 truncate text-sm font-medium">
            {current.title}
          </span>
          {trailingControls}
        </header>
      )}
      {mode && (
        <p className="text-muted-foreground shrink-0 border-b px-3 py-1 text-xs">
          <Trans>
            调整章节边界后，相关分析可能失效；历史与人工记录保留，不会自动迁移。
          </Trans>
        </p>
      )}
      {error && !editOpen && !volumeOpen ? (
        <div
          role="alert"
          className="text-destructive flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-sm"
        >
          {error}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                accept(await commands.localProjectSnapshot(current.id));
                setTextReload((value) => value + 1);
              })
            }
          >
            <Trans>重新读取</Trans>
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside
          ref={directoryPanel}
          id={`${formId}-directory`}
          aria-label={t`章节目录`}
          data-open={String(directoryVisible)}
          className="splitting-directory min-h-0 shrink-0 flex-col overflow-hidden border-r"
          style={{ width: Math.max(280, Math.min(400, directoryWidth)) }}
        >
          <ChapterDirectory
            project={current}
            onLocate={locate}
            onSelect={navigateChapter}
            selectedId={activeChapter?.id}
            actions={
              <IconAction
                ref={editButton}
                label={t`编辑章节`}
                disabled={chapterLine === null}
                onClick={() => setEditOpen(true)}
              >
                <PencilIcon />
              </IconAction>
            }
          />
          <Dialog
            open={visible && editOpen}
            onOpenChange={(open) => {
              if (!busy) setEditOpen(open);
            }}
          >
            <DialogContent finalFocus={editButton}>
              <DialogTitle>
                <Trans>编辑章节</Trans>
              </DialogTitle>
              {error ? (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              ) : null}
              <p className="text-muted-foreground text-xs">
                <Trans>第 {(chapterLine ?? 0) + 1} 行</Trans>
              </p>
              <p className="text-warning text-xs">
                <Trans>
                  调整章节边界后，相关分析可能失效；历史与人工记录保留，不会自动迁移。
                </Trans>
              </p>
              <form
                className="space-y-2 border-t pt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    accept(
                      await editProject(current.id, current.revision, {
                        kind: "boundary",
                        correction: {
                          sourceId,
                          line: chapterLine ?? 0,
                          include: true,
                          title: chapterTitle,
                          volumeId: volumeId || null,
                        },
                      }),
                    );
                    setEditOpen(false);
                  });
                }}
              >
                <label
                  htmlFor={`${formId}-chapter-title`}
                  className="block space-y-1 text-sm"
                >
                  <span>
                    <Trans>章节标题</Trans>
                  </span>
                  <Input
                    id={`${formId}-chapter-title`}
                    required
                    maxLength={120}
                    value={chapterTitle}
                    onChange={(e) => setChapterTitle(e.target.value)}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>
                    <Trans comment="当前章节所属分卷">所属卷</Trans>
                  </span>
                  <NativeSelect
                    className="w-full"
                    value={volumeId}
                    onChange={(e) => setVolumeId(e.target.value)}
                  >
                    <option value="">{t`按标题位置分组`}</option>
                    {current.volumes
                      .filter((v) => v.sourceId === sourceId)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title}
                        </option>
                      ))}
                  </NativeSelect>
                </label>
                <Button
                  size="sm"
                  type="submit"
                  disabled={busy || !chapterTitle.trim()}
                >
                  <Trans>保存标题与分卷</Trans>
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </aside>
        <PanelResizeHandle
          label={t`调整目录宽度`}
          value={Math.max(280, Math.min(400, directoryWidth))}
          min={280}
          max={400}
          onChange={setDirectoryWidth}
          className="splitting-directory-handle"
          hidden={!directoryVisible}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {review && (
            <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
              <Button
                aria-pressed={!reviewOpen}
                variant={!reviewOpen ? "selected" : "ghost"}
                size="sm"
                onClick={() => setReviewOpen(false)}
              >
                <Trans comment="切回只读小说正文视图">原文</Trans>
              </Button>
              {review ? (
                <Button
                  aria-pressed={reviewOpen}
                  variant={reviewOpen ? "selected" : "ghost"}
                  size="sm"
                  onClick={() => setReviewOpen(true)}
                >
                  <Trans comment="打开 AI 候选分章目录的结构对照">
                    方案审阅
                  </Trans>
                </Button>
              ) : null}
              {reviewOpen ? (
                <span className="text-muted-foreground ml-auto text-xs">
                  <Trans>确认后才会更改目录</Trans>
                </span>
              ) : null}
            </div>
          )}
          {review && reviewOpen ? (
            <SplitProposal
              key={review.id}
              reference={review}
              project={current}
              disabled={busy || aiActive}
              onChange={accept}
              onLocate={locate}
            />
          ) : null}
          <div
            className={`${reviewOpen ? "hidden" : "flex"} min-h-0 flex-1 flex-col overflow-hidden`}
          >
            <div
              data-slot="source-toolbar"
              className="flex h-14 shrink-0 items-center gap-3 border-b px-3"
            >
              <h2
                className="min-w-0 flex-1 truncate text-sm font-medium"
                title={activeChapter?.title}
              >
                {activeChapter?.title ?? t`未分章原文`}
              </h2>
              <div
                data-slot="source-tools"
                className="flex shrink-0 items-center gap-1"
              >
                <Popover>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <PopoverTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t`原文信息`}
                            />
                          }
                        />
                      }
                    >
                      <InfoIcon aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="end">
                      {sourceInfo}
                    </TooltipContent>
                  </Tooltip>
                  <PopoverContent align="end" aria-label={t`原文信息`}>
                    {sourceInfo}
                    {current.sources.length > 1 ? (
                      <label className="flex flex-col gap-2 text-xs">
                        <Trans>切换原文文件</Trans>
                        <NativeSelect
                          aria-label={t`原文文件`}
                          value={sourceId}
                          onChange={(event) => {
                            navigation.current++;
                            setChapterLine(null);
                            setPositionByte(0);
                            setTextReload((value) => value + 1);
                            setSourceId(event.target.value);
                            setLine(0);
                            setLocatedLine(0);
                          }}
                        >
                          {current.sources.map((source) => (
                            <option key={source.id} value={source.id}>
                              {source.filename}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                    ) : null}
                  </PopoverContent>
                </Popover>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Toggle
                        className="size-8 shrink-0 p-0"
                        aria-label={t`紧凑校对`}
                        pressed={sourceDisplay === "compact"}
                        onPressedChange={(pressed) =>
                          setSourceDisplay(pressed ? "compact" : "original")
                        }
                      />
                    }
                  >
                    {sourceDisplay === "compact" ? (
                      <ListCollapseIcon
                        data-slot="source-display-compact"
                        aria-hidden="true"
                      />
                    ) : (
                      <AlignJustifyIcon
                        data-slot="source-display-original"
                        aria-hidden="true"
                      />
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {sourceDisplay === "compact"
                      ? t`当前紧凑校对，点击恢复原样显示`
                      : t`当前原样显示，点击启用紧凑校对`}
                  </TooltipContent>
                </Tooltip>
                <Popover open={visible && jumpOpen} onOpenChange={setJumpOpen}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <PopoverTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t`转到行`}
                            />
                          }
                        />
                      }
                    >
                      <LocateFixedIcon aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <Trans>转到行（Ctrl+G）</Trans>
                    </TooltipContent>
                  </Tooltip>
                  <PopoverContent
                    align="end"
                    initialFocus={jumpInput}
                    aria-label={t`转到行`}
                  >
                    <form
                      noValidate
                      className="flex items-end gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const target = Number(jumpLine);
                        if (!Number.isSafeInteger(target) || target < 1) {
                          setJumpError(true);
                          return;
                        }
                        setJumpError(false);
                        locate(sourceId, target - 1);
                        setJumpOpen(false);
                      }}
                    >
                      <label
                        htmlFor={`${formId}-line`}
                        className="flex min-w-0 flex-1 flex-col items-start gap-2 text-sm"
                      >
                        <span>
                          <Trans comment="输入原文行号后按 Enter 或前往按钮定位">
                            转到行
                          </Trans>
                        </span>
                        <Input
                          id={`${formId}-line`}
                          type="number"
                          min={1}
                          className="h-8 w-full min-w-0"
                          ref={jumpInput}
                          value={jumpLine}
                          aria-invalid={jumpError}
                          onChange={(event) => {
                            setJumpLine(event.target.value);
                            setJumpError(false);
                          }}
                        />
                      </label>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t`前往此行`}
                        title={t`前往此行`}
                      >
                        <ArrowRightIcon />
                      </Button>
                    </form>
                    {jumpError ? (
                      <p
                        role="alert"
                        className="text-destructive shrink-0 px-3 py-1 text-xs"
                      >
                        <Trans>请输入有效行号。</Trans>
                      </p>
                    ) : null}
                  </PopoverContent>
                </Popover>
                <span
                  aria-hidden="true"
                  className="bg-border mx-1 h-4 w-px shrink-0"
                />
                <Dialog
                  open={visible && volumeOpen}
                  onOpenChange={(open) => {
                    if (!busy) setVolumeOpen(open);
                  }}
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <DialogTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t`分卷设置`}
                            />
                          }
                        />
                      }
                    >
                      <FolderTreeIcon aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <Trans>分卷设置</Trans>
                    </TooltipContent>
                  </Tooltip>
                  <DialogContent>
                    <DialogTitle>
                      <Trans>分卷设置</Trans>
                    </DialogTitle>
                    {error ? (
                      <p role="alert" className="text-destructive text-sm">
                        {error}
                      </p>
                    ) : null}
                    <p className="text-muted-foreground text-xs">
                      {
                        current.sources.find((source) => source.id === sourceId)
                          ?.filename
                      }{" "}
                      · <Trans>第 {locatedLine + 1} 行</Trans>
                    </p>
                    <div className="flex gap-2">
                      <Input
                        maxLength={120}
                        aria-label={t`新卷标题`}
                        placeholder={t`在当前行建立分卷`}
                        value={volumeTitle}
                        onChange={(e) => setVolumeTitle(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        disabled={busy || !sourceId || !volumeTitle.trim()}
                        onClick={() =>
                          void run(async () => {
                            accept(
                              await editProject(current.id, current.revision, {
                                kind: "volume",
                                sourceId,
                                line: locatedLine,
                                title: volumeTitle,
                              }),
                            );
                            setVolumeTitle("");
                            setVolumeOpen(false);
                          })
                        }
                      >
                        <Trans>设置卷</Trans>
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
            <VirtualSourceReader
              projectId={current.id}
              sourceId={sourceId}
              hash={
                current.sources.find((source) => source.id === sourceId)
                  ?.sha256 ?? ""
              }
              startLine={line}
              targetLine={locatedLine}
              targetOffset={targetOffset}
              reloadKey={textReload}
              viewportRef={sourceRef}
              range={readingRange}
              display={sourceDisplay}
              onBlankSelect={(item) => {
                setLocatedLine(item.line);
                setPositionByte(item.start);
              }}
              ending={
                <div className="flex min-w-0 items-center gap-2">
                  {previousChapter ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigateChapter(previousChapter)}
                    >
                      <Trans>上一章</Trans>
                    </Button>
                  ) : null}
                  <span className="text-muted-foreground mr-auto shrink-0 text-xs">
                    {activeChapter ? t`本章结束` : t`已到原文末尾`}
                  </span>
                  {nextChapter ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="max-w-3/5 min-w-0 shrink"
                      onClick={() => navigateChapter(nextChapter)}
                      title={nextChapter.title}
                    >
                      <Trans>下一章</Trans>
                      <span className="truncate">{nextChapter.title}</span>
                      <ArrowRightIcon />
                    </Button>
                  ) : activeChapter ? (
                    <span className="text-muted-foreground text-xs">
                      <Trans>已到最后一章</Trans>
                    </span>
                  ) : null}
                </div>
              }
              selectionAction={
                selectionContext ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-background"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setContext(selectionContext);
                      setAssistantOpen(true);
                      window.getSelection()?.removeAllRanges();
                    }}
                  >
                    <MessageSquareIcon />
                    <Trans>询问选中的原文</Trans>
                  </Button>
                ) : null
              }
              renderLine={(item, lastLine) => {
                const chapter = chaptersByHeading.get(item.line);
                return (
                  <div
                    key={item.line}
                    data-source-row={item.line}
                    data-source-byte={item.start}
                    className={`group flex items-start gap-2 px-2 ${sourceDisplay === "compact" ? "py-1" : "py-2"} ${item.line === locatedLine ? "bg-accent/10" : ""}`}
                  >
                    <button
                      type="button"
                      aria-label={t`选择第 ${item.line + 1} 行`}
                      className="text-muted-foreground hover:text-foreground shrink-0 py-1 text-right text-xs tabular-nums select-none"
                      style={{
                        width: `${Math.max(3, String(lastLine + 1).length)}ch`,
                      }}
                      onClick={() => {
                        setLocatedLine(item.line);
                        setPositionByte(item.start);
                      }}
                    >
                      {item.line + 1}
                    </button>
                    <pre
                      data-source-line={item.line}
                      className={`min-w-0 flex-1 text-sm leading-7 wrap-break-word whitespace-pre-wrap select-text ${sourceDisplay === "compact" ? "font-sans" : ""}`}
                    >
                      {item.text}
                    </pre>
                    <div
                      className={`flex shrink-0 select-none ${item.line === locatedLine ? "" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"}`}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t`询问此行`}
                        onClick={() => {
                          setContext({
                            sourceId: sourceId,
                            line: item.line,
                            text: utf8Excerpt(item.text),
                          });
                          setAssistantOpen(true);
                        }}
                      >
                        {" "}
                        <MessageSquareIcon className="size-4" />{" "}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || !item.text.trim()}
                        onClick={() =>
                          void run(async () =>
                            accept(
                              await editProject(current.id, current.revision, {
                                kind: "boundary",
                                correction: {
                                  sourceId: sourceId,
                                  line: item.line,
                                  include: !chapter,
                                  title: null,
                                  volumeId: null,
                                },
                              }),
                            ),
                          )
                        }
                      >
                        {chapter ? (
                          <Trans comment="移除章节起点，合并相邻章">合并</Trans>
                        ) : (
                          <Trans comment="在此原文行建立章节起点">分章</Trans>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              }}
            />
          </div>
        </div>
        <PanelResizeHandle
          label={t`调整助手宽度`}
          value={assistantWidth}
          min={300}
          max={480}
          direction={-1}
          onChange={setAssistantWidth}
          hidden={!assistantVisible}
        />
        <aside
          ref={assistantPanel}
          id={`${formId}-assistant`}
          aria-label={t`分章助手`}
          className={`${assistantVisible ? "flex" : "hidden"} splitting-assistant min-h-0 shrink-0 flex-col overflow-hidden border-l`}
          style={{ width: assistantWidth }}
        >
          <ChapterDiagnostics
            onActivityChange={setAiActive}
            project={current}
            context={context}
            onClearContext={() => setContext(null)}
            onReview={(reference) => {
              setReview(reference);
              setReviewOpen(true);
            }}
          />
        </aside>
      </div>
      <Dialog open={visible && showRules} onOpenChange={setShowRules}>
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle>
            <Trans>分章规则</Trans>
          </DialogTitle>
          <HeadingRulesEditor
            key={`${current.id}:${current.revision}`}
            initialRules={current.rules}
            disabled={busy}
            onApply={(rules) =>
              void run(async () => {
                accept(
                  await editProject(current.id, current.revision, {
                    kind: "rules",
                    rules,
                  }),
                );
                setShowRules(false);
              })
            }
          />
        </DialogContent>
      </Dialog>
    </main>
  );
}
