import { Trans, useLingui } from "@lingui/react/macro";
import {
  AlignJustifyIcon,
  ArrowLeftIcon,
  AudioLinesIcon,
  FilterIcon,
  HistoryIcon,
  InfoIcon,
  ListCollapseIcon,
  Loader2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Undo2Icon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ContextUsage } from "@/components/ai-elements/context-usage";
import { ModelPicker } from "@/components/ai-elements/model-picker";
import { ReasoningPicker } from "@/components/ai-elements/reasoning-picker";
import { SessionInput } from "@/components/ai-elements/session-input";
import { SessionMessages } from "@/components/ai-elements/session-messages";
import { AnnotatedLine } from "@/components/analysis/annotated-line";
import { CandidateReview } from "@/components/analysis/candidate-review";
import { SegmentInspector } from "@/components/analysis/segment-inspector";
import { VersionHistory } from "@/components/analysis/version-history";
import { ChapterAudioBar } from "@/components/projects/chapter-audio-bar";
import { ChapterDirectory } from "@/components/projects/chapter-directory";
import { CharacterCenter } from "@/components/projects/character-center";
import { PanelResizeHandle } from "@/components/projects/panel-resize-handle";
import { SplitProposal } from "@/components/projects/split-proposal";
import { StructureActions } from "@/components/projects/structure-actions";
import { VirtualSourceReader } from "@/components/projects/virtual-source-reader";
import { useWorkspaceMode } from "@/components/projects/workspace-mode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { useWorkspaceChrome } from "@/components/workspace-chrome";
import { useAiSession } from "@/hooks/use-ai-session";
import { useChapterAnalysis } from "@/hooks/use-chapter-analysis";
import { useChapterAnalysisIssues } from "@/hooks/use-chapter-analysis-issues";
import { useChapterAudio } from "@/hooks/use-chapter-audio";
import { useLlmConnections } from "@/hooks/use-llm-connections";
import { useMediaQuery } from "@/hooks/use-media-query";
import { aiMessages } from "@/lib/ai/stream";
import {
  commands,
  type HistoryPage,
  type LocalProjectSnapshot_Serialize,
  type Progress,
  type ReasoningSetting,
  type ResultReference,
  type Segment,
  type WorkspaceContext,
} from "@/lib/bindings";
import { useDesktopSession, useWorkspaceState } from "@/lib/desktop-session";
import {
  chapterAtByte,
  chapterReadingRange,
} from "@/lib/projects/chapter-reading";
import { sourceSelection } from "@/lib/projects/source-selection";
import { reasoningChoices } from "@/lib/reasoning";
import { cn } from "@/lib/utils";

function IconAction({
  label,
  children,
  onClick,
  pressed,
  disabled,
  expanded,
  controls,
  hint,
  buttonRef,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  controls?: string;
  hint?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            ref={buttonRef}
            aria-label={label}
            aria-pressed={pressed}
            aria-expanded={expanded}
            aria-controls={controls}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        {hint ?? label}
      </TooltipContent>
    </Tooltip>
  );
}

