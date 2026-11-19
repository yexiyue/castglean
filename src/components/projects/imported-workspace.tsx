import { Trans, useLingui } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
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
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  QuoteIcon,
  SparklesIcon,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { BoundaryEditor } from "@/components/analysis/boundary-editor";
import { CandidateReview } from "@/components/analysis/candidate-review";
import { RoleSourceBlock } from "@/components/analysis/role-source-block";
import { SegmentInspector } from "@/components/analysis/segment-inspector";
import { VersionHistory } from "@/components/analysis/version-history";
import { ContextUsage } from "@/components/assistant-ui/input/context-usage";
import { ModelPicker } from "@/components/assistant-ui/input/model-picker";
import { ReasoningPicker } from "@/components/assistant-ui/input/reasoning-picker";
import { SessionInput } from "@/components/assistant-ui/input/session-input";
import { AgentWorkspace } from "@/components/assistant-ui/thread/agent-workspace";
import { SessionPalette } from "@/components/assistant-ui/thread/session-palette";
import { BindingRecovery } from "@/components/projects/binding-recovery";
import { ChapterAudioSettings } from "@/components/projects/chapter-audio-settings";
import { ChapterAudioBar } from "@/components/projects/chapter-audio-bar";
import { ChapterAudioTrack } from "@/components/projects/chapter-audio-track";
import { ChapterDirectory } from "@/components/projects/chapter-directory";
import { useChapterPlayback } from "@/components/projects/chapter-playback-provider";
import {
  type ChapterBoundaryRequest,
  ChapterStructureConfirm,
} from "@/components/projects/chapter-structure-confirm";
import { ChapterVoicePanel } from "@/components/projects/chapter-voice-panel";
import { CharacterCenter } from "@/components/projects/character-center";
import { PanelResizeHandle } from "@/components/projects/panel-resize-handle";
import { SourceLine } from "@/components/projects/source-line";
import { SplitProposal } from "@/components/projects/split-proposal";
import { StructureActions } from "@/components/projects/structure-actions";
import { StructureRecovery } from "@/components/projects/structure-recovery";
import { usePauseNavigationGuard } from "@/components/projects/use-pause-navigation-guard";
import { useSegmentPlayback } from "@/components/projects/use-segment-playback";
import { VirtualSourceReader } from "@/components/projects/virtual-source-reader";
import { useWorkspaceMode } from "@/components/projects/workspace-mode";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspaceChrome } from "@/components/workspace-chrome";
import { useAiSession } from "@/hooks/use-ai-session";
import { useChapterAnalysis } from "@/hooks/use-chapter-analysis";
import { useChapterAnalysisIssues } from "@/hooks/use-chapter-analysis-issues";
import { useChapterAudio } from "@/hooks/use-chapter-audio";
import { useLlmConnections } from "@/hooks/use-llm-connections";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSegmentEditDrafts } from "@/hooks/use-segment-edit-drafts";
import {
  type AnalysisSnapshot,
  commands,
  type LocalProjectSnapshot_Serialize,
  type Progress,
  type ReasoningSetting,
  type ResultReference,
  type Segment,
} from "@/lib/bindings";
import { CandidateOperationRegistry } from "@/lib/candidate-operations";
import { useDesktopSession, useWorkspaceState } from "@/lib/desktop-session";
import { appHotkeys } from "@/lib/hotkeys";
import {
  chapterAtByte,
  chapterLineIndex,
  chapterReadingRange,
} from "@/lib/projects/chapter-reading";
import { sourceSelection } from "@/lib/projects/source-selection";
import { reasoningChoices } from "@/lib/reasoning";
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
  const panelId = useId();
  const directoryButton = useRef<HTMLButtonElement>(null);
  const assistantButton = useRef<HTMLButtonElement>(null);
  const inspectorPanel = useRef<HTMLElement>(null);
  const focusBeforeDirectory = useRef<HTMLElement | null>(null);
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
  const small = useMediaQuery("(max-width: 1100px)");
  const [chapterId, setChapterIdValue] = useWorkspaceState(
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
  const [inspectorWidth, setInspectorWidth] = useWorkspaceState(
    project.id,
    "analysisInspectorWidth",
    320,
  );
  const paneLayout = useRef<HTMLDivElement>(null);
  const readerLayout = useRef<HTMLDivElement>(null);
  const directoryColumn = useRef<HTMLDivElement>(null);
  const assistantColumn = useRef<HTMLDivElement>(null);
  const [paneLayoutWidth, setPaneLayoutWidth] = useState(0);
  useEffect(() => {
    const layout = paneLayout.current;
    if (!layout) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setPaneLayoutWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(layout);
    return () => observer.disconnect();
  }, []);
  const [display, setDisplay] = useWorkspaceState<"compact" | "original">(
    project.id,
    "analysisDisplay",
    "compact",
  );
  const [panel, setPanel] = useWorkspaceState<
    "inspector" | "assistant" | "characters" | "audio"
  >(project.id, "chapterPanel", "inspector");
  const [directoryOverlay, setDirectoryOverlay] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<
    import("@/lib/bindings").BindingTarget | null
  >(null);
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
  const [locatedLine, setLocatedLine] = useState(0);
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
  const [targetLine, setTargetLine] = useState(0);
  const [targetOffset, setTargetOffset] = useState(44);
  const [evidence, setEvidence] = useState<{
    chapterId: string;
    range: { start: number; end: number };
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [operationFailed, setOperationFailed] = useState(false);
  const analysisStarting = useRef(false);
  const pendingReanalysis = useRef<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const reading = useMemo(
    () => chapterReadingRange(project.chapters, chapter),
    [project.chapters, chapter],
  );
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
  const [selectedAudioMode, setAudioMode] = useWorkspaceState<
    import("@/lib/bindings").ChapterAudioMode | null
  >(project.id, `chapterAudioMode:${chapter.id}`, null);
  const audioMode = selectedAudioMode ?? "multi_role";
  useEffect(() => {
    if (selectedAudioMode || reader.readOnly || !isTauri()) return;
    let current = true;
    void commands
      .chapterAudioStatus(project.id, chapter.id, null, null, false)
      .then((result) => {
        if (current && result?.run.mode)
          setAudioMode((value) => value ?? result.run.mode);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [
    selectedAudioMode,
    reader.readOnly,
    project.id,
    chapter.id,
    setAudioMode,
  ]);
  const [narratorVoice, setNarratorVoice] = useWorkspaceState<
    import("@/lib/bindings").VoiceRef | null
  >(project.id, `chapterNarrator:${chapter.id}`, null);
  const audioInput = useMemo<import("@/lib/bindings").ChapterAudioInput>(
    () =>
      audioMode === "narrator"
        ? { mode: "narrator", voice: narratorVoice }
        : { mode: "multi_role" },
    [audioMode, narratorVoice],
  );
  const snapshot = analysis.data?.snapshot ?? null;
  const analysisVersion = snapshot?.stale ? null : snapshot?.versionId;
  const audio = useChapterAudio(project.id, chapter.id, audioInput, {
    visible,
    analysisVersion,
  });
  const currentNarrator = narratorVoice ?? audio.frozenNarrator;
  const {
    player,
    setInlineControls,
    setSource,
    returnTarget,
    requestReturn,
    clearReturn,
  } = useChapterPlayback();
  const inlineAudio = visible && !reader.readOnly && audio.desktop;
  useEffect(() => {
    if (!inlineAudio) return;
    setInlineControls(true);
    return () => setInlineControls(false);
  }, [inlineAudio, setInlineControls]);
  useEffect(() => {
    const status = audio.status;
    setSource({
      status:
        status?.run.projectId === project.id &&
        status.run.chapterId === chapter.id
          ? status
          : null,
      projectTitle: project.title,
    });
  }, [audio.status, chapter.id, project.id, project.title, setSource]);
  useEffect(() => () => setSource(null), [setSource]);
  const segmentPlayback = useSegmentPlayback(
    project.id,
    chapter.id,
    audio.status,
    player,
  );
  const characters = analysis.data?.characters ?? [];
  const configuration = useLlmConnections(!reader.readOnly);
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
      const fresh = await reader.localProjectSnapshot(project.id);
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
  const [drafts, setDrafts] = useWorkspaceState<Record<string, string>>(
    project.id,
    "assistantDrafts",
    {},
  );
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
  const draft = drafts[ai.sessionId] ?? "";
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
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const listener = () => setHasSelection(!!sourceSelection(viewport.current));
    document.addEventListener("selectionchange", listener);
    return () => document.removeEventListener("selectionchange", listener);
  }, [visible]);
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
    setVoiceTarget(null);
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
      setLocatedLine(Math.max(reading.startLine, readingLocation.line));
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
    setLocatedLine(Math.max(reading.startLine, target.location.line));
    setReloadKey((n) => n + 1);
  }, [chapter.id, chapter.sourceId, reading.startLine]);
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
  const saved = useCallback(async () => {
    // A completed command for the previous chapter must not reload into a new scope.
    if (!workspaceMounted.current || currentChapter.current !== chapter.id)
      throw new Error("chapter_changed");
    await analysis.reload();
    if (!workspaceMounted.current || currentChapter.current !== chapter.id)
      throw new Error("chapter_changed");
    await audio.refresh();
    if (!workspaceMounted.current || currentChapter.current !== chapter.id)
      throw new Error("chapter_changed");
    setCandidateId(null);
  }, [analysis.reload, audio.refresh, chapter.id]);
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
  const choose = (s: Segment) => {
    void afterPauseExit(() => {
      setPauseObject(null);
      setEvidence(null);
      setSelected(s);
      setVoiceTarget(null);
      setPanel("inspector");
      setInspectorOpen(true);
      if (small) setDirectoryOpen(false);
    });
  };
  const directoryVisible =
    directoryOpen && (!small || !inspectorOpen || directoryOverlay);
  const inspectorVisible = inspectorOpen && (!small || !directoryVisible);
  const directoryColumnOpen = directoryVisible && panel !== "characters";
  const assistantColumnOpen =
    !reader.readOnly && inspectorVisible && panel !== "characters";
  const maxInspectorWidth = Math.max(
    320,
    Math.min(
      640,
      paneLayoutWidth - (directoryColumnOpen ? directoryWidth + 4 : 0) - 304,
    ),
  );
  const visibleInspectorWidth = Math.min(inspectorWidth, maxInspectorWidth);
  const [headerGeometry, setHeaderGeometry] = useState({
    directory: 0,
    assistant: 0,
    reader: 0,
  });
  const headerTarget = chrome?.leading;
  useLayoutEffect(() => {
    const layout = readerLayout.current;
    if (!layout || !headerTarget || !visible) return;
    const updateGeometry = () => {
      const header = headerTarget.getBoundingClientRect();
      const content = layout.getBoundingClientRect();
      // The pane divider is the midpoint of its 4px resize handle.
      const directory =
        directoryColumn.current?.getBoundingClientRect().width ?? 0;
      const assistant = assistantColumn.current?.getBoundingClientRect();
      const left =
        directory > 4
          ? Math.max(content.left - 2, header.left + 28)
          : header.left + 28;
      const right =
        assistant && assistant.width > 4
          ? Math.min(assistant.left + 2, header.right - 36)
          : header.right - (reader.readOnly ? 0 : 36);
      const geometry = {
        directory: left > header.left + 28 ? left - header.left : 0,
        assistant:
          assistant && right < header.right - 36 ? header.right - right - 1 : 0,
        reader: Math.max(0, right - left),
      };
      setHeaderGeometry((previous) =>
        previous.directory === geometry.directory &&
        previous.assistant === geometry.assistant &&
        previous.reader === geometry.reader
          ? previous
          : geometry,
      );
    };
    const observer = new ResizeObserver(updateGeometry);
    observer.observe(layout);
    observer.observe(headerTarget);
    if (assistantColumn.current) observer.observe(assistantColumn.current);
    updateGeometry();
    return () => observer.disconnect();
  }, [headerTarget, reader.readOnly, visible]);

  const rememberInspectorFocus = () => {
    const active = document.activeElement;
    focusBeforeDirectory.current =
      active instanceof HTMLElement && inspectorPanel.current?.contains(active)
        ? active
        : null;
  };
  const toggleDirectory = () => {
    if (small && !directoryVisible) {
      if (inspectorPanel.current?.contains(document.activeElement))
        rememberInspectorFocus();
      setDirectoryOverlay(true);
      setDirectoryOpen(true);
      directoryButton.current?.focus();
      return;
    }
    setDirectoryOpen(!directoryVisible);
    setDirectoryOverlay(false);
    const restore =
      small && inspectorOpen ? focusBeforeDirectory.current : null;
    focusBeforeDirectory.current = null;
    if (restore)
      requestAnimationFrame(() => {
        if (restore.isConnected && restore.getClientRects().length)
          restore.focus({ preventScroll: true });
      });
    else directoryButton.current?.focus();
  };
  const toggleInspector = () => {
    setInspectorOpen(!inspectorVisible);
    if (!inspectorVisible && small) {
      setDirectoryOpen(false);
      setDirectoryOverlay(false);
    }
    assistantButton.current?.focus();
  };
  // 回调随渲染同步，无需 ref；IME/输入框语义由库处理，重复按键由清单 requireReset 防护
  useHotkey(appHotkeys["workspace.toggleDirectory"], toggleDirectory, {
    enabled: visible,
  });
  useHotkey(appHotkeys["workspace.toggleInspector"], toggleInspector, {
    enabled: visible,
  });
  function openChapterAudioSettings() {
    void afterPauseExit(() => {
      setPanel("audio");
      setInspectorOpen(true);
      if (small) setDirectoryOpen(false);
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
  const trailing = !reader.readOnly && (
    <IconAction
      label={
        panel === "audio"
          ? t`本章音频`
          : panel === "inspector"
            ? t`片段属性`
            : t`AI 助手`
      }
      buttonRef={assistantButton}
      hint={inspectorVisible ? t`收起检查面板` : t`展开检查面板`}
      expanded={inspectorVisible}
      controls={`${panelId}-assistant`}
      onClick={toggleInspector}
      pressed={inspectorVisible}
    >
      {inspectorVisible ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
    </IconAction>
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
    void reader
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
  const reviewReturn = useRef<{
    sessionId: string;
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
    reviewReturn.current = {
      sessionId: ai.sessionId,
      chapterId: chapter.id,
      line: row ? Number(row.dataset.sourceRow) : reading.startLine,
      byte: row ? Number(row.dataset.sourceByte) : chapter.start,
      offset: row ? row.getBoundingClientRect().top - top : 44,
      trigger:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    };
  }
  function returnToAssistant() {
    setPanel("assistant");
    const bookmark = reviewReturn.current;
    if (!bookmark || bookmark.sessionId !== ai.sessionId) return;
    reviewReturn.current = null;
    const target = project.chapters.find(
      (item) => item.id === bookmark.chapterId,
    );
    if (target) {
      if (target.id !== chapter.id) {
        pendingLocation.current = {
          chapterId: target.id,
          location: { sourceId: target.sourceId, ...bookmark },
        };
        setChapterId(target.id);
      } else {
        setTargetLine(bookmark.line);
        setTargetOffset(bookmark.offset);
        setLocatedLine(bookmark.line);
        setReloadKey((n) => n + 1);
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
  const inspectedUnit = audio.status?.arrangement.stale
    ? null
    : audio.status?.units.find(
        (u) =>
          inspectedRange &&
          u.range.start < inspectedRange.end &&
          u.range.end > inspectedRange.start,
      );
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

  const selectedLineIsHeading = project.chapters.some(
    (item) =>
      item.sourceId === chapter.sourceId && item.heading === locatedLine,
  );
  const boundaryLabel = selectedLineIsHeading ? t`合并此章` : t`从此行分章`;
  const chapterTitle = panel !== "characters" && (
    <StructureActions
      project={project}
      chapter={chapter}
      line={locatedLine}
      active={ai.active}
      boundaryLabel={boundaryLabel}
      boundaryDisabled={
        ai.active ||
        !!structureOperation ||
        locatedLine < reading.startLine ||
        (reading.endLine !== null && locatedLine >= reading.endLine)
      }
      onBoundary={() =>
        setBoundary({
          projectId: project.id,
          projectTitle: project.title,
          chapterTitle: chapter.title,
          filename: source?.filename ?? "",
          line: locatedLine,
          include: !selectedLineIsHeading,
          revision: project.revision,
          sourceId: chapter.sourceId,
          commandId: crypto.randomUUID(),
        })
      }
      readOnly={reader.readOnly}
      onChange={changed}
      onLocate={locateSource}
      onAddSources={onAddSources}
      editRequest={editRequest}
      sourceStatus={
        snapshot?.stale
          ? t`分析已失效`
          : snapshot?.versionId
            ? t`已保存初稿`
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
      {hasSelection && !reader.readOnly && (
        <IconAction
          label={t`引用选中的原文`}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            const selection = sourceSelection(viewport.current);
            if (!selection) return;
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
        >
          <QuoteIcon />
        </IconAction>
      )}
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
      {(!snapshot?.versionId || snapshot.stale) && (
        <IconAction
          label={display === "compact" ? t`切换为原样显示` : t`切换为紧凑显示`}
          pressed={display === "compact"}
          onClick={() =>
            setDisplay(display === "compact" ? "original" : "compact")
          }
        >
          {display === "compact" ? <ListCollapseIcon /> : <AlignJustifyIcon />}
        </IconAction>
      )}
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
        onClick={runChapterAnalysis}
      >
        <SparklesIcon />
        {snapshot?.versionId ? (
          <Trans>重新分析</Trans>
        ) : (
          <Trans>分析本章</Trans>
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
    panel === "assistant" &&
    structureRequest?.kind === "proposal" &&
    structureRequest.surface === "assistant" &&
    ai.snapshot?.records.some((record) =>
      [...record.results, ...Object.values(record.tools)].some(
        (result) =>
          result.kind === "chapter_split_proposal" &&
          result.id === structureRequest.proposalId,
      ),
    );
  const chapterNotices = (
    <>
      {visible && !reader.readOnly && (
        <BindingRecovery
          projectId={project.id}
          characters={characters}
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
              if (audio.blockers) await audio.check();
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
      {snapshot?.stale ? (
        <p className="border-b px-3 py-2 text-xs text-foreground">
          <Trans>章节来源或边界已变化，旧分析仅供查看，请重新分析。</Trans>
        </p>
      ) : null}
      {pendingCandidateOperations.map((operation) => {
        const target = project.chapters.find(
          (item) => item.id === operation.chapterId,
        );
        return (
          <div
            key={operation.commandId}
            role="status"
            className="flex items-center gap-2 border-b px-3 py-2 text-xs"
          >
            <span className="flex-1">
              {target ? (
                operation.phase === "read" ? (
                  <Trans>候选操作已保存，待读取：{target.title}</Trans>
                ) : (
                  <Trans>候选操作待确认：{target.title}</Trans>
                )
              ) : (
                <Trans>候选操作的原章节已变化，请重新读取工程。</Trans>
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!target}
              onClick={() => {
                if (operation.chapterId !== chapter.id) {
                  pendingResult.current = {
                    chapterId: operation.chapterId,
                    candidateId: operation.candidateId,
                  };
                  setChapterId(operation.chapterId);
                } else setCandidateId(operation.candidateId);
                setPanel("inspector");
                setInspectorOpen(true);
                if (small) setDirectoryOpen(false);
              }}
            >
              <Trans>查看并恢复</Trans>
            </Button>
          </div>
        );
      })}
      {pendingSegmentEdits.map((state) => {
        const target = state.target;
        if (!target) return null;
        const targetChapter = project.chapters.find(
          (item) => item.id === target.chapterId,
        );
        return (
          <div
            key={`${target.chapterId}:${target.segment.id}`}
            role="status"
            className="flex items-center gap-2 border-b px-3 py-2 text-xs"
          >
            <span className="flex-1">
              {targetChapter ? (
                state.confirmed ? (
                  <Trans>片段修改已保存，待读取：{targetChapter.title}</Trans>
                ) : (
                  <Trans>片段修改待确认：{targetChapter.title}</Trans>
                )
              ) : (
                <Trans>片段修改的原章节已变化，请重新读取工程。</Trans>
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!targetChapter}
              onClick={() => {
                setCandidateId(null);
                if (target.chapterId !== chapter.id) {
                  pendingIssue.current = {
                    chapterId: target.chapterId,
                    segment: target.segment,
                  };
                  setChapterId(target.chapterId);
                } else {
                  choose(target.segment);
                  void locate(target.segment.range);
                }
                setPanel("inspector");
                setInspectorOpen(true);
                if (small) setDirectoryOpen(false);
              }}
            >
              <Trans>查看并恢复</Trans>
            </Button>
          </div>
        );
      })}
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
        <>
          {chrome.leading && createPortal(workspaceHeader, chrome.leading)}
          {chrome.notices && createPortal(chapterNotices, chrome.notices)}
        </>
      ) : (
        <>
          <header className="h-11 shrink-0 border-b px-2">
            {workspaceHeader}
          </header>
          {chapterNotices}
        </>
      )}
      <div ref={paneLayout} className="flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={directoryColumn}
          className="workspace-pane"
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={readerLayout} className="flex min-h-0 flex-1">
            {panel === "characters" && reader.readOnly ? (
              <div className="p-6 text-sm text-muted-foreground">
                <Trans>示例工程仅供阅读；在真实工程中可管理角色与声音。</Trans>
              </div>
            ) : panel === "characters" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {reviewReturn.current ? (
                  <div className="shrink-0 border-b p-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={returnToAssistant}
                    >
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
                onBlankSelect={(line) => setLocatedLine(line.line)}
                layoutKey={
                  snapshot?.versionId && !snapshot.stale
                    ? `roles:${snapshot.versionId}`
                    : "lines"
                }
                renderBlock={
                  snapshot?.versionId && !snapshot.stale
                    ? (lines) => (
                        <RoleSourceBlock
                          lines={lines}
                          segments={analysis.segments}
                          characters={characters}
                          selectedId={selected?.id ?? null}
                          onSelect={choose}
                          playback={segmentPlayback}
                          pauses={
                            audio.status?.arrangement.stale
                              ? []
                              : audio.status?.arrangement.pauses.flatMap(
                                  (p) => {
                                    const unit = audio.status?.units.find(
                                      (u) => u.index === p.afterIndex,
                                    );
                                    return unit
                                      ? [
                                          {
                                            offset: unit.range.end,
                                            index: p.afterIndex,
                                            durationMs: p.durationMs,
                                          },
                                        ]
                                      : [];
                                  },
                                )
                          }
                          onPauseSelect={choosePause}
                          highlight={
                            (!audio.status?.arrangement.stale &&
                            player.state.target?.projectId === project.id &&
                            player.state.target.chapterId === chapter.id
                              ? player.state.unit?.range
                              : null) ??
                            (evidence?.chapterId === chapter.id
                              ? evidence.range
                              : null)
                          }
                        />
                      )
                    : undefined
                }
                renderLine={(line) => (
                  <SourceLine
                    key={line.line}
                    line={line}
                    highlight={
                      evidence?.chapterId === chapter.id ? evidence.range : null
                    }
                    onSelect={() => setLocatedLine(line.line)}
                  />
                )}
              />
            </section>
            {!reader.readOnly && (
              <div
                ref={assistantColumn}
                className="workspace-pane justify-end"
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
                      {panel !== "assistant" ? (
                        <IconAction
                          label={t`返回 AI 助手`}
                          onClick={returnToAssistant}
                        >
                          <ArrowLeftIcon />
                        </IconAction>
                      ) : null}
                      <h2 className="truncate text-sm font-medium">
                        {panel === "inspector"
                          ? t`片段属性`
                          : panel === "audio"
                            ? t`本章音频`
                            : t`AI 助手`}
                      </h2>
                    </div>
                    <div className="flex gap-1">
                      {(assistantToolsOpen ||
                        panel === "inspector" ||
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
                      {panel === "inspector" ? (
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
                      ) : panel === "assistant" ? (
                        <SessionPalette ai={ai} />
                      ) : null}
                    </div>
                  </header>
                  {panel === "audio" && (
                    <ChapterAudioSettings
                      key={chapter.id}
                      projectId={project.id}
                      chapterId={chapter.id}
                      mode={audioMode}
                      narrator={currentNarrator}
                      busy={!!audio.active || audio.starting}
                      analysisReady={!!analysisVersion}
                      analysisBusy={!!selectedModel && analysisUnavailable}
                      needsAnalysisModel={!selectedModel}
                      onMode={(value) =>
                        void afterPauseExit(() => setAudioMode(value))
                      }
                      onNarrator={setNarratorVoice}
                      onAnalyze={() => {
                        if (selectedModel) runChapterAnalysis();
                        else openSettings("models");
                      }}
                      onRegenerate={
                        !audio.checking &&
                        !audio.blockers &&
                        audio.status?.run.status === "succeeded" &&
                        (audioMode !== "narrator" || currentNarrator)
                          ? () => void audio.start(true)
                          : undefined
                      }
                    />
                  )}
                  {progress?.analyze && ai.active && panel === "inspector" && (
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
                      panel === "inspector" ? "flex" : "hidden",
                    )}
                  >
                    <div
                      ref={setPauseContainer}
                      className={pauseObject == null ? "hidden" : "p-3"}
                    />
                    <div
                      className={cn(
                        "min-w-0 flex-col gap-4 p-4",
                        pauseObject != null ? "hidden" : "flex",
                      )}
                    >
                      {inspectedUnit && (
                        <>
                          <section className="flex flex-col items-start gap-2">
                            <h3 className="text-sm font-semibold wrap-anywhere">
                              {inspectedUnit.characterName ?? t`旁白`}
                            </h3>
                            <p className="text-xs wrap-anywhere text-muted-foreground">
                              {inspectedUnit.voice} ·{" "}
                              {inspectedUnit.mediaId
                                ? t`音频已生成`
                                : inspectedUnit.status === "failed"
                                  ? t`生成失败`
                                  : t`等待生成`}
                              {inspectedUnit.durationMs != null &&
                                ` · ${(inspectedUnit.durationMs / 1000).toFixed(2)}s`}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!inspectedUnit.mediaId}
                              onClick={() =>
                                void player.start(inspectedUnit.index)
                              }
                            >
                              <Trans>从这里播放</Trans>
                            </Button>
                          </section>
                          <Separator />
                        </>
                      )}
                      {candidateId && snapshot ? (
                        <CandidateReview
                          key={`${project.id}:${candidateId}`}
                          projectId={project.id}
                          chapterId={chapter.id}
                          candidateId={candidateId}
                          characters={characters}
                          revision={snapshot.revision}
                          operations={candidateOperations}
                          onSaved={async () => {
                            await saved();
                            setSelected(null);
                          }}
                          onLocate={(r) => void locate(r)}
                        />
                      ) : (
                        <SegmentInspector
                          edits={segmentEdits}
                          projectId={project.id}
                          chapterId={chapter.id}
                          snapshot={snapshot}
                          onEditBoundary={(segment, snapshot) =>
                            setAnalysisBoundary({
                              chapterId: chapter.id,
                              segment,
                              snapshot,
                            })
                          }
                          segment={inspectedSegment}
                          characters={characters}
                          onSaved={saved}
                          onLocate={(r) => void locate(r)}
                        />
                      )}
                      <Separator />
                      <ChapterVoicePanel
                        key={project.id}
                        projectId={project.id}
                        chapter={chapter}
                        characters={characters}
                        segment={inspectedSegment}
                        attributionPending={attributionPending}
                        requestedTarget={voiceTarget}
                      />
                    </div>
                  </div>
                  <div
                    className={cn(
                      "min-h-0 flex-1 flex-col overflow-hidden",
                      panel === "assistant" ? "flex" : "hidden",
                    )}
                  >
                    <AgentWorkspace
                      key={ai.sessionId}
                      resultVersion={`${project.revision}:${snapshot?.revision}:${panel}:${splitReference?.id ?? ""}`}
                      ai={ai}
                      projectId={project.id}
                      retryDisabled={!selectedModel || needsModelConfirmation}
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
                          setProject(
                            await reader.localProjectSnapshot(project.id),
                          );
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
                        <div className="mb-6 flex flex-col gap-3 px-2">
                          <p className="text-xl font-medium">
                            <Trans>今天想做什么？</Trans>
                          </p>
                          {!assistantToolsOpen && chapterSuggestions}
                        </div>
                      }
                      composer={
                        <div className="flex flex-col gap-2 pb-3">
                          {needsModelConfirmation ? (
                            <div
                              role="alert"
                              className="flex items-center gap-2 py-1 text-xs"
                            >
                              <span className="min-w-0 flex-1">
                                <Trans>
                                  模型配置已变化，确认后使用{" "}
                                  {selectedModel?.name} 继续。
                                </Trans>
                                <span className="block break-all text-muted-foreground">
                                  {selectedModel?.endpoint}
                                </span>
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setConfirmedModel(modelBindingKey)
                                }
                              >
                                <Trans>确认使用</Trans>
                              </Button>
                            </div>
                          ) : null}
                          {reasoningFallback ? (
                            <p
                              role="status"
                              className="text-xs text-muted-foreground"
                            >
                              <Trans>
                                所选模型不支持原思考档位，已跟随模型默认。
                              </Trans>
                            </p>
                          ) : null}
                          <SessionInput
                            focusToken={context}
                            reference={
                              context && {
                                title: contextTitleForDraft,
                                text: context.text,
                                line: context.line,
                                onRemove: () =>
                                  clearReference(ai.sessionId, context),
                              }
                            }
                            answering={
                              (ai.snapshot?.interrupts.length ?? 0) > 0
                            }
                            answerTarget={`agent-answers-${ai.sessionId}`}
                            label={t`工程问题或补充说明`}
                            placeholder={t`检查分章、分析人物、选角，或询问原文…`}
                            value={draft}
                            onChange={(value) =>
                              setDrafts((old) => ({
                                ...old,
                                [ai.sessionId]: value,
                              }))
                            }
                            disabled={
                              (ai.snapshot?.interrupts.length ?? 0) > 0 ||
                              !selectedModel ||
                              ai.loading ||
                              ai.readFailure ||
                              needsModelConfirmation ||
                              ai.pendingStart ||
                              !!ai.recoveredStart
                            }
                            stopping={ai.snapshot?.run?.status === "cancelling"}
                            active={ai.active}
                            onStop={ai.stop}
                            onSend={async (text) => {
                              const id = ai.sessionId;
                              const sentContext = context;
                              try {
                                await ai.send(
                                  context
                                    ? `${text}\n\n${t`原文引用`} · ${contextTitleForDraft}（chapter_id=${context.chapterId}, ${context.line + 1}）：\n${context.text}`
                                    : text,
                                );
                              } catch {
                                // useAiSession exposes the failure; keep this draft and reference.
                                return;
                              }
                              setDrafts((old) =>
                                old[id] === text ? { ...old, [id]: "" } : old,
                              );
                              if (sentContext) clearReference(id, sentContext);
                            }}
                            toolbar={
                              <>
                                <ModelPicker
                                  models={models}
                                  value={selectedModel?.key ?? ""}
                                  onValueChange={chooseModel}
                                  label={t`下次请求使用的模型`}
                                  onOpenSettings={(returnFocusTo) =>
                                    openSettings("models", returnFocusTo)
                                  }
                                />
                                <ReasoningPicker
                                  choices={effortChoices}
                                  value={effectiveEffort}
                                  onChange={chooseEffort}
                                  label={t`思考强度`}
                                />
                                <ContextUsage
                                  snapshot={ai.snapshot}
                                  configuration={configuration}
                                />
                              </>
                            }
                          />
                        </div>
                      }
                    />
                  </div>
                </aside>
              </div>
            )}
          </div>
          {!reader.readOnly && (
            <div className="min-w-0 shrink-0">
              {" "}
              <ChapterAudioBar
                audio={audio}
                onAnalyze={() => {
                  if (!selectedModel) {
                    openSettings("models");
                    return;
                  }
                  setPanel("assistant");
                  setInspectorOpen(true);
                  if (small) setDirectoryOpen(false);
                  requestAnimationFrame(() => {
                    const analyze =
                      inspectorPanel.current?.querySelector<HTMLButtonElement>(
                        "[data-action=analyze-chapter]",
                      );
                    (analyze ?? assistantTasksTrigger.current)?.focus();
                  });
                }}
                onStart={(restart) =>
                  void afterPauseExit(() => void audio.start(restart))
                }
                chapterId={chapter.id}
                onLocate={locate}
                onCharacters={(target) => {
                  void afterPauseExit(() => {
                    setPauseObject(null);
                    setSelected(null);
                    setEvidence(null);
                    setVoiceTarget(target ?? { kind: "narrator" });
                    setPanel("inspector");
                    setInspectorOpen(true);
                    if (small) setDirectoryOpen(false);
                  });
                }}
                onChooseNarrator={openChapterAudioSettings}
                onChapter={(run) => {
                  void afterPauseExit(() => {
                    if (run.chapterId === chapter.id) setAudioMode(run.mode);
                    else {
                      workspace(project.id)[
                        `chapterAudioMode:${run.chapterId}`
                      ] = run.mode;
                      setChapterIdValue(run.chapterId);
                    }
                  });
                }}
              />
              <ChapterAudioTrack
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
                onStart={(restart) =>
                  void afterPauseExit(() => void audio.start(restart))
                }
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
                  if (audio.status?.arrangement.stale) return;
                  void afterPauseExit(() => {
                    setPauseObject(null);
                    const targetChapter = chapter.id;
                    void (async () => {
                      let segment = analysis.segments.find(
                        (s) =>
                          s.range.start <= range.start &&
                          range.start < s.range.end,
                      );
                      if (!segment && snapshot?.versionId) {
                        const page = await commands.chapterAnalysisSegments(
                          project.id,
                          snapshot.versionId,
                          range,
                          null,
                        );
                        segment = page.segments.find(
                          (s) =>
                            s.range.start <= range.start &&
                            range.start < s.range.end,
                        );
                      }
                      if (currentChapter.current !== targetChapter) return;
                      if (segment) choose(segment);
                      await locate(range);
                    })().catch(() => setOperationFailed(true));
                  });
                }}
              />
            </div>
          )}
        </div>
      </div>
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
