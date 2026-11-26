import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import {
  AlignJustifyIcon,
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FilterIcon,
  HistoryIcon,
  ListCollapseIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TagsIcon,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { BoundaryEditor } from "@/components/analysis/boundary-editor";
import {
  ManualAttributionDialog,
  type ManualAttributionRequest,
} from "@/components/analysis/manual-attribution-dialog";
import { VersionHistory } from "@/components/analysis/version-history";
import { AppState } from "@/components/app-state";
import { AgentWorkspace } from "@/components/assistant-ui/thread/agent-workspace";
import { ChapterAudioTaskCards } from "@/components/assistant-ui/thread/chapter-audio-task-cards";
import { SessionPalette } from "@/components/assistant-ui/thread/session-palette";
import { BindingRecovery } from "@/components/projects/binding-recovery";
import { ChapterAudioSettings } from "@/components/projects/chapter-audio-settings";
import { ChapterAudioTrack } from "@/components/projects/chapter-audio-track";
import { ChapterInspector } from "./chapter-inspector";
import { ChapterDirectory } from "@/components/projects/chapter-directory";
import { ChapterRecoveryNotices } from "./chapter-recovery-notices";
import { ChapterGenerationCheck } from "@/components/projects/chapter-generation-check";
import {
  type ChapterBoundaryRequest,
  ChapterStructureConfirm,
} from "@/components/projects/chapter-structure-confirm";
import { ChapterVoicePanel } from "@/components/projects/chapter-voice-panel";
import { CharacterCenter } from "@/components/projects/character-center";
import { PanelResizeHandle } from "@/components/projects/panel-resize-handle";
import {
  SourceActions,
  useSourceActions,
} from "@/components/projects/source-actions";
import { SplitProposal } from "@/components/projects/split-proposal";
import { StructureActions } from "@/components/projects/structure-actions";
import { StructureRecovery } from "@/components/chapter-structure/recovery";
import { usePauseNavigationGuard } from "@/components/projects/use-pause-navigation-guard";
import { useWorkspaceAssistant } from "@/components/projects/use-workspace-assistant";
import { useWorkspaceChapterAudio } from "@/components/projects/use-workspace-chapter-audio";
import {
  useReadingHandoff,
  useWorkspaceReading,
} from "@/components/projects/use-workspace-reading";
import { VirtualSourceReader } from "@/components/projects/virtual-source-reader";
import { useWorkspacePaneGeometry } from "./use-workspace-pane-geometry";
import { useWorkspacePanes } from "./use-workspace-panes";
import { WorkspaceSourceLine } from "./workspace-source-line";
import { WorkspaceAssistantComposer } from "./workspace-assistant-composer";
import { useWorkspaceMode } from "@/components/projects/workspace-mode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useWorkspaceChrome } from "@/components/workspace-chrome";
import { useChapterAnalysis } from "@/hooks/use-chapter-analysis";
import { useChapterAnalysisIssues } from "@/hooks/use-chapter-analysis-issues";
import { useSegmentEditDrafts } from "@/hooks/use-segment-edit-drafts";
import { activeRun } from "@/lib/ai";
import {
  type AnalysisSnapshot,
  type ByteRange,
  commands,
  type LocalProjectSnapshot_Serialize,
  type Progress,
  type ResultReference,
  type Segment,
} from "@/lib/bindings";
import { CandidateOperationRegistry } from "@/lib/candidate-operations";
import {
  type AudioTaskTarget,
  type ChapterWorkflow,
  chapterWorkflow,
} from "@/lib/chapter-workflow";
import { useDesktopSession, useWorkspaceState } from "@/lib/desktop-session";
import {
  chapterAtByte,
  chapterLineIndex,
} from "@/lib/projects/chapter-reading";
import { structureOperations } from "@/lib/structure-operation";
import { cn } from "@/lib/utils";
import { useWorkspaceReader } from "@/lib/workspace/reader";

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
  onPointerDown,
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
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
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
            onPointerDown={onPointerDown}
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
  const navigate = useNavigate();
  const reader = useWorkspaceReader();
  const workspaceMounted = useRef(false);
  useEffect(() => {
    workspaceMounted.current = true;
    return () => {
      workspaceMounted.current = false;
    };
  }, []);
  const audioDialogHeading = useRef<HTMLHeadingElement>(null);
  const chapterAudioFooter = useRef<HTMLDivElement>(null);
  const { openSettings, workspace } = useDesktopSession();
  const structure = useMemo(
    () => structureOperations(workspace(project.id)),
    [project.id, workspace],
  );
  const structureOperation = useSyncExternalStore(
    structure.subscribe,
    structure.snapshot,
    structure.snapshot,
  );
  const chrome = useWorkspaceChrome();
  const mode = useWorkspaceMode();
  const visible = mode?.active ?? true;
  const {
    panelId,
    directoryButton,
    assistantButton,
    propertiesButton,
    inspectorPanel,
    small,
    inspectorOpen,
    setInspectorOpen,
    setDirectoryOpen,
    directoryWidth,
    setDirectoryWidth,
    inspectorWidth,
    setInspectorWidth,
    panel,
    setPanel,
    setCharacterAssistantOpen,
    inCharacterCenter,
    rightView,
    directoryVisible,
    inspectorVisible,
    directoryColumnOpen,
    assistantColumnOpen,
    rememberInspectorFocus,
    toggleDirectory,
    openAssistant,
    toggleRightView: togglePaneView,
  } = useWorkspacePanes(project.id, visible, reader.readOnly);
  const [chapterId, setChapterIdValue] = useWorkspaceState(
    project.id,
    "chapterId",
    project.chapters[0].id,
  );
  const chapter =
    project.chapters.find((c) => c.id === chapterId) ?? project.chapters[0];
  const index = project.chapters.indexOf(chapter);
  const source = project.sources.find((s) => s.id === chapter.sourceId);
  const [display, setDisplay] = useWorkspaceState<"compact" | "original">(
    project.id,
    "analysisDisplay",
    "compact",
  );
  const [castReviewRunId, setCastReviewRunId] = useState<string | null>(null);
  const [castReviewRequest, setCastReviewRequest] = useState(0);
  // In-card design drafts open the character center dialog prefilled; the
  // center reads these on `castDesignRequest` changes.
  const [castDesign, setCastDesign] = useState<{
    target: import("@/lib/bindings").BindingTarget;
    draft: import("@/lib/bindings").DesignDraft;
  } | null>(null);
  const [castDesignRequest, setCastDesignRequest] = useState(0);
  const [editRequest, setEditRequest] = useState<{
    chapter: (typeof project.chapters)[number];
    onHandled: () => void;
  }>();
  const [splitReference, setSplitReference] = useState<ResultReference | null>(
    null,
  );
  const [boundary, setBoundary] = useState<ChapterBoundaryRequest | null>(null);
  const boundaryProject = useRef(project);
  boundaryProject.current = project;
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const candidateOperations = useMemo(() => {
    const values = workspace(project.id);
    if (!(values.candidateOperations instanceof CandidateOperationRegistry))
      values.candidateOperations = new CandidateOperationRegistry();
    return values.candidateOperations as CandidateOperationRegistry;
  }, [project.id, workspace]);
  useSyncExternalStore(
    candidateOperations.subscribe,
    candidateOperations.snapshot,
    candidateOperations.snapshot,
  );
  const pendingCandidateOperations = Array.from(
    candidateOperations.entries.values(),
  );
  const [pauseContainer, setPauseContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const [pauseObject, setPauseObject] = useState<number | null>(null);
  const [analysisBoundary, setAnalysisBoundary] = useState<{
    chapterId: string;
    segment: Segment;
    snapshot: AnalysisSnapshot;
  } | null>(null);
  const showPauseInspector = useCallback(() => {
    setPanel("inspector");
    setInspectorOpen(true);
  }, [setInspectorOpen, setPanel]);
  const {
    afterPauseExit,
    pauseExitGuard,
    pauseOperationGuard,
    pauseDirtyGuard,
    boundaryOperationPending,
  } = usePauseNavigationGuard(project.id, showPauseInspector);
  const setChapterId = useCallback(
    (id: string) => {
      if (id !== chapterId) void afterPauseExit(() => setChapterIdValue(id));
    },
    [afterPauseExit, chapterId, setChapterIdValue],
  );
  const choosePause = useCallback(
    (index: number | null) => {
      const select = () => {
        setPauseObject(index);
        if (index != null) {
          setPanel("inspector");
          setInspectorOpen(true);
        }
      };
      if (index === pauseObject) {
        select();
        return Promise.resolve(true);
      }
      return afterPauseExit(select);
    },
    [afterPauseExit, pauseObject, setInspectorOpen, setPanel],
  );
  const [selected, setSelected] = useState<Segment | null>(null);
  const [evidence, setEvidence] = useState<{
    chapterId: string;
    range: { start: number; end: number };
  } | null>(null);
  const [operationFailed, setOperationFailed] = useState(false);
  const analysisStarting = useRef(false);
  const pendingReanalysis = useRef<string | null>(null);
  const {
    viewport,
    reading,
    locatedLine,
    setLocatedLine,
    targetLine,
    targetOffset,
    reloadKey,
    jumpToLine,
  } = useWorkspaceReading(project.chapters, chapter);
  const analysis = useChapterAnalysis(project.id, chapter.id);
  const segmentEdits = useSegmentEditDrafts(project.id);
  const inspectedSegment =
    analysis.segments.find((segment) => segment.id === selected?.id) ??
    selected;
  const attributionPending = !!(
    inspectedSegment &&
    segmentEdits.states[`${project.id}:${chapter.id}:${inspectedSegment.id}`]
      ?.draft
  );
  const pendingSegmentEdits = Object.values(segmentEdits.states).filter(
    (state) =>
      state.target && (state.status === "saving" || state.status === "failed"),
  );
  const snapshot = analysis.data?.snapshot ?? null;
  const currentAnalysis =
    snapshot?.binding.chapterId === chapter.id ? snapshot : null;
  const analysisVersion = currentAnalysis?.stale
    ? null
    : currentAnalysis?.versionId;
  const [manualAttribution, setManualAttribution] =
    useWorkspaceState<ManualAttributionRequest | null>(
      project.id,
      `manual-attribution-request:${chapter.id}`,
      null,
    );
  const selectionRequest = useRef(0);
  async function assignSelection(range: ByteRange): Promise<void> {
    if (!currentAnalysis || currentAnalysis.stale || reader.readOnly) return;
    const { binding: source, revision, versionId } = currentAnalysis;
    if (range.start < source.start || range.end > source.end) return;
    const requestId = ++selectionRequest.current;
    const isCurrent = () =>
      workspaceMounted.current &&
      currentChapter.current === chapter.id &&
      selectionRequest.current === requestId;

    try {
      const excerpt = await commands.chapterAnalysisExcerpt(
        project.id,
        chapter.id,
        range,
      );
      if (!isCurrent() || !excerpt.text.trim()) return;
      const existing = versionId
        ? await commands.chapterAnalysisSegments(
            project.id,
            versionId,
            range,
            null,
          )
        : null;
      if (!isCurrent()) return;
      const next: ManualAttributionRequest = {
        kind: "assign",
        source,
        revision,
        range,
        text: excerpt.text,
        replacesAttribution:
          existing?.segments.some((segment) => segment.kind !== "unassigned") ??
          false,
      };
      setManualAttribution((open) =>
        open?.source.chapterId === chapter.id ? open : next,
      );
    } catch {
      if (isCurrent()) setOperationFailed(true);
    }
  }

  const {
    audio,
    audioMode,
    selectedAudioMode,
    setAudioMode,
    setNarratorVoice,
    currentNarrator,
    player,
    returnTarget,
    requestReturn,
    clearReturn,
    segmentPlayback,
    activeAudioDialog,
    audioDialogTrigger,
    setAudioDialog,
    showAudioDialog,
    openChapterAudioSettings,
    closeAudioDialogFor,
    startChapterAudio,
  } = useWorkspaceChapterAudio({
    project,
    chapterId: chapter.id,
    visible,
    readOnly: reader.readOnly,
    analysisVersion,
    analysisRevision: currentAnalysis?.revision,
    afterPauseExit,
    isCurrentChapter: () =>
      workspaceMounted.current && currentChapter.current === chapter.id,
  });
  const characters = analysis.data?.characters ?? [];
  const assistant = useWorkspaceAssistant({
    project,
    chapterId: chapter.id,
    readOnly: reader.readOnly,
    prepareRevision: async () => {
      const fresh = await reader.localProjectSnapshot(project.id);
      setProject(fresh);
      return fresh.revision;
    },
  });
  const { ai, selectedModel, needsModelConfirmation } = assistant;
  const [references, setReferences] = useWorkspaceState<
    Record<string, { chapterId: string; line: number; text: string }>
  >(project.id, "assistantReferences", {});
  const context = references[ai.sessionId];
  const contextTitleForDraft = context
    ? (project.chapters.find((entry) => entry.id === context.chapterId)
        ?.title ?? t`原文引用`)
    : "";
  function clearReference(sessionId: string, reference: typeof context) {
    setReferences((current) => {
      if (current[sessionId] !== reference) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }
  const [progress, setProgress] = useState<Progress | null>(null);
  const runId = ai.snapshot?.run?.id;
  const subagentRunId = ai.snapshot?.invocations.find(
    (task) => task.runId === runId && task.name === "chapter_analysis",
  )?.id;
  const runSequence = ai.snapshot?.session.sequence;
  useEffect(() => {
    let live = true;
    if (!runId || !subagentRunId || panel !== "inspector") {
      setProgress(null);
      return;
    }
    void runSequence;
    void commands
      .chapterAnalysisProgress(runId, subagentRunId)
      .then((value) => {
        if (live) setProgress(value);
      })
      .catch(() => {
        if (live) setProgress(null);
      });
    return () => {
      live = false;
    };
  }, [panel, runId, subagentRunId, runSequence]);
  const issues = useChapterAnalysisIssues(
    project.id,
    null,
    snapshot?.revision ?? 0,
    "",
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
  const sourceActions = useSourceActions(
    viewport,
    chapter.id,
    visible && !reader.readOnly && panel !== "characters",
  );
  const [showRoles, setShowRoles] = useWorkspaceState(
    project.id,
    "showSourceRoles",
    false,
  );
  const resultId = ai.snapshot?.records
    .flatMap((record) => record.results)
    .map((reference) => reference.id)
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
    setAudioDialog(null);
    setCandidateId(
      pendingResult.current?.chapterId === chapter.id
        ? pendingResult.current.candidateId
        : null,
    );
    pendingResult.current = null;
    setLocatedLine(reading.startLine);
    jumpToLine(reading.startLine, 44);
    if (pending) {
      pendingIssue.current = null;
      void commands
        .chapterAnalysisExcerpt(project.id, chapter.id, pending.segment.range)
        .then((e) => {
          if (currentChapter.current === chapter.id) {
            jumpToLine(e.line);
          }
        })
        .catch(() => setOperationFailed(true));
    }
  }, [chapter.id, reading.startLine]);
  const rememberLocation = useReadingHandoff({
    visible,
    location: mode?.location ?? null,
    chapters: project.chapters,
    chapter,
    readingStart: reading.startLine,
    selectChapter: setChapterId,
    jumpToLine,
    setLocatedLine,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: Structure commits must refresh host-owned validity even if the chapter identity survived.
  useEffect(() => {
    if (visible) void analysis.reload().catch(() => {});
  }, [visible, project.revision, analysis.reload]);
  const charactersRequest = mode?.charactersRequest ?? 0;
  const chaptersRequest = mode?.chaptersRequest ?? 0;
  useEffect(() => {
    if (charactersRequest) {
      setCastReviewRunId(null);
      setPanel("characters");
    }
  }, [charactersRequest, setPanel]);
  useEffect(() => {
    if (chaptersRequest)
      setPanel((current) => (current === "characters" ? "assistant" : current));
  }, [chaptersRequest, setPanel]);
  const saved = useCallback(
    async (minimumRevision?: number) => {
      // A completed command for the previous chapter must not reload into a new scope.
      if (!workspaceMounted.current || currentChapter.current !== chapter.id)
        throw new Error("chapter_changed");
      await analysis.reload(minimumRevision);
      if (!workspaceMounted.current || currentChapter.current !== chapter.id)
        throw new Error("chapter_changed");
      await audio.refresh();
      if (!workspaceMounted.current || currentChapter.current !== chapter.id)
        throw new Error("chapter_changed");
      setCandidateId(null);
    },
    [analysis.reload, audio.refresh, chapter.id],
  );
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
        jumpToLine(excerpt.line);
      } catch {
        setOperationFailed(true);
      }
    },
    [project.id, chapter.id, jumpToLine],
  );
  useEffect(() => {
    if (!returnTarget || returnTarget.projectId !== project.id) return;
    if (!project.chapters.some((item) => item.id === returnTarget.chapterId)) {
      setOperationFailed(true);
      clearReturn(returnTarget.id);
      return;
    }
    if (returnTarget.chapterId !== chapter.id) {
      void afterPauseExit(() => setChapterIdValue(returnTarget.chapterId));
      return;
    }
    void locate(returnTarget.range).then(() => clearReturn(returnTarget.id));
  }, [
    returnTarget,
    project.id,
    project.chapters,
    chapter.id,
    afterPauseExit,
    setChapterIdValue,
    locate,
    clearReturn,
  ]);
  const choose = (s: Segment, edit = true) => {
    void afterPauseExit(() => {
      setPauseObject(null);
      setEvidence(null);
      setSelected(s);
      setCandidateId(null);
      if (!edit && panel === "assistant" && inspectorOpen) return;
      setPanel("inspector");
      setInspectorOpen(true);
      if (small) setDirectoryOpen(false);
    });
  };
  const headerTarget = chrome?.leading;
  const {
    paneLayout,
    readerLayout,
    directoryColumn,
    assistantColumn,
    maxInspectorWidth,
    visibleInspectorWidth,
    headerGeometry,
  } = useWorkspacePaneGeometry({
    inCharacterCenter,
    small,
    directoryColumnOpen,
    directoryWidth,
    inspectorWidth,
    headerTarget,
    readOnly: reader.readOnly,
    visible,
  });

  function locateAudioSegment(
    range: { start: number; end: number },
    focusInspector = false,
  ) {
    void afterPauseExit(() => {
      setPauseObject(null);
      void (async () => {
        const containsStart = (segment: Segment) =>
          segment.range.start <= range.start && range.start < segment.range.end;
        let segment = analysis.segments.find(containsStart);
        if (!segment && snapshot?.versionId) {
          const page = await commands.chapterAnalysisSegments(
            project.id,
            snapshot.versionId,
            range,
            null,
          );
          segment = page.segments.find(containsStart);
        }
        if (currentChapter.current !== chapter.id) return;
        if (segment) choose(segment);
        await locate(range);
        if (focusInspector && currentChapter.current === chapter.id)
          inspectorPanel.current
            ?.querySelector<HTMLElement>("h2")
            ?.focus({ preventScroll: true });
      })().catch(() => setOperationFailed(true));
    });
  }

  const leading = (
    <IconAction
      label={t`目录`}
      hint={directoryVisible ? t`收起目录` : t`显示目录`}
      expanded={directoryVisible}
      controls={`${panelId}-directory`}
      buttonRef={directoryButton}
      onPointerDown={() => {
        if (small && !directoryVisible) rememberInspectorFocus();
      }}
      onClick={toggleDirectory}
      pressed={directoryVisible}
    >
      {directoryVisible ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
    </IconAction>
  );
  function toggleRightView(next: "assistant" | "inspector") {
    void afterPauseExit(() => togglePaneView(next));
  }
  const trailing = !reader.readOnly && (
    <div className="flex items-center gap-1">
      <IconAction
        label={t({
          comment: "Top toolbar toggle for the AI chat sidebar",
          message: "AI 助手",
        })}
        buttonRef={assistantButton}
        expanded={rightView === "assistant" && assistantColumnOpen}
        controls={`${panelId}-assistant`}
        onClick={() => toggleRightView("assistant")}
        pressed={rightView === "assistant" && assistantColumnOpen}
      >
        <SparklesIcon />
      </IconAction>
      <IconAction
        label={t({
          comment:
            "Top toolbar toggle for the selected text or audio segment inspector",
          message: "片段属性",
        })}
        buttonRef={propertiesButton}
        expanded={panel === "inspector" && inspectorVisible}
        controls={`${panelId}-assistant`}
        onClick={() => toggleRightView("inspector")}
        pressed={panel === "inspector" && inspectorVisible}
      >
        <SlidersHorizontalIcon />
      </IconAction>
    </div>
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
        rememberLocation(location);
        setChapterId(nextChapter.id);
      } else {
        jumpToLine(location.line, location.offset);
      }
    }
    setProject(next);
    onChange?.(next);
    setSelected(null);
    setCandidateId(null);
    setEvidence(null);
  }
  function locateSource(sourceId: string, line: number) {
    void reader
      .localProjectText(project.id, sourceId, line, 1)
      .then((page) => {
        const row = page.lines[0];
        if (!row) return;
        const target = chapterAtByte(project.chapters, sourceId, row.start);
        if (!target) return;
        if (target.id !== chapter.id) {
          rememberLocation({
            sourceId,
            chapterId: target.id,
            byte: row.start,
            line,
            offset: 44,
          });
          setChapterId(target.id);
        } else {
          jumpToLine(line);
        }
        setLocatedLine(line);
      })
      .catch(() => setOperationFailed(true));
  }
  const [reviewReturn, setReviewReturn] = useState<{
    sessionId: string;
    fromCharacterCenter: boolean;
    chapterId: string;
    line: number;
    byte: number;
    offset: number;
    trigger: HTMLElement | null;
  } | null>(null);
  function rememberReview() {
    const top = viewport.current?.getBoundingClientRect().top ?? 0;
    const row = Array.from(
      viewport.current?.querySelectorAll<HTMLElement>("[data-source-row]") ??
        [],
    ).find((item) => item.getBoundingClientRect().bottom > top);
    setReviewReturn({
      sessionId: ai.sessionId,
      fromCharacterCenter: inCharacterCenter,
      chapterId: chapter.id,
      line: row ? Number(row.dataset.sourceRow) : reading.startLine,
      byte: row ? Number(row.dataset.sourceByte) : chapter.start,
      offset: row ? row.getBoundingClientRect().top - top : 44,
      trigger:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    });
  }
  function returnToAssistant() {
    const bookmark = reviewReturn;
    setReviewReturn(null);
    if (bookmark?.fromCharacterCenter) {
      setPanel("characters");
      setCharacterAssistantOpen(true);
    } else {
      setPanel("assistant");
      setInspectorOpen(true);
    }
    if (!bookmark || bookmark.sessionId !== ai.sessionId) return;
    const target = project.chapters.find(
      (item) => item.id === bookmark.chapterId,
    );
    if (target && !bookmark.fromCharacterCenter) {
      if (target.id !== chapter.id) {
        rememberLocation({ sourceId: target.sourceId, ...bookmark });
        setChapterId(target.id);
      } else {
        jumpToLine(bookmark.line, bookmark.offset);
        setLocatedLine(bookmark.line);
      }
    }
    requestAnimationFrame(() => {
      if (bookmark.trigger?.isConnected) {
        bookmark.trigger.scrollIntoView({ block: "nearest" });
        bookmark.trigger.focus({ preventScroll: true });
      }
    });
  }
  async function reviewResult(reference: ResultReference) {
    if (reference.kind === "chapter_split_proposal") {
      setSplitReference(reference);
      return;
    }
    if (reference.kind === "casting_suggestion") {
      rememberReview();
      setCastReviewRunId(reference.id);
      setPanel("characters");
      setInspectorOpen(true);
      if (small) setDirectoryOpen(false);
      setCastReviewRequest((n) => n + 1);
      return;
    }
    if (reference.kind !== "chapter_analysis") return;
    rememberReview();
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
  const inspectedRange =
    evidence?.chapterId === chapter.id ? evidence.range : selected?.range;
  const chapterAtLine = useMemo(
    () => chapterLineIndex(project.chapters),
    [project.chapters],
  );
  const structuralIssues = project.issues.map((i, n) => ({
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
    chapterTitle: chapterAtLine(i.sourceId, i.line)?.title ?? "",
    detail: undefined,
    filename: project.sources.find((s) => s.id === i.sourceId)?.filename ?? "",
  }));

  function sourceBoundary(line: number) {
    const isHeading = project.chapters.some(
      (item) => item.sourceId === chapter.sourceId && item.heading === line,
    );
    return {
      label: isHeading ? t`合并此章` : t`从此行分章`,
      disabled:
        ai.active ||
        !!structureOperation ||
        line < reading.startLine ||
        (reading.endLine !== null && line >= reading.endLine),
      run: () =>
        void afterPauseExit(() => {
          setBoundary({
            projectId: project.id,
            projectTitle: project.title,
            chapterTitle: chapter.title,
            filename: source?.filename ?? "",
            line,
            include: !isHeading,
            revision: project.revision,
            sourceId: chapter.sourceId,
            commandId: crypto.randomUUID(),
          });
        }),
    };
  }
  function openSourceLine(line: number, anchor: HTMLElement) {
    setLocatedLine(line);
    if (!reader.readOnly) sourceActions.show({ kind: "line", anchor, line });
  }
  const chapterTitle = panel !== "characters" && (
    <StructureActions
      project={project}
      chapter={chapter}
      line={locatedLine}
      active={ai.active}
      readOnly={reader.readOnly}
      onChange={changed}
      onLocate={locateSource}
      onAddSources={onAddSources}
      editRequest={editRequest}
      onUndoAttribution={
        snapshot?.canUndo && !snapshot.stale
          ? () =>
              setManualAttribution({
                kind: "undo",
                source: snapshot.binding,
                revision: snapshot.revision,
              })
          : undefined
      }
      sourceStatus={
        snapshot?.stale
          ? t`分析已失效`
          : snapshot?.versionId
            ? snapshot.unassignedCount > 0
              ? t`部分已标注`
              : t`已保存初稿`
            : t`尚未分析`
      }
      onSourceChange={(sourceId) => {
        const target = project.chapters.find(
          (item) => item.sourceId === sourceId,
        );
        if (target) setChapterId(target.id);
      }}
      deferProposalResult={!!splitReference}
    />
  );
  const chapterActions = panel !== "characters" && (
    <div
      data-slot="chapter-toolbar"
      className="flex shrink-0 flex-wrap items-center gap-1"
    >
      <IconAction
        label={t`上一章`}
        disabled={index === 0}
        onClick={() => setChapterId(project.chapters[index - 1].id)}
      >
        <ChevronLeftIcon />
      </IconAction>
      <IconAction
        label={t`下一章`}
        disabled={index + 1 === project.chapters.length}
        onClick={() => setChapterId(project.chapters[index + 1].id)}
      >
        <ChevronRightIcon />
      </IconAction>
      {snapshot?.versionId && !snapshot.stale && (
        <IconAction
          label={t({
            comment:
              "Reader toolbar toggle for speaker markers in the original text",
            message: "显示角色标记",
          })}
          pressed={showRoles}
          onClick={() => setShowRoles(!showRoles)}
        >
          <TagsIcon />
        </IconAction>
      )}
      {
        <IconAction
          label={display === "compact" ? t`切换为原样显示` : t`切换为紧凑显示`}
          pressed={display === "compact"}
          onClick={() =>
            setDisplay(display === "compact" ? "original" : "compact")
          }
        >
          {display === "compact" ? <ListCollapseIcon /> : <AlignJustifyIcon />}
        </IconAction>
      }
    </div>
  );
  const analysisUnavailable =
    ai.active ||
    ai.loading ||
    ai.readFailure ||
    !selectedModel ||
    needsModelConfirmation;
  function runChapterAnalysis() {
    if (analysisUnavailable || analysisStarting.current) return;
    analysisStarting.current = true;
    openAssistant();
    setOperationFailed(false);
    void ai
      .send(t`分析本章`, true)
      .catch(() => setOperationFailed(true))
      .finally(() => {
        analysisStarting.current = false;
      });
  }
  const runPendingReanalysis = useEffectEvent((chapterId: string) => {
    if (pendingReanalysis.current !== chapterId) return;
    pendingReanalysis.current = null;
    runChapterAnalysis();
  });
  useEffect(() => {
    runPendingReanalysis(chapter.id);
  }, [chapter.id]);
  function reanalyzeChapter(targetId: string) {
    if (analysisUnavailable || analysisStarting.current) return;
    if (targetId === chapter.id) {
      runChapterAnalysis();
    } else if (project.chapters.some((item) => item.id === targetId)) {
      pendingReanalysis.current = targetId;
      setChapterId(targetId);
    }
  }
  const chapterSuggestions = (
    <div data-slot="chapter-suggestions" className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={analysisUnavailable}
        onClick={() => {
          void ai
            .send(t`请检查全书分章结构，提出可审阅的修复方案。`, "split")
            .catch(() => setOperationFailed(true));
        }}
      >
        <FilterIcon />
        <Trans>检查分章</Trans>
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={analysisUnavailable}
        data-action="analyze-chapter"
        title={
          snapshot?.versionId && snapshot.humanRevision > 0
            ? t`重新分析可能更新已有人工归属，完成后可撤回。`
            : undefined
        }
        onClick={runChapterAnalysis}
      >
        <SparklesIcon />
        {snapshot?.versionId ? (
          <Trans>重新分析</Trans>
        ) : (
          <Trans>分析本章角色</Trans>
        )}
      </Button>
    </div>
  );
  const [assistantToolsOpen, setAssistantToolsOpen] = useState(false);
  const assistantTasksTrigger = useRef<HTMLButtonElement>(null);
  const workspaceHeader = (
    <div className="flex h-full min-w-0 items-center">
      <div
        data-slot="directory-header"
        className="relative flex h-full shrink-0 items-center"
        style={{
          width: headerTarget
            ? headerGeometry.directory || undefined
            : undefined,
        }}
      >
        {leading}
        <div data-tauri-drag-region="" className="h-full flex-1" />
      </div>
      {headerGeometry.directory > 0 && headerTarget && (
        <span
          aria-hidden
          data-slot="directory-header-divider"
          className="h-4 w-px shrink-0 bg-border"
        />
      )}
      <div
        data-slot="reader-header"
        className="flex h-full min-w-0 flex-1 items-center gap-1 px-1.5"
      >
        {chapterTitle}
        {!reader.readOnly &&
          panel !== "characters" &&
          snapshot?.versionId &&
          !snapshot.stale &&
          snapshot.unassignedCount > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">
              <Trans>部分已标注</Trans>
            </span>
          )}
        {reader.readOnly && panel !== "characters" && (
          <span className="shrink-0 text-xs text-muted-foreground">
            <Trans>只读预览</Trans>
          </span>
        )}
        <div data-tauri-drag-region="" className="h-full min-w-1 flex-1" />
        {headerGeometry.reader > 0 &&
        headerGeometry.reader < 300 &&
        chapterActions ? (
          <Popover>
            <PopoverTrigger
              render={<Button size="icon-sm" variant="ghost" />}
              aria-label={t`原文工具`}
              title={t`原文工具`}
            >
              <EllipsisIcon />
            </PopoverTrigger>
            <PopoverContent align="end">{chapterActions}</PopoverContent>
          </Popover>
        ) : (
          chapterActions
        )}
      </div>
      {headerGeometry.assistant > 0 && headerTarget && (
        <span
          aria-hidden
          data-slot="assistant-header-divider"
          className="h-4 w-px shrink-0 bg-border"
        />
      )}
      {trailing && (
        <div
          data-slot="assistant-header"
          className="flex h-full shrink-0 items-center justify-end pr-2"
          style={{
            width: headerTarget
              ? headerGeometry.assistant || undefined
              : undefined,
          }}
        >
          <div data-tauri-drag-region="" className="h-full flex-1" />
          {trailing}
        </div>
      )}
    </div>
  );
  const structureRequest = structureOperation?.request;
  const recoveryInAssistant =
    assistantColumnOpen &&
    rightView === "assistant" &&
    structureRequest?.kind === "proposal" &&
    structureRequest.surface === "assistant" &&
    ai.snapshot?.records.some((record) =>
      [...record.results, ...Object.values(record.tools)].some(
        (result) =>
          result.kind === "chapter_split_proposal" &&
          result.id === structureRequest.proposalId,
      ),
    );
  const [seenTask, setSeenTask] = useWorkspaceState<string | null>(
    project.id,
    `workflowSeenTask:${ai.sessionId}`,
    null,
  );
  const workflowRun = ai.snapshot?.run;
  const workflowChapter = project.chapters.find(
    ({ id }) => id === workflowRun?.workspaceContext?.chapterId,
  );
  const workflowRunActive =
    activeRun(workflowRun) || workflowRun?.status === "waiting_for_input";
  const finishedWorkflowRun =
    workflowRun?.workspaceContext?.action === "analyze" && !workflowRunActive;
  useEffect(() => {
    if (
      finishedWorkflowRun &&
      workflowChapter?.id === chapter.id &&
      workflowRun.id !== seenTask
    )
      setSeenTask(workflowRun.id);
  }, [
    finishedWorkflowRun,
    workflowChapter?.id,
    chapter.id,
    workflowRun?.id,
    seenTask,
    setSeenTask,
  ]);
  // Keep the return target when the host stops exposing a finished run as active.
  const [audioReturn, setAudioReturn] =
    useWorkspaceState<AudioTaskTarget | null>(
      project.id,
      "workflowAudioReturn",
      null,
    );
  const activeAudio = audio.active;
  const elsewhere = (target: AudioTaskTarget) =>
    target.chapterId !== chapter.id || target.mode !== audioMode;
  const audioKeepTarget = !!activeAudio && elsewhere(activeAudio);
  const audioClearTarget =
    !!audioReturn &&
    (!elsewhere(audioReturn) ||
      !project.chapters.some(({ id }) => id === audioReturn.chapterId));
  useEffect(() => {
    if (audioKeepTarget && activeAudio) {
      const { projectId, chapterId, chapterTitle, mode } = activeAudio;
      if (
        chapterId !== audioReturn?.chapterId ||
        chapterTitle !== audioReturn.chapterTitle ||
        mode !== audioReturn.mode
      )
        setAudioReturn({ projectId, chapterId, chapterTitle, mode });
    } else if (audioClearTarget) {
      setAudioReturn(null);
    }
  }, [
    activeAudio,
    audioReturn,
    audioKeepTarget,
    audioClearTarget,
    setAudioReturn,
  ]);
  const workflow = chapterWorkflow({
    chapterId: chapter.id,
    mode: audio.mode,
    audioActive: !!audio.active,
    audioReturn: audioClearTarget ? null : audioReturn,
    assistant:
      workflowRun &&
      workflowChapter &&
      (workflowRunActive ||
        (finishedWorkflowRun &&
          workflowChapter.id !== chapter.id &&
          seenTask !== workflowRun.id))
        ? {
            run: workflowRun,
            title: workflowChapter.title,
            chapterId: workflowChapter.id,
          }
        : null,
  });

  function showAudioRun(run: AudioTaskTarget, fromAssistant = false) {
    if (
      run.projectId !== project.id ||
      !project.chapters.some(({ id }) => id === run.chapterId)
    )
      return;
    void afterPauseExit(() => {
      if (run.chapterId === chapter.id) setAudioMode(run.mode);
      else {
        workspace(project.id)[`chapterAudioMode:${run.chapterId}`] = run.mode;
        setChapterIdValue(run.chapterId);
      }
      if (fromAssistant) {
        if (inCharacterCenter) {
          setPanel("inspector");
          setCharacterAssistantOpen(false);
        }
        setInspectorOpen(false);
        requestAnimationFrame(() => assistantButton.current?.focus());
      }
    });
  }

  function showWorkflowAssistant(chapterId: string) {
    void afterPauseExit(() => {
      if (chapterId !== chapter.id) setChapterIdValue(chapterId);
      openAssistant();
      requestAnimationFrame(() =>
        inspectorPanel.current
          ?.querySelector<HTMLElement>("h2")
          ?.focus({ preventScroll: true }),
      );
    });
  }

  function analyzeForProduction() {
    if (!selectedModel) openSettings("models");
    else if (needsModelConfirmation) showWorkflowAssistant(chapter.id);
    else runChapterAnalysis();
  }

  const audioSettingsProps = {
    projectId: project.id,
    chapterId: chapter.id,
    mode: audioMode,
    narrator: currentNarrator,
    busy: !!audio.active || audio.starting,
    analysisReady: !!analysisVersion,
    analysisBusy: !!selectedModel && analysisUnavailable,
    needsAnalysisModel: !selectedModel,
    onMode: (value: typeof audioMode) => setAudioMode(value),
    onNarrator: setNarratorVoice,
    onAnalyze: analyzeForProduction,
    onRegenerate:
      !audio.checking &&
      !audio.blockers &&
      audio.status &&
      !audio.active &&
      (!audio.restartRequired || audio.status.run.status === "succeeded") &&
      (audioMode !== "narrator" || currentNarrator)
        ? () => closeAudioDialogFor(() => startChapterAudio(true))
        : undefined,
  };

  function renderWorkflowAction(step: ChapterWorkflow) {
    let label: string;
    let target: string | undefined;
    let onClick: () => void;
    switch (step.kind) {
      case "assistant_task": {
        const id = step.run.workspaceContext?.chapterId;
        if (!id || !project.chapters.some((chapter) => chapter.id === id))
          return null;
        label = step.elsewhere ? t`返回原任务` : t`查看助手任务`;
        target = step.elsewhere ? step.title : undefined;
        onClick = () => showWorkflowAssistant(id);
        break;
      }
      case "audio_return":
        label = t`返回原任务`;
        target = step.target.chapterTitle;
        onClick = () => showAudioRun(step.target);
        break;
    }
    return (
      <div className="flex min-w-0 items-center">
        <Button
          size="xs"
          variant="ghost"
          className="max-w-full"
          title={target ? `${label} · ${target}` : label}
          onClick={onClick}
        >
          <span className="truncate">{label}</span>
        </Button>
      </div>
    );
  }

  function revealInspector() {
    setPanel("inspector");
    setInspectorOpen(true);
    if (small) setDirectoryOpen(false);
  }

  const chapterNotices = (
    <>
      {visible && !reader.readOnly && (
        <BindingRecovery
          projectId={project.id}
          characters={characters}
          display={activeAudioDialog !== "check"}
          onIdentityReconciled={() =>
            void saved().catch(() => setOperationFailed(true))
          }
          onReconciled={(snapshot) => {
            if (
              snapshot.project.id === boundaryProject.current.id &&
              snapshot.project.revision >= boundaryProject.current.revision
            ) {
              boundaryProject.current = snapshot.project;
              setProject(snapshot.project);
              onChange?.(snapshot.project);
            }
            const capturedChapter = chapter.id;
            void (async () => {
              if (
                audio.blockers ||
                (audio.mode === "multi_role" &&
                  analysisVersion &&
                  !audio.active)
              )
                await audio.check();
              if (currentChapter.current === capturedChapter)
                await audio.refresh();
            })().catch(() => setOperationFailed(true));
          }}
        />
      )}
      {!reader.readOnly && !recoveryInAssistant && (
        <StructureRecovery operations={structure} onRead={changed} />
      )}
      {analysis.failure || issues.failed ? (
        <div
          role="alert"
          className="flex items-center gap-2 border-b px-3 py-2 text-xs text-destructive"
        >
          <span className="flex-1">
            <Trans>无法读取章节分析或待检查项，已有结果保留。</Trans>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              issues.reload();
              void analysis.reload().catch(() => {});
            }}
          >
            <Trans>重试读取</Trans>
          </Button>
        </div>
      ) : null}
      {operationFailed && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b px-3 py-2 text-xs text-destructive"
        >
          <span className="flex-1">
            <Trans>操作未完成，请检查原位置；关闭提示不会重试操作。</Trans>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOperationFailed(false)}
          >
            <Trans>关闭提示</Trans>
          </Button>
        </div>
      )}
      {ai.failure && panel === "inspector" && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b px-3 py-2 text-xs text-destructive"
        >
          <span className="flex-1">
            <Trans>
              助手请求未完成，已有结果保留；请在助手中查看并选择后续操作。
            </Trans>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPanel("assistant");
              setInspectorOpen(true);
              if (small) setDirectoryOpen(false);
            }}
          >
            <Trans>查看助手</Trans>
          </Button>
          {(ai.failure.detail === "configuration_changed" ||
            ai.failure.detail === "configuration_unavailable") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openSettings("models")}
            >
              <Trans>服务连接</Trans>
            </Button>
          )}
        </div>
      )}
      <ChapterRecoveryNotices
        chapters={project.chapters}
        candidateIds={snapshot?.candidateIds}
        candidateOperations={pendingCandidateOperations}
        segmentEdits={pendingSegmentEdits}
        onCandidate={(chapterId, candidateId) => {
          if (chapterId !== chapter.id) {
            pendingResult.current = { chapterId, candidateId };
            setChapterId(chapterId);
          } else setCandidateId(candidateId);
          revealInspector();
        }}
        onSegment={(chapterId, segment) => {
          setCandidateId(null);
          if (chapterId !== chapter.id) {
            pendingIssue.current = { chapterId, segment };
            setChapterId(chapterId);
          } else {
            choose(segment);
            void locate(segment.range);
          }
          revealInspector();
        }}
        onNewCandidate={(id) => {
          setCandidateId(id);
          revealInspector();
        }}
      />
    </>
  );

  return (
    <main
      aria-label={t`章节工作台`}
      data-source-id={chapter.sourceId}
      data-chapter-id={chapter.id}
      data-chapter-byte={chapter.start}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card"
    >
      {!visible ? null : chrome ? (
        chrome.leading && createPortal(workspaceHeader, chrome.leading)
      ) : (
        <header className="h-11 shrink-0 border-b px-2">
          {workspaceHeader}
        </header>
      )}
      <div
        ref={paneLayout}
        className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)_auto] overflow-hidden"
      >
        <div
          ref={directoryColumn}
          className="workspace-pane col-start-1 row-span-2 row-start-1"
          data-open={directoryColumnOpen}
          inert={!directoryColumnOpen}
          style={
            { "--workspace-pane-width": `${directoryWidth}px` } as CSSProperties
          }
        >
          <aside
            id={`${panelId}-directory`}
            aria-label={t`章节目录`}
            className="flex min-h-0 shrink-0 flex-col border-r"
            style={{ width: directoryWidth }}
          >
            <ChapterDirectory
              project={project}
              selectedId={chapter.id}
              onSelect={(c) => setChapterId(c.id)}
              onLocate={locateSource}
              onEdit={
                reader.readOnly
                  ? undefined
                  : (target) =>
                      setEditRequest({
                        chapter: target,
                        onHandled: () => setEditRequest(undefined),
                      })
              }
              editDisabled={structure.hasPending()}
              review={{
                issues: [
                  ...structuralIssues,
                  ...localIssues.map((issue) => {
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
                  }),
                ],
                hasMore: issues.hasMore,
                onLoadMore: () => void issues.loadMore(),
                onRetry: issues.reload,
                total:
                  project.issues.length +
                  (analysis.data?.directory
                    .filter((item) => !item.stale)
                    .reduce((count, item) => count + item.pendingCount, 0) ??
                    0),
                failed: issues.failed,
                description: t`章节结构问题与人物归属审阅分别记录。`,
                emptyTitle: issues.failed
                  ? t`未能读取待检查项`
                  : t`全书暂无待检查项`,
                emptyDescription: issues.failed
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
            controls={`${panelId}-directory`}
            value={directoryWidth}
            min={280}
            max={400}
            onChange={setDirectoryWidth}
          />
        </div>
        <div
          ref={readerLayout}
          data-slot="chapter-reader"
          className="col-start-2 row-start-1 flex min-h-0 min-w-0 flex-col"
        >
          {visible && (
            <div className="max-h-[25%] shrink-0 overflow-y-auto empty:hidden">
              {chapterNotices}
            </div>
          )}
          {panel === "characters" && reader.readOnly ? (
            <div className="p-6 text-sm text-muted-foreground">
              <Trans>示例工程仅供阅读；在真实工程中可管理角色与声音。</Trans>
            </div>
          ) : panel === "characters" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {reviewReturn ? (
                <div className="shrink-0 border-b p-2">
                  <Button size="sm" variant="ghost" onClick={returnToAssistant}>
                    <ArrowLeftIcon />
                    <Trans>返回 AI 助手</Trans>
                  </Button>
                </div>
              ) : null}
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
                reviewRunId={castReviewRunId}
                designRequest={castDesignRequest}
                designPrefill={castDesign}
                onLocate={async (id, version, segmentId, range) => {
                  const page = await commands.chapterAnalysisSegments(
                    project.id,
                    version,
                    range,
                    null,
                  );
                  const segment = page.segments.find(
                    (seg) => seg.id === segmentId,
                  );
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
            </div>
          ) : null}
          <section
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col",
              panel === "characters" ? "hidden" : "flex",
            )}
          >
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
              onBlankSelect={(line, event) =>
                openSourceLine(line.line, event.currentTarget)
              }
              layoutKey={
                snapshot?.versionId && !snapshot.stale
                  ? `roles:${snapshot.versionId}`
                  : "lines"
              }
              renderLine={(line) => (
                <WorkspaceSourceLine
                  key={line.line}
                  line={line}
                  projectId={project.id}
                  chapterId={chapter.id}
                  playback={player.state}
                  evidence={evidence}
                  analysis={
                    snapshot?.versionId && !snapshot.stale
                      ? analysis.segments
                      : null
                  }
                  characters={characters}
                  selectedId={selected?.id ?? null}
                  showRoles={showRoles}
                  actions={sourceActions}
                  onLineSelect={openSourceLine}
                  onSegmentSelect={(segment) => {
                    setLocatedLine(line.line);
                    choose(segment, false);
                  }}
                />
              )}
            />
            {!reader.readOnly && (
              <SourceActions
                actions={sourceActions}
                characters={characters}
                playback={segmentPlayback}
                boundary={sourceBoundary}
                onEdit={choose}
                onAssign={
                  snapshot && !snapshot.stale
                    ? (range) => void assignSelection(range)
                    : undefined
                }
                onReference={(selection) => {
                  setReferences((current) => ({
                    ...current,
                    [ai.sessionId]: {
                      chapterId: chapter.id,
                      line: selection.line,
                      text: selection.text,
                    },
                  }));
                  setPanel("assistant");
                  setInspectorOpen(true);
                  if (small) setDirectoryOpen(false);
                }}
              />
            )}
          </section>
        </div>
        {!reader.readOnly && (
          <div
            ref={assistantColumn}
            className="workspace-pane col-start-3 row-start-1 justify-end"
            data-open={assistantColumnOpen}
            inert={!assistantColumnOpen}
            style={
              {
                "--workspace-pane-width": `${visibleInspectorWidth}px`,
              } as CSSProperties
            }
          >
            <PanelResizeHandle
              label={t`调整右侧面板宽度`}
              controls={`${panelId}-assistant`}
              value={visibleInspectorWidth}
              min={320}
              max={maxInspectorWidth}
              direction={-1}
              onChange={setInspectorWidth}
            />
            <aside
              ref={inspectorPanel}
              id={`${panelId}-assistant`}
              aria-label={t`AI 助手与检查器`}
              className="flex min-h-0 shrink-0 flex-col overflow-hidden border-l"
              style={{ width: visibleInspectorWidth }}
            >
              <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3">
                <div className="flex min-w-0 items-center gap-2">
                  {panel === "inspector" && reviewReturn ? (
                    <IconAction
                      label={t`返回 AI 助手`}
                      onClick={returnToAssistant}
                    >
                      <ArrowLeftIcon />
                    </IconAction>
                  ) : null}
                  <h2 className="truncate text-sm font-medium" tabIndex={-1}>
                    {rightView === "inspector" ? t`片段属性` : t`AI 助手`}
                  </h2>
                </div>
                <div className="flex gap-1">
                  {(assistantToolsOpen ||
                    rightView === "inspector" ||
                    (ai.snapshot?.messages.length ?? 0) > 0) && (
                    <Popover
                      open={assistantToolsOpen}
                      onOpenChange={setAssistantToolsOpen}
                    >
                      <PopoverTrigger
                        render={<Button size="icon-sm" variant="ghost" />}
                        ref={assistantTasksTrigger}
                        aria-label={t`章节任务`}
                      >
                        <EllipsisIcon />
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        onClick={(event) => {
                          if (
                            event.target instanceof Element &&
                            event.target.closest("button")
                          )
                            setAssistantToolsOpen(false);
                        }}
                      >
                        {chapterSuggestions}
                      </PopoverContent>
                    </Popover>
                  )}
                  {rightView === "inspector" ? (
                    <>
                      <IconAction
                        label={t`分析版本历史`}
                        onClick={() => setVersionHistoryOpen(true)}
                      >
                        <HistoryIcon />
                      </IconAction>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPanel("characters")}
                      >
                        <Trans>角色</Trans>
                      </Button>
                    </>
                  ) : (
                    <SessionPalette ai={ai} />
                  )}
                </div>
              </header>
              {progress?.analyze && ai.active && rightView === "inspector" && (
                <div role="status" className="border-b px-3 py-2 text-xs">
                  <p>{t`正在分析 ${project.chapters.find((c) => c.id === ai.snapshot?.run?.workspaceContext?.chapterId)?.title ?? t`章节`}`}</p>
                  <p className="text-muted-foreground">
                    {progress.agent?.stage === "review"
                      ? t`正在预审`
                      : t`正在标注`}
                    {progress.agent?.elapsedMs != null &&
                      ` · ${Math.round(progress.agent.elapsedMs / 1000)}s`}
                  </p>
                </div>
              )}
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-y-auto",
                  rightView === "inspector" ? "flex" : "hidden",
                )}
              >
                <div
                  ref={setPauseContainer}
                  className={pauseObject == null ? "hidden" : "p-3"}
                />
                <ChapterInspector
                  projectId={project.id}
                  chapter={chapter}
                  snapshot={snapshot}
                  characters={characters}
                  inspectedSegment={inspectedSegment}
                  inspectedRange={inspectedRange}
                  attributionPending={attributionPending}
                  edits={segmentEdits}
                  candidateId={candidateId}
                  candidateOperations={candidateOperations}
                  pauseOpen={pauseObject != null}
                  audio={audio}
                  player={player}
                  onCandidateSaved={async () => {
                    await saved();
                    setSelected(null);
                  }}
                  onSaved={saved}
                  onEditBoundary={(segment, snapshot) =>
                    setAnalysisBoundary({
                      chapterId: chapter.id,
                      segment,
                      snapshot,
                    })
                  }
                  onLocate={(range) => void locate(range)}
                />
              </div>
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-hidden",
                  rightView === "assistant" ? "flex" : "hidden",
                )}
              >
                <AgentWorkspace
                  key={ai.sessionId}
                  resultVersion={`${project.revision}:${snapshot?.revision}:${panel}:${splitReference?.id ?? ""}`}
                  ai={ai}
                  projectId={project.id}
                  retryDisabled={!selectedModel || needsModelConfirmation}
                  afterMessages={
                    audio.desktop ? (
                      <ChapterAudioTaskCards
                        key={project.id}
                        projectId={project.id}
                        player={player}
                        visible={
                          visible &&
                          assistantColumnOpen &&
                          rightView === "assistant"
                        }
                        onReturn={(run) => showAudioRun(run, true)}
                      />
                    ) : null
                  }
                  chapterTitle={(id) =>
                    project.chapters.find((item) => item.id === id)?.title
                  }
                  onReview={(reference) => void reviewResult(reference)}
                  domain={{
                    projectRevision: project.revision,
                    onReanalyze: analysisUnavailable
                      ? undefined
                      : reanalyzeChapter,
                    structureOperations: structure,
                    candidateOperations,
                    onStructureChange: changed,
                    onRefreshProject: async () => {
                      setProject(await reader.localProjectSnapshot(project.id));
                    },
                    onAnalysisSaved: async () => {
                      if (
                        !workspaceMounted.current ||
                        currentChapter.current !== chapter.id
                      )
                        throw new Error("chapter_changed");
                      await analysis.reload();
                      if (
                        workspaceMounted.current &&
                        currentChapter.current === chapter.id
                      )
                        await audio.refresh();
                    },
                    onDesignInCenter: (target, draft) => {
                      rememberReview();
                      setPanel("characters");
                      setInspectorOpen(true);
                      if (small) setDirectoryOpen(false);
                      setCastDesign({ target, draft });
                      setCastDesignRequest((n) => n + 1);
                    },
                    targetName: (target) =>
                      target.kind === "narrator"
                        ? undefined
                        : characters.find(
                            (item) => item.id === target.character_id,
                          )?.displayName,
                  }}
                  welcome={
                    <AppState
                      anchored
                      icon={SparklesIcon}
                      title={<Trans>今天想做什么？</Trans>}
                      actions={!assistantToolsOpen && chapterSuggestions}
                    />
                  }
                  composer={
                    <WorkspaceAssistantComposer
                      projectId={project.id}
                      assistant={assistant}
                      context={context}
                      contextTitleForDraft={contextTitleForDraft}
                      clearReference={clearReference}
                      onOpenSettings={(returnFocusTo) =>
                        openSettings("models", returnFocusTo)
                      }
                    />
                  }
                />
              </div>
            </aside>
          </div>
        )}
        {!reader.readOnly && (
          <Dialog
            open={activeAudioDialog !== null}
            onOpenChange={(open) => {
              if (!open) setAudioDialog(null);
            }}
          >
            <DialogContent
              scrollable="large"
              padding="none"
              className={cn(
                "gap-0",
                activeAudioDialog === "settings"
                  ? "sm:data-[scrollable=large]:max-w-lg"
                  : "sm:data-[scrollable=large]:max-w-xl",
              )}
              initialFocus={audioDialogHeading}
              finalFocus={() => {
                const trigger = audioDialogTrigger.current;
                if (trigger === false) return false;
                if (trigger?.isConnected && !trigger.matches(":disabled"))
                  return trigger;
                return (
                  chapterAudioFooter.current?.querySelector<HTMLButtonElement>(
                    "[data-action=chapter-audio-primary]:enabled",
                  ) ??
                  propertiesButton.current ??
                  false
                );
              }}
            >
              <div className="shrink-0 border-b px-4 py-3.5 pr-12">
                <DialogTitle ref={audioDialogHeading} tabIndex={-1}>
                  {activeAudioDialog === "settings"
                    ? t`本章音频设置`
                    : t`生成前检查`}
                </DialogTitle>
                <DialogDescription className="mt-1 truncate text-xs">
                  {chapter.title}
                </DialogDescription>
              </div>
              {activeAudioDialog === "check" && (
                <>
                  <BindingRecovery
                    projectId={project.id}
                    characters={characters}
                  />
                  <ChapterGenerationCheck
                    audio={audio}
                    onLocate={(range) => {
                      setAudioDialog(null);
                      void locate(range);
                    }}
                    onRepairAttribution={(range) =>
                      closeAudioDialogFor(() => locateAudioSegment(range, true))
                    }
                    onLocateUnassigned={(range) =>
                      closeAudioDialogFor(() => {
                        void locate(range).then(() =>
                          viewport.current?.focus({ preventScroll: true }),
                        );
                      })
                    }
                    onFillUnassigned={() =>
                      closeAudioDialogFor(() => {
                        if (snapshot && !snapshot.stale)
                          setManualAttribution({
                            kind: "fill",
                            source: snapshot.binding,
                            revision: snapshot.revision,
                          });
                      })
                    }
                    onAnalyze={() => closeAudioDialogFor(analyzeForProduction)}
                    onCast={() =>
                      closeAudioDialogFor(() => {
                        setCastReviewRunId(null);
                        setCastReviewRequest(0);
                        setCastDesign(null);
                        setPanel("characters");
                      })
                    }
                    onModels={() => {
                      audioDialogTrigger.current = false;
                      setAudioDialog(null);
                    }}
                    renderVoice={(target, range) =>
                      audio.mode === "narrator" ? (
                        <ChapterAudioSettings
                          {...audioSettingsProps}
                          narratorOnly
                          onNarrator={(voice) => {
                            setNarratorVoice(voice);
                            audioDialogHeading.current?.focus();
                          }}
                        />
                      ) : (
                        <ChapterVoicePanel
                          projectId={project.id}
                          chapter={chapter}
                          characters={characters}
                          segment={null}
                          sourceRange={range}
                          attributionPending={false}
                          requestedTarget={target}
                        />
                      )
                    }
                  />
                </>
              )}
              {activeAudioDialog === "settings" && (
                <ChapterAudioSettings
                  key={chapter.id}
                  {...audioSettingsProps}
                  onAnalyze={() => closeAudioDialogFor(analyzeForProduction)}
                />
              )}
            </DialogContent>
          </Dialog>
        )}
        {!reader.readOnly && (
          <div className="col-span-2 col-start-2 row-start-2 flex min-w-0">
            {panel === "characters" && !small && (
              <div aria-hidden="true" className="w-72 shrink-0 border-r" />
            )}
            <div
              ref={chapterAudioFooter}
              data-slot="chapter-audio-footer"
              className="min-w-0 flex-1"
            >
              <ChapterAudioTrack
                chapterId={chapter.id}
                nextAction={
                  audio.desktop && workflow && renderWorkflowAction(workflow)
                }
                onViewRun={showAudioRun}
                audio={audio}
                narratorSelected={!!currentNarrator}
                analysisReady={!!analysisVersion}
                onOptions={openChapterAudioSettings}
                onReturn={() => {
                  const target = player.state.target;
                  if (!target || !player.state.unit) return;
                  requestReturn({
                    projectId: target.projectId,
                    chapterId: target.chapterId,
                    range: player.state.unit.range,
                  });
                  if (target.projectId !== project.id) {
                    void navigate({
                      to: "/project/$id",
                      params: { id: target.projectId },
                      search: { section: "chapters" },
                    });
                  }
                }}
                onStart={startChapterAudio}
                checkOpen={activeAudioDialog === "check"}
                onCheck={() =>
                  void afterPauseExit(() => showAudioDialog("check"))
                }
                onAnalyze={
                  selectedAudioMode
                    ? () => void afterPauseExit(analyzeForProduction)
                    : undefined
                }
                analyzeDisabled={
                  !!selectedAudioMode &&
                  analysisUnavailable &&
                  !!selectedModel &&
                  !needsModelConfirmation
                }
                modeLabel={audioMode === "narrator" ? t`单音色旁白` : t`多角色`}
                player={player}
                selectedSegmentId={selected?.id ?? null}
                requestedPause={pauseObject}
                pauseContainer={pauseContainer}
                onPauseSelect={choosePause}
                onPauseCommitted={setPauseObject}
                pauseExitGuard={pauseExitGuard}
                pauseOperationGuard={pauseOperationGuard}
                pauseDirtyGuard={pauseDirtyGuard}
                onLocate={(range) => {
                  if (!audio.status?.arrangement.stale)
                    locateAudioSegment(range);
                }}
              />
            </div>
          </div>
        )}
      </div>
      {visible && manualAttribution?.source.chapterId === chapter.id && (
        <ManualAttributionDialog
          key={chapter.id}
          request={manualAttribution}
          characters={characters}
          onClose={() => {
            setManualAttribution(null);
            requestAnimationFrame(() =>
              viewport.current?.focus({ preventScroll: true }),
            );
          }}
          onSaved={async (revision) => {
            await saved(revision);
            if (manualAttribution.kind === "assign")
              setEvidence({
                chapterId: chapter.id,
                range: manualAttribution.range,
              });
            else if (manualAttribution.kind === "undo") {
              setSelected(null);
              setEvidence(null);
            }
          }}
          returnFocus={() => viewport.current}
        />
      )}
      <ChapterStructureConfirm
        request={boundary}
        visible={visible}
        pending={!!structureOperation}
        onCancel={() => setBoundary(null)}
        onConfirm={(request) => {
          if (structure.snapshot()) return;
          structure.start({
            projectId: request.projectId,
            revision: request.revision,
            commandId: request.commandId,
            kind: "edit",
            edit: {
              kind: "boundary",
              correction: {
                sourceId: request.sourceId,
                line: request.line,
                include: request.include,
                title: null,
                volumeId: null,
              },
            },
            draftKey: null,
          });
          setBoundary(null);
        }}
      />
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
              disabled={ai.active || !!structureOperation}
              operations={structure}
              onChange={changed}
              onLocate={locateSource}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {analysisBoundary && (
        <BoundaryEditor
          open
          onOpenChange={(open) => {
            if (!open) setAnalysisBoundary(null);
          }}
          projectId={project.id}
          chapterId={analysisBoundary.chapterId}
          segment={analysisBoundary.segment}
          snapshot={analysisBoundary.snapshot}
          onSaved={async () => {
            if (currentChapter.current === analysisBoundary.chapterId) {
              await saved();
              setSelected(null);
            } else {
              await commands.chapterAnalysisSnapshot(
                project.id,
                analysisBoundary.chapterId,
              );
            }
          }}
          onPendingChange={(pending) => {
            boundaryOperationPending.current = pending;
          }}
        />
      )}
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