export function ImportedWorkspace({
  project: initialProject,
  onChange,
  onAddSources = () => {},
}: {
  project: LocalProjectSnapshot_Serialize;
  onChange?: (next: LocalProjectSnapshot_Serialize) => void;
  onAddSources?: () => void;
}) {
  const [project, setProject] = useState(initialProject);
  useEffect(() => setProject(initialProject), [initialProject]);
  const { t } = useLingui();
  const panelId = useId();
  const directoryButton = useRef<HTMLButtonElement>(null);
  const assistantButton = useRef<HTMLButtonElement>(null);
  const { openSettings } = useDesktopSession();
  const chrome = useWorkspaceChrome();
  const mode = useWorkspaceMode();
  const visible = mode?.active ?? true;
  const small = useMediaQuery("(max-width: 1100px)");
  const [chapterId, setChapterId] = useWorkspaceState(
    project.id,
    "chapterId",
    project.chapters[0].id,
  );
  const chapter =
    project.chapters.find((c) => c.id === chapterId) ?? project.chapters[0];
  const index = project.chapters.indexOf(chapter);
  const source = project.sources.find((s) => s.id === chapter.sourceId);
  const [directoryOpen, setDirectoryOpen] = useWorkspaceState(
    project.id,
    "analysisDirectoryOpen",
    true,
  );
  const [inspectorOpen, setInspectorOpen] = useWorkspaceState(
    project.id,
    "analysisInspectorOpen",
    true,
  );
  const [directoryWidth, setDirectoryWidth] = useWorkspaceState(
    project.id,
    "analysisDirectoryWidth",
    304,
  );
  const [display, setDisplay] = useWorkspaceState<"compact" | "original">(
    project.id,
    "analysisDisplay",
    "compact",
  );
  const [panel, setPanel] = useState("assistant");
  const [castReviewRequest, setCastReviewRequest] = useState(0);
  const [editRequest, setEditRequest] = useState(0);
  const [locatedLine, setLocatedLine] = useState(0);
  const [issueType, setIssueType] = useState("all");
  const [splitReference, setSplitReference] = useState<ResultReference | null>(
    null,
  );
  const [legacy, setLegacy] = useState<HistoryPage | null>(null);
  const [boundary, setBoundary] = useState<{
    line: number;
    include: boolean;
    revision: number;
    sourceId: string;
    commandId: string;
  } | null>(null);
  const legacyBefore = legacy?.before ?? null;
  const [sessionHistoryOpen, setSessionHistoryOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Segment | null>(null);
  const [targetLine, setTargetLine] = useState(0);
  const [targetOffset, setTargetOffset] = useState(44);
  const [evidence, setEvidence] = useState<{
    chapterId: string;
    range: { start: number; end: number };
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [operationFailed, setOperationFailed] = useState(false);
  const analysisStarting = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const reading = useMemo(
    () => chapterReadingRange(project.chapters, chapter),
    [project.chapters, chapter],
  );
  const analysis = useChapterAnalysis(project.id, chapter.id);
  const audio = useChapterAudio(project.id, chapter.id);
  const snapshot = analysis.data?.snapshot ?? null;
  const characters = analysis.data?.characters ?? [];
  const configuration = useLlmConnections();
  const [modelKey, setModelKey] = useState("");
  const userModelChoice = useRef(false);
  const [confirmedModel, setConfirmedModel] = useState<string | null>(null);
  const [effortKey, setEffortKey] = useState<ReasoningSetting | null>(null);
  const [reasoningFallback, setReasoningFallback] = useState(false);
  const models = (configuration?.connections ?? []).flatMap((c) =>
    c.models.map((m) => ({
      key: JSON.stringify([c.id, m.id]),
      selection: { connectionId: c.id, modelId: m.id },
      revision: c.revision,
      name: `${c.name} / ${m.name}`,
      short: m.name,
      connection: c.name,
      protocol: c.protocol,
      providerModelId: m.modelId,
      advertisedReasoning: m.advertisedReasoning,
      endpoint: c.endpoint,
    })),
  );
  const selectedModel =
    models.find((m) => m.key === modelKey) ??
    models.find(
      (m) =>
        m.selection.connectionId ===
          configuration?.defaultModel?.connectionId &&
        m.selection.modelId === configuration?.defaultModel?.modelId,
    );
  // 当前模型支持的显式档位；不支持当前选择时回落默认（不静默提交非法档）。
  const effortChoices = selectedModel
    ? reasoningChoices(
        configuration?.reasoningCatalog,
        selectedModel.protocol,
        selectedModel.providerModelId,
        selectedModel.advertisedReasoning,
      )
    : [];
  const effectiveEffort =
    effortKey && effortChoices.includes(effortKey) ? effortKey : null;
  const ai = useAiSession({
    projectId: project.id,
    taskKind: "project_assistant",
    title: t`工程会话`,
    binding: () =>
      selectedModel
        ? {
            configuration: {
              selection: selectedModel.selection,
              revision: selectedModel.revision,
              ...(effectiveEffort ? { reasoning: effectiveEffort } : {}),
            },
            confirmRebind:
              confirmedModel ===
              JSON.stringify([
                selectedModel.selection,
                selectedModel.revision,
                effectiveEffort,
              ]),
            expectedProjectRevision: project.revision,
            workspaceContext: { action: "auto", chapterId: chapter.id },
          }
        : null,
    failureText: t`请求未完成，已有分析与修改保留。`,
    prepareRevision: async () => {
      const fresh = await commands.localProjectSnapshot(project.id);
      setProject(fresh);
      return fresh.revision;
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new conversation resets explicit model consent (and restores its frozen effort) even if both sessions share configuration.
  useEffect(() => {
    userModelChoice.current = false;
    setModelKey("");
    setConfirmedModel(null);
    setEffortKey(ai.snapshot?.session.configuration?.reasoning ?? null);
    setReasoningFallback(false);
  }, [ai.sessionId, ai.snapshot?.session.id]);
  const restoredConnection =
    ai.snapshot?.session.configuration?.selection.connectionId;
  const restoredModel = ai.snapshot?.session.configuration?.selection.modelId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Restore the stored selection after every conversation change.
  useEffect(() => {
    if (!userModelChoice.current && restoredConnection && restoredModel)
      setModelKey(JSON.stringify([restoredConnection, restoredModel]));
  }, [ai.sessionId, restoredConnection, restoredModel]);
  const modelBindingKey = selectedModel
    ? JSON.stringify([
        selectedModel.selection,
        selectedModel.revision,
        effectiveEffort,
      ])
    : null;
  const storedConfiguration = ai.snapshot?.session.configuration;
  const needsModelConfirmation = !!(
    storedConfiguration &&
    selectedModel &&
    (storedConfiguration.selection.connectionId !==
      selectedModel.selection.connectionId ||
      storedConfiguration.selection.modelId !==
        selectedModel.selection.modelId ||
      storedConfiguration.revision !== selectedModel.revision ||
      (storedConfiguration.reasoning ?? null) !== effectiveEffort) &&
    confirmedModel !== modelBindingKey
  );
  function chooseModel(key: string) {
    const next = models.find((model) => model.key === key);
    if (!next) return;
    const allowed = reasoningChoices(
      configuration?.reasoningCatalog,
      next.protocol,
      next.providerModelId,
      next.advertisedReasoning,
    );
    const nextEffort =
      effortKey && allowed.includes(effortKey) ? effortKey : null;
    userModelChoice.current = true;
    setModelKey(key);
    setEffortKey(nextEffort);
    setReasoningFallback(effortKey !== null && nextEffort === null);
    setConfirmedModel(
      JSON.stringify([next.selection, next.revision, nextEffort]),
    );
  }
  function chooseEffort(setting: ReasoningSetting | null) {
    if (!selectedModel) return;
    userModelChoice.current = true;
    setEffortKey(setting);
    setReasoningFallback(false);
    setConfirmedModel(
      JSON.stringify([
        selectedModel.selection,
        selectedModel.revision,
        setting,
      ]),
    );
  }
  function contextTitle(context: WorkspaceContext): string {
    if (context.action === "cast") return t`选角建议`;
    if (context.action === "split" || !context.chapterId) return t`全书结构`;
    return (
      project.chapters.find((entry) => entry.id === context.chapterId)?.title ??
      t`历史章节`
    );
  }
  const [drafts, setDrafts] = useWorkspaceState<Record<string, string>>(
    project.id,
    "assistantDrafts",
    {},
  );
  const [context, setContext] = useState<{
    chapterId: string;
    line: number;
    text: string;
  } | null>(null);
  const draft = drafts[ai.sessionId] ?? "";
  const [progress, setProgress] = useState<Progress | null>(null);
  const runId = ai.snapshot?.run?.id;
  const runSequence = ai.snapshot?.session.sequence;
  useEffect(() => {
    let live = true;
    if (!runId) {
      setProgress(null);
      return;
    }
    void runSequence;
    void commands
      .chapterAnalysisProgress(runId)
      .then((value) => {
        if (live) setProgress(value);
      })
      .catch(() => {
        if (live) setProgress(null);
      });
    return () => {
      live = false;
    };
  }, [runId, runSequence]);
  const [issueScope, setIssueScope] = useState("book");
  const [issueSearch, setIssueSearch] = useState("");
  const issues = useChapterAnalysisIssues(
    project.id,
    issueScope === "chapter" ? chapter.id : null,
    snapshot?.revision ?? 0,
    issueSearch,
  );
  const pendingIssue = useRef<{ chapterId: string; segment: Segment } | null>(
    null,
  );
  const pendingResult = useRef<{
    chapterId: string;
    candidateId: string | null;
  } | null>(null);
  const currentChapter = useRef(chapter.id);
  currentChapter.current = chapter.id;
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const listener = () => setHasSelection(!!sourceSelection(viewport.current));
    document.addEventListener("selectionchange", listener);
    return () => document.removeEventListener("selectionchange", listener);
  }, [visible]);
  const resultId = ai.snapshot?.messages
    .flatMap((m) => m.parts.parts)
    .filter((p) => p.type === "result")
    .map((p) => p.reference.id)
    .join(":");
  useEffect(() => {
    if (resultId) {
      void analysis.reload().catch(() => {});
      issues.reload();
    }
  }, [resultId, analysis.reload, issues.reload]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reading position resets on chapter identity even when two sources share the same first line.
  useEffect(() => {
    const pending =
      pendingIssue.current?.chapterId === chapter.id
        ? pendingIssue.current
        : null;
    setSelected(pending?.segment ?? null);
    setCandidateId(
      pendingResult.current?.chapterId === chapter.id
        ? pendingResult.current.candidateId
        : null,
    );
    pendingResult.current = null;
    setLocatedLine(reading.startLine);
    setTargetOffset(44);
    setTargetLine(reading.startLine);
    setReloadKey((v) => v + 1);
    if (pending) {
      pendingIssue.current = null;
      void commands
        .chapterAnalysisExcerpt(project.id, chapter.id, pending.segment.range)
        .then((e) => {
          if (currentChapter.current === chapter.id) {
            setTargetLine(e.line);
            setReloadKey((v) => v + 1);
          }
        })
        .catch(() => setOperationFailed(true));
    }
  }, [chapter.id, reading.startLine]);
  const readingLocation = mode?.location;
  const pendingLocation = useRef<{
    location: NonNullable<typeof readingLocation>;
    chapterId: string;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Apply the shared anchor only on activation or a new navigation handoff, never on ordinary chapter selection.
  useEffect(() => {
    if (!visible || !readingLocation) return;
    const next =
      chapterAtByte(
        project.chapters,
        readingLocation.sourceId,
        readingLocation.byte,
      ) ?? project.chapters.find((c) => c.id === readingLocation.chapterId);
    if (!next) return;
    if (next.id !== chapter.id) {
      pendingLocation.current = {
        location: readingLocation,
        chapterId: next.id,
      };
      setChapterId(next.id);
    } else {
      setTargetOffset(readingLocation.offset);
      setTargetLine(Math.max(reading.startLine, readingLocation.line));
      setReloadKey((n) => n + 1);
    }
  }, [visible, readingLocation]);
  // Chapter changes reset the reader above; finish a cross-chapter handoff afterwards.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Chapter identity can change even when its source and start line are identical.
  useEffect(() => {
    const target = pendingLocation.current;
    if (!target || chapter.id !== target.chapterId) return;
    pendingLocation.current = null;
    setTargetOffset(target.location.offset);
    setTargetLine(Math.max(reading.startLine, target.location.line));
    setReloadKey((n) => n + 1);
  }, [chapter.id, chapter.sourceId, reading.startLine]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Structure commits must refresh host-owned validity even if the chapter identity survived.
  useEffect(() => {
    if (visible) void analysis.reload().catch(() => {});
  }, [visible, project.revision, analysis.reload]);
  const charactersRequest = mode?.charactersRequest ?? 0;
  const chaptersRequest = mode?.chaptersRequest ?? 0;
  useEffect(() => {
    if (charactersRequest) setPanel("characters");
  }, [charactersRequest]);
  useEffect(() => {
    if (chaptersRequest)
      setPanel((current) => (current === "characters" ? "assistant" : current));
  }, [chaptersRequest]);
  const saved = useCallback(async () => {
    // A completed command for the previous chapter must not reload into a new scope.
    if (currentChapter.current !== chapter.id)
      throw new Error("chapter_changed");
    await analysis.reload();
    if (currentChapter.current !== chapter.id)
      throw new Error("chapter_changed");
    setCandidateId(null);
  }, [analysis.reload, chapter.id]);
  const locate = useCallback(
    async (range: { start: number; end: number }) => {
      try {
        const excerpt = await commands.chapterAnalysisExcerpt(
          project.id,
          chapter.id,
          range,
        );
        if (currentChapter.current !== chapter.id) return;
        setEvidence({ chapterId: chapter.id, range });
        setTargetLine(excerpt.line);
        setReloadKey((v) => v + 1);
      } catch {
        setOperationFailed(true);
      }
    },
    [project.id, chapter.id],
  );
  const choose = (s: Segment) => {
    setEvidence(null);
    setSelected(s);
    setPanel("inspector");
    setInspectorOpen(true);
    if (small) setDirectoryOpen(false);
  };
  const directoryVisible = directoryOpen && (!small || !inspectorOpen);
  const inspectorVisible = inspectorOpen;
  const toggleDirectory = () => {
    setDirectoryOpen(!directoryVisible);
    if (!directoryVisible && small) setInspectorOpen(false);
    directoryButton.current?.focus();
  };
  const toggleInspector = () => {
    setInspectorOpen(!inspectorVisible);
    if (!inspectorVisible && small) setDirectoryOpen(false);
    assistantButton.current?.focus();
  };
  const panelToggles = useRef({ toggleDirectory, toggleInspector });
  panelToggles.current = { toggleDirectory, toggleInspector };
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "b") return;
      if (
        e.isComposing ||
        e.repeat ||
        (e.target instanceof Element &&
          e.target.closest("input, textarea, select, [contenteditable=true]"))
      )
        return;
      e.preventDefault();
      if (e.altKey) panelToggles.current.toggleInspector();
      else panelToggles.current.toggleDirectory();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible]);
  const leading = (
    <IconAction
      label={t`目录`}
      hint={directoryVisible ? t`收起目录` : t`显示目录`}
      expanded={directoryVisible}
      controls={`${panelId}-directory`}
      buttonRef={directoryButton}
      onClick={toggleDirectory}
      pressed={directoryVisible}
    >
      {directoryVisible ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
    </IconAction>
  );
  const trailing = (
    <>
      <IconAction
        label={t`AI 助手`}
        buttonRef={assistantButton}
        hint={inspectorVisible ? t`收起检查面板` : t`展开检查面板`}
        expanded={inspectorVisible}
        controls={`${panelId}-assistant`}
        onClick={toggleInspector}
        pressed={inspectorVisible}
      >
        {inspectorVisible ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
      </IconAction>
    </>
  );
  const localIssues = issues.rows;
  function changed(next: LocalProjectSnapshot_Serialize) {
    const top = viewport.current?.getBoundingClientRect().top ?? 0;
    const row = Array.from(
      viewport.current?.querySelectorAll<HTMLElement>("[data-source-row]") ??
        [],
    ).find((item) => item.getBoundingClientRect().bottom > top);
    const byte = row ? Number(row.dataset.sourceByte) : chapter.start;
    const nextChapter = chapterAtByte(next.chapters, chapter.sourceId, byte);
    if (nextChapter) {
      const location = {
        sourceId: chapter.sourceId,
        chapterId: nextChapter.id,
        byte,
        line: row ? Number(row.dataset.sourceRow) : reading.startLine,
        offset: row ? row.getBoundingClientRect().top - top : 44,
      };
      if (nextChapter.id !== chapter.id) {
        pendingLocation.current = { chapterId: nextChapter.id, location };
        setChapterId(nextChapter.id);
      } else {
        setTargetLine(location.line);
        setTargetOffset(location.offset);
        setReloadKey((v) => v + 1);
      }
    }
    setProject(next);
    onChange?.(next);
    setSelected(null);
    setCandidateId(null);
    setEvidence(null);
  }
  function locateSource(sourceId: string, line: number) {
    void commands
      .localProjectText(project.id, sourceId, line, 1)
      .then((page) => {
        const row = page.lines[0];
        if (!row) return;
        const target = chapterAtByte(project.chapters, sourceId, row.start);
        if (!target) return;
        if (target.id !== chapter.id) {
          pendingLocation.current = {
            chapterId: target.id,
            location: {
              sourceId,
              chapterId: target.id,
              byte: row.start,
              line,
              offset: 44,
            },
          };
          setChapterId(target.id);
        } else {
          setTargetLine(line);
          setReloadKey((v) => v + 1);
        }
        setLocatedLine(line);
      })
      .catch(() => setOperationFailed(true));
  }
  async function reviewResult(reference: ResultReference) {
    if (reference.kind === "chapter_split_proposal") {
      setSplitReference(reference);
      return;
    }
    if (reference.kind === "casting_suggestion") {
      setPanel("characters");
      setInspectorOpen(true);
      if (small) setDirectoryOpen(false);
      setCastReviewRequest((n) => n + 1);
      return;
    }
    if (reference.kind !== "chapter_analysis") return;
    try {
      const target = await commands.chapterAnalysisResultTarget(
        project.id,
        reference.id,
      );
      if (!project.chapters.some((c) => c.id === target.chapterId)) {
        setVersionHistoryOpen(true);
        return;
      }
      const candidate = await commands
        .chapterAnalysisCandidate(project.id, reference.id)
        .catch(() => null);
      if (target.chapterId !== chapter.id) {
        pendingResult.current = {
          chapterId: target.chapterId,
          candidateId: candidate?.id ?? null,
        };
        setChapterId(target.chapterId);
      } else {
        pendingResult.current = null;
        await analysis.reload();
      }
      setCandidateId(candidate?.id ?? null);
      setSelected(null);
      setPanel("inspector");
      setInspectorOpen(true);
      if (small) setDirectoryOpen(false);
    } catch {
      setOperationFailed(true);
    }
  }
  const structuralScope = project.issues.filter(
    (i) =>
      issueScope !== "chapter" ||
      (i.sourceId === chapter.sourceId &&
        i.line >= reading.startLine &&
        (reading.endLine === null || i.line < reading.endLine)),
  );
  const structuralIssues = structuralScope
    .map((i, n) => ({
      id: `structure:${n}:${i.sourceId}:${i.line}`,
      sourceId: i.sourceId,
      line: i.line,
      title:
        i.kind === "duplicate_heading"
          ? t`标题重复`
          : i.kind === "short_chapter"
            ? t`章节过短`
            : i.kind === "long_chapter"
              ? t`章节过长`
              : i.kind === "numbering_gap"
                ? t`章节编号跳变`
                : t`未识别到标题`,
      chapterTitle: "",
      detail: undefined,
      filename:
        project.sources.find((s) => s.id === i.sourceId)?.filename ?? "",
    }))
    .filter(
      (i) =>
        !issueSearch.trim() ||
        (/^\d+$/.test(issueSearch.trim())
          ? i.line + 1 === Number(issueSearch.trim())
          : `${i.title} ${i.filename} ${t`章节结构`}`
              .toLocaleLowerCase()
              .includes(issueSearch.trim().toLocaleLowerCase())),
    );

  return (
    <main
      aria-label={t`章节工作台`}
      data-source-id={chapter.sourceId}
      data-chapter-id={chapter.id}
      data-chapter-byte={chapter.start}
      className="bg-card flex h-full min-h-0 flex-col overflow-hidden"
    >
      {!visible ? null : chrome ? (
        <>
          {chrome.leading && createPortal(leading, chrome.leading)}
          {chrome.trailing && createPortal(trailing, chrome.trailing)}
        </>
      ) : (
        <header className="flex h-10 shrink-0 justify-between border-b px-2">
          {leading}
          {trailing}
        </header>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          id={`${panelId}-directory`}
          aria-label={t`章节目录`}
          className={cn(
            "min-h-0 shrink-0 flex-col border-r",
            directoryVisible && panel !== "characters" ? "flex" : "hidden",
          )}
          style={{ width: directoryWidth }}
        >
          <ChapterDirectory
            project={project}
            selectedId={chapter.id}
            onSelect={(c) => setChapterId(c.id)}
            onLocate={locateSource}
            actions={
              <>
                <IconAction
                  label={t`编辑章节`}
                  onClick={() => setEditRequest((n) => n + 1)}
                >
                  <PencilIcon />
                </IconAction>
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t`待检查范围`}
                      />
                    }
                  >
                    <FilterIcon />
                  </PopoverTrigger>
                  <PopoverContent align="start">
                    <label className="flex flex-col gap-2 text-sm">
                      <Trans>问题类型</Trans>
                      <NativeSelect
                        aria-label={t`问题类型`}
                        value={issueType}
                        onChange={(e) => setIssueType(e.target.value)}
                      >
                        <option value="all">{t`全部问题`}</option>
                        <option value="structure">{t`章节结构`}</option>
                        <option value="attribution">{t`人物归属`}</option>
                      </NativeSelect>
                    </label>
                    <label htmlFor="analysis-issue-scope" className="text-sm">
                      <Trans>待检查范围</Trans>
                    </label>
                    <NativeSelect
                      id="analysis-issue-scope"
                      value={issueScope}
                      onChange={(e) => setIssueScope(e.target.value)}
                      className="mt-2 w-full"
                    >
                      <option value="chapter">{t`本章`}</option>
                      <option value="book">{t`全书`}</option>
                    </NativeSelect>
                    {issues.hasMore ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void issues.loadMore()}
                      >
                        <Trans>读取更多</Trans>
                      </Button>
                    ) : null}
                  </PopoverContent>
                </Popover>
              </>
            }
            review={{
              issues: [
                ...(issueType !== "attribution" ? structuralIssues : []),
                ...(issueType !== "structure" ? localIssues : []).map(
                  (issue) => {
                    const c = project.chapters.find(
                      (c) => c.id === issue.chapterId,
                    );
                    const s = issue.segment;
                    return {
                      id: s.id,
                      sourceId: c?.sourceId ?? chapter.sourceId,
                      title:
                        s.attribution.state === "unknown"
                          ? t`归属未知`
                          : s.attribution.state === "ambiguous"
                            ? t`归属有歧义`
                            : t`待审阅片段`,
                      chapterTitle: c?.title ?? "",
                      filename:
                        project.sources.find(
                          (source) => source.id === c?.sourceId,
                        )?.filename ?? "",
                      detail: c?.title ?? "",
                    };
                  },
                ),
              ],
              hasMore: issueType !== "structure" && issues.hasMore,
              onQueryChange: setIssueSearch,
              onLoadMore: () => void issues.loadMore(),
              total:
                (issueType !== "attribution" ? structuralScope.length : 0) +
                (issueType !== "structure"
                  ? issueScope === "chapter"
                    ? (snapshot?.unreviewedCount ?? 0)
                    : (analysis.data?.directory
                        .filter((d) => !d.stale)
                        .reduce((n, d) => n + d.unreviewedCount, 0) ?? 0)
                  : 0),
              failed: issues.failed && issueType !== "structure",
              description: t`章节结构问题与人物归属审阅分别记录。`,
              emptyTitle:
                issues.failed && issueType !== "structure"
                  ? t`未能读取待检查项`
                  : t`当前范围暂无待检查项`,
              emptyDescription:
                issues.failed && issueType !== "structure"
                  ? t`请重试读取，已有分析与人工修正保留。`
                  : t`可检查分章或分析本章；没有问题不代表所有归属已确认。`,
              onSelect: (id) => {
                const structural = structuralIssues.find((i) => i.id === id);
                if (structural) {
                  locateSource(structural.sourceId, structural.line);
                  return;
                }
                const issue = localIssues.find((i) => i.segment.id === id);
                if (!issue) return;
                if (issue.chapterId !== chapter.id) {
                  pendingIssue.current = {
                    chapterId: issue.chapterId,
                    segment: issue.segment,
                  };
                  setChapterId(issue.chapterId);
                  setPanel("inspector");
                  setInspectorOpen(true);
                  if (small) setDirectoryOpen(false);
                } else {
                  choose(issue.segment);
                  void locate(issue.segment.range);
                }
              },
            }}
          />
        </aside>
        <PanelResizeHandle
          label={t`调整目录宽度`}
          value={directoryWidth}
          min={280}
          max={400}
          onChange={setDirectoryWidth}
          hidden={!directoryVisible || panel === "characters"}
        />
        {panel === "characters" ? (
          <CharacterCenter
            projectId={project.id}
            chapterId={chapter.id}
            revision={snapshot?.revision ?? 0}
            projectRevision={project.revision}
            characters={characters}
            chapters={project.chapters}
            selectedRange={selected?.range ?? null}
            castRunning={ai.active}
            reviewRequest={castReviewRequest}
            onLocate={async (id, version, segmentId, range) => {
              const page = await commands.chapterAnalysisSegments(
                project.id,
                version,
                range,
                null,
              );
              const segment = page.segments.find((seg) => seg.id === segmentId);
              if (!segment) throw new Error("analysis_not_found");
              if (id === chapter.id) {
                choose(segment);
                await locate(range);
              } else {
                pendingIssue.current = { chapterId: id, segment };
                setChapterId(id);
                setPanel("inspector");
                setInspectorOpen(true);
                if (small) setDirectoryOpen(false);
              }
            }}
            onSaved={saved}
          />
        ) : null}
        <section
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            panel === "characters" ? "hidden" : "flex",
          )}
        >
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
              {chapter.title}
            </h1>
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
                  <InfoIcon />
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end">
                  {source?.filename} · {index + 1}/{project.chapters.length}
                </TooltipContent>
              </Tooltip>
              <PopoverContent align="end">
                <p className="text-sm wrap-anywhere">{source?.filename}</p>
                {project.sources.length > 1 ? (
                  <NativeSelect
                    aria-label={t`原文文件`}
                    value={chapter.sourceId}
                    onChange={(e) => {
                      const next = project.chapters.find(
                        (c) => c.sourceId === e.target.value,
                      );
                      if (next) setChapterId(next.id);
                    }}
                  >
                    {project.sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.filename}
                      </option>
                    ))}
                  </NativeSelect>
                ) : null}
                <p className="text-muted-foreground mt-2 text-xs">
                  {index + 1}/{project.chapters.length} ·{" "}
                  {snapshot?.stale
                    ? t`分析已失效`
                    : snapshot?.versionId
                      ? t`已保存初稿`
                      : t`尚未分析`}
                </p>
              </PopoverContent>
            </Popover>
            <IconAction
              label={
                display === "compact" ? t`切换为原样显示` : t`切换为紧凑显示`
              }
              pressed={display === "compact"}
              onClick={() =>
                setDisplay(display === "compact" ? "original" : "compact")
              }
            >
              {display === "compact" ? (
                <ListCollapseIcon />
              ) : (
                <AlignJustifyIcon />
              )}
            </IconAction>
            <StructureActions
              project={project}
              chapter={chapter}
              line={locatedLine}
              active={ai.active}
              onChange={changed}
              onLocate={locateSource}
              onAddSources={onAddSources}
              editRequest={editRequest}
            />
            <IconAction
              label={t`撤回本章最近修改`}
              disabled={!snapshot?.canUndo || ai.active}
              onClick={() => {
                if (snapshot)
                  void commands
                    .chapterAnalysisEdit(
                      project.id,
                      chapter.id,
                      crypto.randomUUID(),
                      snapshot.revision,
                      { type: "undo" },
                    )
                    .then(async () => {
                      await saved();
                      setSelected(null);
                      setEvidence(null);
                    })
                    .catch(() => setOperationFailed(true));
              }}
            >
              <Undo2Icon />
            </IconAction>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t`检查分章`}
              title={t`检查分章`}
              disabled={
                ai.active ||
                ai.loading ||
                !selectedModel ||
                needsModelConfirmation
              }
              onClick={() => {
                setPanel("assistant");
                setInspectorOpen(true);
                if (small) setDirectoryOpen(false);
                void ai
                  .send(t`请检查全书分章结构，提出可审阅的修复方案。`, "split")
                  .catch(() => setOperationFailed(true));
              }}
            >
              <FilterIcon />
              <span className="hidden xl:inline">
                <Trans>检查分章</Trans>
              </span>
            </Button>
            <Button
              size="sm"
              aria-label={snapshot?.versionId ? t`重新分析` : t`分析本章`}
              title={snapshot?.versionId ? t`重新分析` : t`分析本章`}
              disabled={
                ai.active ||
                ai.loading ||
                !selectedModel ||
                needsModelConfirmation
              }
              onClick={() => {
                if (analysisStarting.current) return;
                analysisStarting.current = true;
                setPanel("assistant");
                setInspectorOpen(true);
                if (small) setDirectoryOpen(false);
                setOperationFailed(false);
                void ai
                  .send(t`分析本章`, true)
                  .catch(() => setOperationFailed(true))
                  .finally(() => {
                    analysisStarting.current = false;
                  });
              }}
            >
              <SparklesIcon data-icon="inline-start" />
              <span className="hidden xl:inline">
                {snapshot?.versionId ? (
                  <Trans>重新分析</Trans>
                ) : (
                  <Trans>分析本章</Trans>
                )}
              </span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={
                audio.status?.run.status === "succeeded"
                  ? t`重新生成本章音频`
                  : t`生成本章音频`
              }
              title={
                audio.status?.run.status === "succeeded"
                  ? t`重新生成本章音频`
                  : t`生成本章音频`
              }
              disabled={
                !audio.desktop || audio.starting || audio.active !== null
              }
              onClick={() => void audio.start()}
            >
              {audio.starting ? (
                <Loader2Icon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <AudioLinesIcon data-icon="inline-start" />
              )}
              <span className="hidden xl:inline">
                {audio.status?.run.status === "succeeded" ? (
                  <Trans>重新生成音频</Trans>
                ) : (
                  <Trans>生成本章音频</Trans>
                )}
              </span>
            </Button>
          </header>
          <ChapterAudioBar
            audio={audio}
            chapterId={chapter.id}
            onLocate={locate}
            onCharacters={() => setPanel("characters")}
            onChapter={setChapterId}
          />
          {analysis.failure ||
          issues.failed ||
          operationFailed ||
          ai.failure ? (
            <div
              role="alert"
              className="text-destructive flex items-center gap-2 border-b px-3 py-2 text-xs"
            >
              <span className="flex-1">
                <Trans>操作未完成，已有结果保留。</Trans>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOperationFailed(false);
                  issues.reload();
                  void analysis.reload().catch(() => {});
                }}
              >
                <Trans>重试读取</Trans>
              </Button>
            </div>
          ) : null}
          {snapshot?.stale ? (
            <p className="text-warning border-b px-3 py-2 text-xs">
              <Trans>章节来源或边界已变化，旧分析仅供查看，请重新分析。</Trans>
            </p>
          ) : null}
          {!selectedModel ? (
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                {models.length ? (
                  <Trans>选择本次分析使用的模型。</Trans>
                ) : (
                  <Trans>配置文本模型即可分析，阅读不受影响。</Trans>
                )}
              </span>
              <ModelPicker
                models={models}
                value={modelKey}
                onValueChange={chooseModel}
                label={t`分析使用的模型`}
                onOpenSettings={() => openSettings("models")}
              />
            </div>
          ) : null}
          {snapshot?.candidateIds.map((id) => (
            <Button
              key={id}
              size="sm"
              variant="ghost"
              className="shrink-0 justify-start border-b"
              onClick={() => {
                setCandidateId(id);
                setPanel("inspector");
                setInspectorOpen(true);
                if (small) setDirectoryOpen(false);
              }}
            >
              <Trans>有新的分析候选，查看变化</Trans>
            </Button>
          ))}
          <VirtualSourceReader
            projectId={project.id}
            sourceId={chapter.sourceId}
            hash={source?.sha256 ?? ""}
            startLine={Math.max(reading.startLine, targetLine - 2)}
            targetOffset={targetOffset}
            targetLine={targetLine}
            reloadKey={reloadKey}
            viewportRef={viewport}
            range={reading}
            display={display}
            onLoadedRange={analysis.loadedRange}
            onBlankSelect={(line) => setLocatedLine(line.line)}
            renderLine={(line) => (
              <div
                key={line.line}
                className="group relative"
                onPointerDown={() => setLocatedLine(line.line)}
              >
                <AnnotatedLine
                  key={line.line}
                  line={line}
                  segments={snapshot?.stale ? [] : analysis.segments}
                  selectedId={selected?.id ?? null}
                  highlight={
                    evidence?.chapterId === chapter.id ? evidence.range : null
                  }
                  onSelect={choose}
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="xs"
                        variant="outline"
                        aria-label={
                          project.chapters.some(
                            (c) =>
                              c.sourceId === chapter.sourceId &&
                              c.heading === line.line,
                          )
                            ? t`合并此章`
                            : t`从此行分章`
                        }
                        disabled={ai.active}
                        className="bg-background absolute top-0 right-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                        onClick={() => {
                          const heading = project.chapters.some(
                            (c) =>
                              c.sourceId === chapter.sourceId &&
                              c.heading === line.line,
                          );
                          setBoundary({
                            line: line.line,
                            include: !heading,
                            revision: project.revision,
                            sourceId: chapter.sourceId,
                            commandId: crypto.randomUUID(),
                          });
                        }}
                      />
                    }
                  >
                    <Trans>分章</Trans>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {project.chapters.some(
                      (c) =>
                        c.sourceId === chapter.sourceId &&
                        c.heading === line.line,
                    )
                      ? t`合并此章`
                      : t`从此行分章`}
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
            selectionAction={
              hasSelection ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const selection = sourceSelection(viewport.current);
                    if (selection) {
                      setContext({
                        chapterId: chapter.id,
                        line: selection.line,
                        text: selection.text,
                      });
                      setPanel("assistant");
                      setInspectorOpen(true);
                      if (small) setDirectoryOpen(false);
                    }
                  }}
                >
                  <Trans>询问选中的原文</Trans>
                </Button>
              ) : null
            }
            ending={
              <div className="mx-4 flex items-center justify-between gap-3 border-t py-4 text-sm">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => setChapterId(project.chapters[index - 1].id)}
                >
                  <Trans>上一章</Trans>
                </Button>
                <span className="text-muted-foreground text-xs">
                  <Trans>本章结束</Trans>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index + 1 === project.chapters.length}
                  onClick={() => setChapterId(project.chapters[index + 1].id)}
                >
                  <Trans>下一章</Trans>
                </Button>
              </div>
            }
          />
        </section>
        <aside
          id={`${panelId}-assistant`}
          aria-label={t`AI 助手与检查器`}
          className={cn(
            "min-h-0 w-80 shrink-0 flex-col overflow-hidden border-l",
            inspectorVisible ? "flex" : "hidden",
          )}
        >
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3">
            <div className="flex min-w-0 items-center gap-2">
              {panel === "inspector" ? (
                <IconAction
                  label={t`返回 AI 助手`}
                  onClick={() => setPanel("assistant")}
                >
                  <ArrowLeftIcon />
                </IconAction>
              ) : null}
              <h2 className="truncate text-sm font-medium">
                {panel === "inspector" ? t`归属检查` : t`AI 助手`}
              </h2>
            </div>
            <div className="flex gap-1">
              <IconAction
                label={panel === "inspector" ? t`分析版本历史` : t`会话历史`}
                onClick={() =>
                  panel === "inspector"
                    ? setVersionHistoryOpen(true)
                    : setSessionHistoryOpen(true)
                }
              >
                <HistoryIcon />
              </IconAction>
              {panel === "inspector" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPanel("characters")}
                >
                  <Trans>角色</Trans>
                </Button>
              ) : (
                <IconAction label={t`新建会话`} onClick={ai.newSession}>
                  <PlusIcon />
                </IconAction>
              )}
            </div>
          </header>
          <div
            className={cn(
              "min-h-0 flex-1 flex-col overflow-y-auto",
              panel === "inspector" ? "flex" : "hidden",
            )}
          >
            {candidateId && snapshot ? (
              <CandidateReview
                projectId={project.id}
                candidateId={candidateId}
                characters={characters}
                revision={snapshot.revision}
                onSaved={async () => {
                  await saved();
                  setSelected(null);
                }}
                onLocate={(r) => void locate(r)}
              />
            ) : (
              <SegmentInspector
                projectId={project.id}
                chapterId={chapter.id}
                snapshot={snapshot}
                onBoundarySaved={async () => {
                  await saved();
                  setSelected(null);
                }}
                segment={
                  analysis.segments.find((s) => s.id === selected?.id) ??
                  selected
                }
                characters={characters}
                onSaved={saved}
                onLocate={(r) => void locate(r)}
              />
            )}
          </div>
          <div
            className={cn(
              "min-h-0 flex-1 flex-col",
              panel !== "inspector" ? "flex" : "hidden",
            )}
          >
            {progress?.analyze ? (
              <div className="shrink-0 border-b px-3 py-2">
                <Trace>
                  <TraceLine
                    status={
                      ai.active
                        ? "running"
                        : ai.snapshot?.run?.error
                          ? "error"
                          : undefined
                    }
                  >
                    <TraceIcon>
                      <SparklesIcon />
                    </TraceIcon>
                    <TraceTitle>
                      {ai.active
                        ? t`正在分析 ${project.chapters.find((c) => c.id === ai.snapshot?.run?.workspaceContext?.chapterId)?.title ?? t`章节`}`
                        : ai.snapshot?.run?.error
                          ? t`分析未完成`
                          : t`分析已完成，等待审阅`}
                    </TraceTitle>
                    <TraceDescription>
                      {progress.completed} / {progress.total}
                      {progress.agent && (
                        <span className="ml-2">
                          {progress.agent.stage === "review"
                            ? t`正在预审`
                            : progress.agent.stage === "completed"
                              ? t`预审已完成`
                              : t`正在标注`}
                          {" · "}
                          <Trans>模型请求 {progress.agent.requests} 次</Trans>
                        </span>
                      )}
                    </TraceDescription>
                  </TraceLine>
                  {progress.agent && (
                    <div className="text-muted-foreground space-y-1 text-xs">
                      <p>
                        <Trans>模型输入</Trans>{" "}
                        {progress.agent.inputTokens?.toLocaleString() ??
                          t`未知`}
                        {" · "}
                        <Trans>模型输出</Trans>{" "}
                        {progress.agent.outputTokens?.toLocaleString() ??
                          t`未知`}
                        {" · "}
                        {progress.agent.elapsedMs == null
                          ? t`未知`
                          : Math.round(progress.agent.elapsedMs / 1000)}{" "}
                        s
                        {!progress.agent.timingComplete && (
                          <span className="ml-2">
                            <Trans>耗时记录尚不完整</Trans>
                          </span>
                        )}
                      </p>
                      {progress.agent.reviewFindings.length > 0 &&
                        progress.agent.chapterId === chapter.id && (
                          <div>
                            <p>
                              <Trans>AI 预审疑点，仅供人工核对</Trans>
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {progress.agent.reviewFindings.map(
                                (finding, index) => (
                                  <Button
                                    key={`${finding.range.start}:${finding.range.end}`}
                                    variant="link"
                                    size="sm"
                                    onClick={() => void locate(finding.range)}
                                  >
                                    <Trans>查看疑点 {index + 1}</Trans>
                                    {finding.kind && (
                                      <span className="ml-1">
                                        {finding.kind === "narration"
                                          ? t`旁白`
                                          : finding.kind === "speech"
                                            ? t`台词`
                                            : t`内心独白`}
                                        {" · "}
                                        {finding.speakerName ??
                                          (finding.candidateNames.length
                                            ? finding.candidateNames.join(" / ")
                                            : finding.kind === "narration"
                                              ? t`旁白`
                                              : t`未知`)}
                                      </span>
                                    )}
                                  </Button>
                                ),
                              )}
                            </div>
                          </div>
                        )}
                    </div>
                  )}
                </Trace>
                {!ai.active &&
                ai.snapshot?.run &&
                ["failed", "interrupted", "cancelled"].includes(
                  ai.snapshot.run.status,
                ) ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <p role="alert" className="text-destructive text-xs">
                      {ai.snapshot.run.error === "timeout"
                        ? t`模型响应超时，尚未发布完整分析。`
                        : ai.snapshot.run.error === "invalid_response"
                          ? t`模型结果未通过格式或原文范围校验，尚未发布。`
                          : ai.snapshot.run.error === "stale_project"
                            ? t`章节或已引用的角色发生变化，请重新分析。`
                            : ai.snapshot.run.error ===
                                  "configuration_unavailable" ||
                                ai.snapshot.run.error ===
                                  "configuration_changed"
                              ? t`模型配置不可用或已变化，请检查服务连接。`
                              : ai.snapshot.run.error === "cancelled"
                                ? t`分析已停止。`
                                : t`分析未完成，已有结果保留。`}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      <Trans>
                        已校验窗口会保留；继续将重新请求未完成的窗口，可能产生费用。
                      </Trans>
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-start"
                      disabled={!selectedModel || needsModelConfirmation}
                      onClick={() =>
                        void ai.chat
                          .regenerate()
                          .catch(() => setOperationFailed(true))
                      }
                    >
                      <Trans>继续分析</Trans>
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <SessionMessages
              label={t`工程 AI 对话`}
              scopes={
                new Map(
                  (ai.snapshot?.messages ?? []).flatMap((message) => {
                    const context = message.runId
                      ? (ai.snapshot?.contexts?.[message.runId] ??
                        (ai.snapshot?.run?.id === message.runId
                          ? ai.snapshot.run.workspaceContext
                          : null))
                      : null;
                    return context
                      ? [
                          [
                            message.id,
                            {
                              label: contextTitle(context),
                              chapterId:
                                context.action === "split"
                                  ? null
                                  : (context.chapterId ?? null),
                            },
                          ],
                        ]
                      : [];
                  }),
                )
              }
              onScopeSelect={(id) => {
                if (project.chapters.some((c) => c.id === id)) setChapterId(id);
                else setVersionHistoryOpen(true);
              }}
              messages={ai.chat.messages}
              hasOlder={ai.hasOlder}
              olderLoading={ai.olderLoading}
              onLoadOlder={ai.loadOlder}
              streamingMessageId={
                ai.active
                  ? ai.chat.messages[ai.chat.messages.length - 1]?.id
                  : undefined
              }
              onReview={(reference) => void reviewResult(reference)}
              references={
                new Map(
                  (ai.snapshot?.messages ?? []).flatMap((m) =>
                    m.parts.parts.flatMap((p) =>
                      p.type === "tool" && p.result
                        ? [[p.id, p.result] as const]
                        : [],
                    ),
                  ),
                )
              }
            />
          </div>
          {ai.active ? (
            <div
              role="status"
              className="flex items-center justify-between border-t px-3 py-2 text-xs"
            >
              <Trans>正在分析或回复，离开页面仍会继续。</Trans>
              <Button size="sm" variant="ghost" onClick={() => void ai.stop()}>
                <Trans>停止</Trans>
              </Button>
            </div>
          ) : null}
          <div
            className={cn(
              "shrink-0 flex-col gap-2 border-t p-3",
              panel !== "inspector" ? "flex" : "hidden",
            )}
          >
            {needsModelConfirmation ? (
              <div
                role="alert"
                className="flex items-center gap-2 border-b px-3 py-2 text-xs"
              >
                <span className="min-w-0 flex-1">
                  <Trans>
                    模型配置已变化，确认后使用 {selectedModel?.name} 继续。
                  </Trans>
                  <span className="text-muted-foreground block break-all">
                    {selectedModel?.endpoint}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmedModel(modelBindingKey)}
                >
                  <Trans>确认使用</Trans>
                </Button>
              </div>
            ) : null}
            {reasoningFallback ? (
              <p role="status" className="text-muted-foreground text-xs">
                <Trans>所选模型不支持原思考档位，已跟随模型默认。</Trans>
              </p>
            ) : null}
            {!progress?.analyze &&
            ai.snapshot?.run &&
            ["failed", "interrupted", "cancelled"].includes(
              ai.snapshot.run.status,
            ) ? (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span>
                  <Trans>上次执行未完成，已有结果保留。</Trans>
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={
                    !selectedModel || ai.active || needsModelConfirmation
                  }
                  onClick={() =>
                    void ai.chat
                      .regenerate()
                      .catch(() => setOperationFailed(true))
                  }
                >
                  <Trans>重试</Trans>
                </Button>
              </div>
            ) : null}
            <p
              className="text-muted-foreground truncate text-xs"
              data-slot="assistant-context"
            >
              {ai.active ? t`运行目标` : t`当前章`} ·{" "}
              {ai.active
                ? contextTitle(
                    ai.snapshot?.run?.workspaceContext ?? {
                      action: "auto",
                      chapterId: null,
                    },
                  )
                : chapter.title}
            </p>
            {context ? (
              <div className="bg-muted/40 flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                <span className="min-w-0 flex-1 truncate" title={context.text}>
                  {
                    project.chapters.find((c) => c.id === context.chapterId)
                      ?.title
                  }{" "}
                  · {context.text}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setContext(null)}
                >
                  <Trans>移除引用</Trans>
                </Button>
              </div>
            ) : null}
            <SessionInput
              label={t`工程问题或补充说明`}
              placeholder={t`检查分章、分析人物、选角，或询问原文…`}
              value={draft}
              onChange={(value) =>
                setDrafts((old) => ({ ...old, [ai.sessionId]: value }))
              }
              disabled={!selectedModel || ai.loading || needsModelConfirmation}
              active={ai.active}
              onStop={ai.stop}
              onSend={async (text) => {
                const id = ai.sessionId;
                const sentContext = context;
                await ai.send(
                  context
                    ? `${text}\n\n${t`原文引用`} · ${project.chapters.find((c) => c.id === context.chapterId)?.title}（chapter_id=${context.chapterId}, ${context.line + 1}）：\n${context.text}`
                    : text,
                );
                setDrafts((old) =>
                  old[id] === text ? { ...old, [id]: "" } : old,
                );
                setContext((current) =>
                  current === sentContext ? null : current,
                );
              }}
              toolbar={
                <>
                  <ModelPicker
                    models={models}
                    value={selectedModel?.key ?? ""}
                    onValueChange={chooseModel}
                    label={t`下次请求使用的模型`}
                    onOpenSettings={() => openSettings("models")}
                  />
                  <ReasoningPicker
                    choices={effortChoices}
                    value={effectiveEffort}
                    onChange={chooseEffort}
                    label={t`思考强度`}
                  />
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t`上下文用量`}
                        />
                      }
                    >
                      <InfoIcon />
                    </PopoverTrigger>
                    <PopoverContent align="end">
                      <ContextUsage
                        snapshot={ai.snapshot}
                        configuration={configuration}
                      />
                    </PopoverContent>
                  </Popover>
                </>
              }
            />
          </div>
        </aside>
      </div>
      <Dialog
        open={visible && sessionHistoryOpen}
        onOpenChange={setSessionHistoryOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>会话历史</Trans>
            </DialogTitle>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {ai.sessions.map((session) => (
              <Button
                key={session.id}
                variant="ghost"
                className="justify-start truncate"
                onClick={() => {
                  if (session.taskKind === "project_assistant")
                    ai.selectSession(session.id);
                  else
                    void commands
                      .aiHistory(session.id, null, 20)
                      .then((page) => {
                        setLegacy(page);
                      })
                      .catch(() => setOperationFailed(true));
                  setSessionHistoryOpen(false);
                }}
              >
                {session.taskKind !== "project_assistant"
                  ? `${t`历史记录`} · ${session.chapterId ? (project.chapters.find((c) => c.id === session.chapterId)?.title ?? t`历史章节`) : t`全书结构`} · `
                  : ""}
                {session.title}
              </Button>
            ))}
            {ai.hasMoreSessions ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void ai.loadSessions()}
              >
                <Trans>读取更多</Trans>
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={visible && !!boundary}
        onOpenChange={(open) => {
          if (!open) setBoundary(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {boundary?.include ? t`从此行分章` : t`合并此章`}
          </DialogTitle>
          <p className="text-muted-foreground text-sm">
            <Trans>
              调整章节边界后，相关分析可能失效；历史与人工记录保留，不会自动迁移。
            </Trans>
          </p>
          <Button
            onClick={() => {
              if (!boundary) return;
              void commands
                .localProjectEdit(
                  project.id,
                  boundary.revision,
                  boundary.commandId,
                  {
                    kind: "boundary",
                    correction: {
                      sourceId: boundary.sourceId,
                      line: boundary.line,
                      include: boundary.include,
                      title: null,
                      volumeId: null,
                    },
                  },
                )
                .then(() => commands.localProjectSnapshot(project.id))
                .then((next) => {
                  changed(next);
                  setBoundary(null);
                })
                .catch(() => setOperationFailed(true));
            }}
          >
            <Trans>确认调整</Trans>
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={visible && !!splitReference}
        onOpenChange={(open) => {
          if (!open) setSplitReference(null);
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogTitle>
            <Trans>分章方案</Trans>
          </DialogTitle>
          {splitReference ? (
            <SplitProposal
              reference={splitReference}
              project={project}
              disabled={ai.active}
              onChange={changed}
              onLocate={locateSource}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={visible && !!legacy}
        onOpenChange={(open) => {
          if (!open) setLegacy(null);
        }}
      >
        <DialogContent className="flex h-[min(80vh,720px)] flex-col sm:max-w-2xl">
          <DialogTitle>{legacy?.session.title}</DialogTitle>
          <p className="text-muted-foreground text-xs">
            <Trans>历史会话只读。关闭后可在统一助手继续工作。</Trans>
          </p>
          <SessionMessages
            label={t`历史会话`}
            messages={
              legacy ? aiMessages(legacy.messages, t`历史记录读取失败`) : []
            }
            hasOlder={legacyBefore !== null}
            olderLoading={false}
            onLoadOlder={async () => {
              if (!legacy || legacyBefore === null) return false;
              const next = await commands.aiHistory(
                legacy.session.id,
                legacyBefore,
                20,
              );
              setLegacy((old) =>
                old?.session.id === next.session.id
                  ? {
                      ...old,
                      before: next.before,
                      messages: [...next.messages, ...old.messages],
                    }
                  : old,
              );
              return true;
            }}
            onReview={(r) => {
              setLegacy(null);
              void reviewResult(r);
            }}
          />
        </DialogContent>
      </Dialog>
      <VersionHistory
        open={visible && versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        projectId={project.id}
        chapters={project.chapters}
        characters={characters}
      />
    </main>
  );
}
