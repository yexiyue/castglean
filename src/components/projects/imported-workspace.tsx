import { Trans, useLingui } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { type ShouldBlockFn, useBlocker } from "@tanstack/react-router";
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
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { ContextUsage } from "@/components/ai-elements/context-usage";
import { ModelPicker } from "@/components/ai-elements/model-picker";
import { ReasoningPicker } from "@/components/ai-elements/reasoning-picker";
import { SessionInput } from "@/components/ai-elements/session-input";
import { SessionMessages } from "@/components/ai-elements/session-messages";
import {
  StartRecovered,
  StartRecovery,
} from "@/components/ai-elements/start-recovery";
import { BoundaryEditor } from "@/components/analysis/boundary-editor";
import { CandidateReview } from "@/components/analysis/candidate-review";
import { RoleSourceBlock } from "@/components/analysis/role-source-block";
import { SegmentInspector } from "@/components/analysis/segment-inspector";
import { VersionHistory } from "@/components/analysis/version-history";
import { BindingRecovery } from "@/components/projects/binding-recovery";
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
import { VirtualSourceReader } from "@/components/projects/virtual-source-reader";
import { useWorkspaceMode } from "@/components/projects/workspace-mode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
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
import { useSegmentEditDrafts } from "@/hooks/use-segment-edit-drafts";
import {
  type AnalysisSnapshot,
  commands,
  type LocalProjectSnapshot_Serialize,
  type Progress,
  type ReasoningSetting,
  type ResultReference,
  type Segment,
  type WorkspaceContext,
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
  onPointerDown?: () => void;
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
  const { openSettings, registerExitGuard, workspace } = useDesktopSession();
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
  const [display, setDisplay] = useWorkspaceState<"compact" | "original">(
    project.id,
    "analysisDisplay",
    "compact",
  );
  const [panel, setPanel] = useWorkspaceState<
    "inspector" | "assistant" | "characters"
  >(project.id, "chapterPanel", "inspector");
  const [directoryOverlay, setDirectoryOverlay] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<
    import("@/lib/bindings").BindingTarget | null
  >(null);
  const [castReviewRequest, setCastReviewRequest] = useState(0);
  const [editRequest, setEditRequest] = useState(0);
  const [locatedLine, setLocatedLine] = useState(0);
  const [issueType, setIssueType] = useState("all");
  const [splitReference, setSplitReference] = useState<ResultReference | null>(
    null,
  );
  const [boundary, setBoundary] = useState<ChapterBoundaryRequest | null>(null);
  const boundaryProject = useRef(project);
  boundaryProject.current = project;
  const [sessionHistoryOpen, setSessionHistoryOpen] = useState(false);
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
  const pauseExitGuard = useRef<(() => Promise<boolean>) | null>(null);
  const pauseOperationGuard = useRef<(() => boolean) | null>(null);
  const pauseDirtyGuard = useRef<(() => boolean) | null>(null);
  const boundaryOperationPending = useRef(false);
  const [analysisBoundary, setAnalysisBoundary] = useState<{
    chapterId: string;
    segment: Segment;
    snapshot: AnalysisSnapshot;
  } | null>(null);
  const afterPauseExit = useCallback(
    (action: () => void) => {
      if (boundaryOperationPending.current) return Promise.resolve(false);
      const guard = pauseExitGuard.current;
      const ready = guard ? guard() : Promise.resolve(true);
      return ready.then((saved) => {
        const allowed = saved && (pauseOperationGuard.current?.() ?? true);
        if (allowed) action();
        else {
          setPanel("inspector");
          setInspectorOpen(true);
        }
        return allowed;
      });
    },
    [setInspectorOpen, setPanel],
  );
  const setChapterId = useCallback(
    (id: string) => {
      if (id !== chapterId) void afterPauseExit(() => setChapterIdValue(id));
    },
    [afterPauseExit, chapterId, setChapterIdValue],
  );
  useEffect(
    () => registerExitGuard(project.id, () => afterPauseExit(() => {})),
    [project.id, registerExitGuard, afterPauseExit],
  );
  const shouldBlockNavigation = useCallback<ShouldBlockFn>(
    async ({ current, next }) =>
      current.pathname !== next.pathname && !(await afterPauseExit(() => {})),
    [afterPauseExit],
  );
  const shouldBlockUnload = useCallback(
    () =>
      (pauseDirtyGuard.current?.() ?? false) ||
      boundaryOperationPending.current ||
      !(pauseOperationGuard.current?.() ?? true),
    [],
  );
  useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    enableBeforeUnload: shouldBlockUnload,
  });
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
  const analysisButton = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const reading = useMemo(
    () => chapterReadingRange(project.chapters, chapter),
    [project.chapters, chapter],
  );
  const analysis = useChapterAnalysis(project.id, chapter.id);
  const segmentEdits = useSegmentEditDrafts(project.id);
  const pendingSegmentEdits = Object.values(segmentEdits.states).filter(
    (state) =>
      state.target && (state.status === "saving" || state.status === "failed"),
  );
  const audio = useChapterAudio(project.id, chapter.id);
  const { player, setSource, returnTarget, clearReturn } = useChapterPlayback();
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
  /** 片段就近播放投影：可播片段集合、跟读片段与起播入口（依赖播放会话与单元快照）。 */
  const segmentPlayback = useMemo(() => {
    if (audio.status?.arrangement.stale) return null;
    const units = audio.status?.units ?? [];
    const playable = new Set<string>();
    const firstUnit = new Map<string, number>();
    for (const unit of units) {
      if (unit.mediaId == null) continue;
      playable.add(unit.segmentId);
      if (!firstUnit.has(unit.segmentId)) {
        firstUnit.set(unit.segmentId, unit.index);
      }
    }
    if (!playable.size) return null;
    const playingId =
      player.state.active &&
      player.state.target?.projectId === project.id &&
      player.state.target.chapterId === chapter.id &&
      player.state.target.runId === audio.status?.run.id
        ? (player.state.unit?.segmentId ?? null)
        : null;
    return {
      playable,
      playingId,
      playing: player.state.playing,
      toggle: (segmentId: string) => {
        if (playingId === segmentId) player.toggle();
        else {
          const index = firstUnit.get(segmentId);
          if (index != null) player.start(index);
        }
      },
    };
  }, [
    audio.status,
    player.state.active,
    player.state.unit,
    player.state.target,
    player.state.playing,
    project.id,
    chapter.id,
    player.start,
    player.toggle,
  ]);
  const snapshot = analysis.data?.snapshot ?? null;
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
    if (charactersRequest) setPanel("characters");
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
      label={panel === "inspector" ? t`片段属性` : t`AI 助手`}
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
      chapterTitle: chapterAtLine(i.sourceId, i.line)?.title ?? "",
      detail: undefined,
      filename:
        project.sources.find((s) => s.id === i.sourceId)?.filename ?? "",
    }))
    .filter(
      (i) =>
        !issueSearch.trim() ||
        (/^\d+$/.test(issueSearch.trim())
          ? i.line + 1 === Number(issueSearch.trim())
          : `${i.title} ${i.chapterTitle} ${i.filename} ${t`章节结构`}`
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
              if (audio.blockers) {
                const check = await commands.chapterAudioCheck(
                  project.id,
                  capturedChapter,
                );
                if (currentChapter.current !== capturedChapter) return;
                audio.updateBlockers(check.blockers);
              }
              if (currentChapter.current === capturedChapter)
                await audio.refresh();
            })().catch(() => setOperationFailed(true));
          }}
        />
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
                {!reader.readOnly && (
                  <IconAction
                    label={t`编辑章节`}
                    onClick={() => setEditRequest((n) => n + 1)}
                  >
                    <PencilIcon />
                  </IconAction>
                )}
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
                    <Field>
                      <FieldLabel htmlFor={`${panelId}-issue-type`}>
                        <Trans>问题类型</Trans>
                      </FieldLabel>
                      <NativeSelect
                        id={`${panelId}-issue-type`}
                        value={issueType}
                        onChange={(e) => setIssueType(e.target.value)}
                      >
                        <option value="all">{t`全部问题`}</option>
                        <option value="structure">{t`章节结构`}</option>
                        <option value="attribution">{t`人物归属`}</option>
                      </NativeSelect>
                    </Field>
                    <Field className="mt-2">
                      <FieldLabel htmlFor={`${panelId}-issue-scope`}>
                        <Trans>待检查范围</Trans>
                      </FieldLabel>
                      <NativeSelect
                        id={`${panelId}-issue-scope`}
                        value={issueScope}
                        onChange={(e) => setIssueScope(e.target.value)}
                      >
                        <option value="chapter">{t`本章`}</option>
                        <option value="book">{t`全书`}</option>
                      </NativeSelect>
                    </Field>
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
                (issueType !== "structure" ? structuralScope.length : 0) +
                (issueType !== "structure"
                  ? issueScope === "chapter"
                    ? (snapshot?.pendingCount ?? 0)
                    : (analysis.data?.directory
                        .filter((d) => !d.stale)
                        .reduce((n, d) => n + d.pendingCount, 0) ?? 0)
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {panel === "characters" && reader.readOnly ? (
              <div className="text-muted-foreground p-6 text-sm">
                <Trans>示例工程仅供阅读；在真实工程中可管理角色与声音。</Trans>
              </div>
            ) : panel === "characters" ? (
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
            ) : null}
            <section
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col",
                panel === "characters" ? "hidden" : "flex",
              )}
            >
              <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
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
                {(!snapshot?.versionId || snapshot.stale) && (
                  <IconAction
                    label={
                      display === "compact"
                        ? t`切换为原样显示`
                        : t`切换为紧凑显示`
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
                )}
                {!reader.readOnly && (
                  <StructureActions
                    project={project}
                    chapter={chapter}
                    line={locatedLine}
                    active={ai.active}
                    onChange={changed}
                    onLocate={locateSource}
                    onAddSources={onAddSources}
                    editRequest={editRequest}
                    deferProposalResult={!!splitReference}
                  />
                )}
                {!reader.readOnly && (
                  <IconAction
                    label={t`撤销本章分析修改`}
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
                )}
                {!reader.readOnly && (
                  <div className="flex w-full flex-wrap items-center gap-1 xl:w-auto">
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
                          .send(
                            t`请检查全书分章结构，提出可审阅的修复方案。`,
                            "split",
                          )
                          .catch(() => setOperationFailed(true));
                      }}
                    >
                      <FilterIcon />
                      <span>
                        <Trans>检查分章</Trans>
                      </span>
                    </Button>
                    <Button
                      ref={analysisButton}
                      size="sm"
                      aria-label={
                        snapshot?.versionId ? t`重新分析` : t`分析本章`
                      }
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
                      <span>
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
                        !audio.desktop ||
                        audio.starting ||
                        audio.active !== null
                      }
                      onClick={() =>
                        void afterPauseExit(() => void audio.start())
                      }
                    >
                      {audio.starting ? (
                        <Loader2Icon
                          data-icon="inline-start"
                          className="motion-safe:animate-spin"
                        />
                      ) : (
                        <AudioLinesIcon data-icon="inline-start" />
                      )}
                      <span>
                        {audio.status?.run.status === "succeeded" ? (
                          <Trans>重新生成音频</Trans>
                        ) : (
                          <Trans>生成本章音频</Trans>
                        )}
                      </span>
                    </Button>
                  </div>
                )}
              </header>
              {analysis.failure || issues.failed ? (
                <div
                  role="alert"
                  className="text-destructive flex items-center gap-2 border-b px-3 py-2 text-xs"
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
                  className="text-destructive flex items-center gap-2 border-b px-3 py-2 text-xs"
                >
                  <span className="flex-1">
                    <Trans>
                      操作未完成，请检查原位置；关闭提示不会重试操作。
                    </Trans>
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
              {ai.failure && (
                <div
                  role="alert"
                  className="text-destructive flex items-center gap-2 border-b px-3 py-2 text-xs"
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
                <p className="text-warning border-b px-3 py-2 text-xs">
                  <Trans>
                    章节来源或边界已变化，旧分析仅供查看，请重新分析。
                  </Trans>
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
                          <Trans>
                            片段修改已保存，待读取：{targetChapter.title}
                          </Trans>
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
              {!reader.readOnly && !selectedModel ? (
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
                  <div
                    key={line.line}
                    className="group relative"
                    onPointerDown={() => setLocatedLine(line.line)}
                  >
                    <SourceLine
                      line={line}
                      highlight={
                        evidence?.chapterId === chapter.id
                          ? evidence.range
                          : null
                      }
                      onSelect={() => setLocatedLine(line.line)}
                    />
                    {!reader.readOnly && (
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
                              disabled={ai.active || !!structureOperation}
                              className="bg-background absolute top-0 right-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                              onClick={() => {
                                const heading = project.chapters.some(
                                  (c) =>
                                    c.sourceId === chapter.sourceId &&
                                    c.heading === line.line,
                                );
                                setBoundary({
                                  projectId: project.id,
                                  projectTitle: project.title,
                                  chapterTitle: chapter.title,
                                  filename:
                                    project.sources.find(
                                      (source) =>
                                        source.id === chapter.sourceId,
                                    )?.filename ?? "",
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
                    )}
                  </div>
                )}
                selectionAction={
                  hasSelection && !reader.readOnly ? (
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
                      onClick={() =>
                        setChapterId(project.chapters[index - 1].id)
                      }
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
                      onClick={() =>
                        setChapterId(project.chapters[index + 1].id)
                      }
                    >
                      <Trans>下一章</Trans>
                    </Button>
                  </div>
                }
              />
            </section>
            {!reader.readOnly && (
              <aside
                ref={inspectorPanel}
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
                      {panel === "inspector" ? t`片段属性` : t`AI 助手`}
                    </h2>
                  </div>
                  <div className="flex gap-1">
                    <IconAction
                      label={
                        panel === "inspector" ? t`分析版本历史` : t`会话历史`
                      }
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
                  <div className={pauseObject != null ? "hidden" : "contents"}>
                    {inspectedUnit && (
                      <div className="flex shrink-0 flex-col gap-2 border-b p-3 text-xs">
                        <span>
                          {inspectedUnit.characterName ?? t`旁白`} ·{" "}
                          {inspectedUnit.voice}
                        </span>
                        <span>
                          {inspectedUnit.mediaId
                            ? t`音频已生成`
                            : inspectedUnit.status === "failed"
                              ? t`生成失败`
                              : t`等待生成`}
                        </span>
                        {inspectedUnit.durationMs != null && (
                          <span>
                            {(inspectedUnit.durationMs / 1000).toFixed(2)}s
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!inspectedUnit.mediaId}
                          onClick={() => void player.start(inspectedUnit.index)}
                        >
                          <Trans>从这里播放</Trans>
                        </Button>
                      </div>
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
                        segment={
                          analysis.segments.find(
                            (s) => s.id === selected?.id,
                          ) ?? selected
                        }
                        characters={characters}
                        onSaved={saved}
                        onLocate={(r) => void locate(r)}
                      />
                    )}
                    <ChapterVoicePanel
                      key={project.id}
                      projectId={project.id}
                      characters={characters}
                      segment={
                        analysis.segments.find((s) => s.id === selected?.id) ??
                        selected
                      }
                      requestedTarget={voiceTarget}
                    />
                  </div>
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
                                : t`分析已完成，可直接编辑`}
                          </TraceTitle>
                          <TraceDescription>
                            {progress.agent?.elapsedMs != null
                              ? `${Math.round(progress.agent.elapsedMs / 1000)}s`
                              : t`等待模型响应`}
                            {progress.agent && (
                              <span className="ml-2">
                                {progress.agent.stage === "review"
                                  ? t`正在预审`
                                  : progress.agent.stage === "completed"
                                    ? t`预审已完成`
                                    : t`正在标注`}
                                {" · "}
                              </span>
                            )}
                          </TraceDescription>
                        </TraceLine>
                        {progress.agent && (
                          <div className="text-muted-foreground space-y-1 text-xs">
                            <details>
                              <summary className="cursor-pointer">
                                <Trans comment="展开分析请求数、token 与计时信息">
                                  技术用量
                                </Trans>
                              </summary>
                              <p>
                                <Trans>
                                  模型请求 {progress.agent.requests} 次
                                </Trans>
                                {" · "}
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
                                  : Math.round(
                                      progress.agent.elapsedMs / 1000,
                                    )}{" "}
                                s
                                {!progress.agent.timingComplete && (
                                  <span className="ml-2">
                                    <Trans>耗时记录尚不完整</Trans>
                                  </span>
                                )}
                              </p>
                            </details>
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
                                          onClick={() =>
                                            void locate(finding.range)
                                          }
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
                                                  ? finding.candidateNames.join(
                                                      " / ",
                                                    )
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
                          {(ai.snapshot.run.error === "timeout" ||
                            ai.snapshot.run.error ===
                              "configuration_unavailable" ||
                            ai.snapshot.run.error === "configuration_changed" ||
                            ai.snapshot.run.error === "unknown") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="self-start"
                              onClick={() => openSettings("models")}
                            >
                              <Trans>检查服务连接</Trans>
                            </Button>
                          )}
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
                      if (project.chapters.some((c) => c.id === id))
                        setChapterId(id);
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void ai.stop()}
                    >
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
                          模型配置已变化，确认后使用 {selectedModel?.name}{" "}
                          继续。
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
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={context.text}
                      >
                        {
                          project.chapters.find(
                            (c) => c.id === context.chapterId,
                          )?.title
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
                  {ai.pendingStart && (
                    <StartRecovery
                      missing={ai.pendingStatus === "missing"}
                      busy={ai.checkingPending}
                      onCheck={() => void ai.checkPendingStart()}
                      onRetry={() => void ai.retryPendingStart()}
                      onStop={() => void ai.stopPendingRecovery()}
                    />
                  )}
                  {ai.recoveredStart && (
                    <StartRecovered
                      outcome={ai.recoveredStart}
                      onAcknowledge={ai.acknowledgeRecoveredStart}
                    />
                  )}
                  <SessionInput
                    label={t`工程问题或补充说明`}
                    placeholder={t`检查分章、分析人物、选角，或询问原文…`}
                    value={draft}
                    onChange={(value) =>
                      setDrafts((old) => ({ ...old, [ai.sessionId]: value }))
                    }
                    disabled={
                      !selectedModel ||
                      ai.loading ||
                      needsModelConfirmation ||
                      ai.pendingStart ||
                      !!ai.recoveredStart
                    }
                    active={ai.active}
                    onStop={ai.stop}
                    onSend={async (text) => {
                      const id = ai.sessionId;
                      const sentContext = context;
                      try {
                        await ai.send(
                          context
                            ? `${text}\n\n${t`原文引用`} · ${project.chapters.find((c) => c.id === context.chapterId)?.title}（chapter_id=${context.chapterId}, ${context.line + 1}）：\n${context.text}`
                            : text,
                        );
                      } catch {
                        // useAiSession exposes the failure; keep this draft and reference.
                        return;
                      }
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
            )}
          </div>
          {!reader.readOnly && (
            <div className={panel === "characters" ? "hidden" : "shrink-0"}>
              {" "}
              <ChapterAudioBar
                audio={audio}
                onAnalyze={() => {
                  if (!selectedModel) {
                    openSettings("models");
                    return;
                  }
                  if (analysisButton.current?.disabled) {
                    setPanel("assistant");
                    setInspectorOpen(true);
                    if (small) setDirectoryOpen(false);
                    return;
                  }
                  analysisButton.current?.focus();
                }}
                onStart={(restart) =>
                  void afterPauseExit(() => void audio.start(restart))
                }
                chapterId={chapter.id}
                onLocate={locate}
                onCharacters={(target) => {
                  setVoiceTarget(target ?? { kind: "narrator" });
                  setPanel("inspector");
                  setInspectorOpen(true);
                  if (small) setDirectoryOpen(false);
                }}
                onChapter={setChapterId}
              />
              <ChapterAudioTrack
                audio={audio}
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
                  ai.selectSession(session.id);
                  setSessionHistoryOpen(false);
                }}
              >
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
