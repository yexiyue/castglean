import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useBindingOperations } from "@/hooks/use-binding-operations";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useModelResources } from "@/hooks/use-model-resources";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import {
  type BindingStateView_Serialize,
  type BindingTarget,
  type ByteRange,
  type Chapter_Serialize,
  type Character,
  commands,
  type DesignDraft,
  type LibraryVoice,
  type ProfileView_Serialize,
  type SuggestionView_Serialize,
  type VoiceRef,
} from "@/lib/bindings";
import { cn } from "@/lib/utils";
import { characterDisplayLabel, sameTarget } from "@/lib/voice-audition";
import { CharacterDesignDialog } from "./character-design-dialog";
import { CharacterTargetDetail } from "./character-target-detail";
import {
  type CenterSelection,
  CharacterTargetList,
} from "./character-target-list";
import { type BindTargetOption, DesignCandidates } from "./design-candidates";

/**
 * 工程角色中心：master-detail。左列目标（旁白、已确认角色、候选身份），
 * 右列所选目标的身份、绑定、画像、建议对照与设计；播放走真实音频租约。
 */
export function CharacterCenter(
  props: Parameters<typeof ProjectCharacterCenter>[0],
) {
  return <ProjectCharacterCenter key={props.projectId} {...props} />;
}

function selectionIdentity(selection: CenterSelection): string {
  if (selection.target.kind === "narrator") return "narrator";
  return selection.target.character_id;
}

function ProjectCharacterCenter({
  projectId,
  chapterId,
  revision,
  projectRevision,
  characters,
  chapters,
  selectedRange,
  onLocate,
  onSaved,
  castRunning,
  reviewRequest,
  reviewRunId = null,
}: {
  projectId: string;
  chapterId: string;
  /** 分析修订：身份命令（复用等）的期望修订。 */
  revision: number;
  /** 工程修订：绑定/画像/采用命令的期望修订。 */
  projectRevision: number;
  characters: Character[];
  chapters: Chapter_Serialize[];
  selectedRange: ByteRange | null;
  onLocate: (
    chapterId: string,
    versionId: string,
    segmentId: string,
    range: ByteRange,
  ) => Promise<void>;
  onSaved: () => Promise<void>;
  castRunning: boolean;
  reviewRequest: number;
  reviewRunId?: string | null;
}) {
  const { t } = useLingui();
  const studio = useVoiceStudio();
  const small = useMediaQuery("(max-width: 1100px)");
  const [query, setQuery] = useState("");
  const bindingOperations = useBindingOperations(projectId);
  const busy =
    !!bindingOperations.operation ||
    !!bindingOperations.profileOperation ||
    !!bindingOperations.identityOperation;
  const latestBinding = bindingOperations.latest;
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [bindings, setBindings] = useState<BindingStateView_Serialize[]>([]);
  const [profiles, setProfiles] = useState<ProfileView_Serialize[]>([]);
  const [suggestion, setSuggestion] = useState<SuggestionView_Serialize | null>(
    null,
  );
  const modelResources = useModelResources();
  const models =
    modelResources.loading || modelResources.error
      ? []
      : modelResources.entries;
  const [libraryVoices, setLibraryVoices] = useState<LibraryVoice[]>([]);
  const [selection, setSelection] = useState<CenterSelection>({
    kind: "target",
    target: { kind: "narrator" },
  });
  const [design, setDesign] = useState<{
    target: BindingTarget;
    draft: DesignDraft;
  } | null>(null);
  const detailScroll = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const refreshGeneration = useRef(0);
  const refreshing = useRef(false);
  // 切换目标时详情回到顶部并整体重建（表单与展开态随选择复位）。
  const selectionKey = selectionIdentity(selection);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 滚动复位只看选中键，不依赖其余渲染值。
  useEffect(() => {
    detailScroll.current?.scrollTo({ top: 0 });
  }, [selectionKey]);

  const refresh = useCallback(
    async (includeResources = true) => {
      if (!mounted.current) return;
      const generation = ++refreshGeneration.current;
      const bindingGeneration = bindingOperations.completion;
      const current = () =>
        mounted.current && generation === refreshGeneration.current;
      refreshing.current = true;
      setLoading(true);
      try {
        const [nextBindings, nextProfiles, nextSuggestion, inventory] =
          await Promise.all([
            commands.voiceBindingBindings(projectId),
            commands.voiceBindingProfiles(projectId),
            commands.voiceBindingSuggestion(projectId, reviewRunId),
            includeResources
              ? commands.listLibraryVoices()
              : Promise.resolve(null),
          ]);
        if (!current()) return;
        if (bindingGeneration === bindingOperations.completion)
          setBindings(nextBindings);
        if (bindingGeneration === bindingOperations.completion)
          setProfiles(nextProfiles);
        setSuggestion(nextSuggestion);
        if (inventory) setLibraryVoices(inventory.voices);
        setLoaded(true);
        setReadFailed(false);
      } catch {
        if (current()) setReadFailed(true);
      } finally {
        if (current()) {
          refreshing.current = false;
          setLoading(false);
        }
      }
    },
    [projectId, bindingOperations, reviewRunId],
  );
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      refreshGeneration.current += 1;
    };
  }, [refresh]);
  useEffect(() => {
    if (latestBinding) {
      setBindings(latestBinding.bindings);
    }
  }, [latestBinding]);
  useEffect(() => {
    if (bindingOperations.latestProfiles)
      setProfiles(bindingOperations.latestProfiles);
  }, [bindingOperations.latestProfiles]);
  // 建议在宿主后台完成；任何运行结束（含选角）后重读一次建议记录。
  const running = useRef(castRunning);
  useEffect(() => {
    if (running.current && !castRunning) void refresh();
    running.current = castRunning;
  }, [castRunning, refresh]);
  // 会话结果卡的审阅动作：定位到首个有待审建议的目标。建议可能在导航
  // 之后才刷新出来，挂起标记等数据就绪再选中。
  const pendingReview = useRef(false);
  useEffect(() => {
    if (reviewRequest > 0) pendingReview.current = true;
  }, [reviewRequest]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 审阅信号先挂起，等刷新出的建议就绪再选中一次。
  useEffect(() => {
    if (!pendingReview.current || !suggestion) return;
    pendingReview.current = false;
    const first = suggestion.targets[0];
    if (first) setSelection({ kind: "target", target: first.target });
  }, [suggestion, reviewRequest]);

  function bindingVoiceLabel(voice: VoiceRef): string {
    if (voice.kind === "library") {
      return (
        libraryVoices.find((entry) => entry.id === voice.id)?.name ?? voice.id
      );
    }
    return `${voice.backend} / ${voice.model} / ${voice.voice}`;
  }
  function title(target: BindingTarget): string {
    if (target.kind === "narrator") return t`旁白`;
    return characterDisplayLabel(characters, target.character_id, t`未知角色`);
  }
  function bind(target: BindingTarget, voice: VoiceRef | null) {
    if (!mounted.current || refreshing.current || !loaded || readFailed || busy)
      return;
    void bindingOperations.start(
      target,
      voice ? { type: "bind", voice } : { type: "unbind" },
    );
  }

  const roles = useMemo(() => characters, [characters]);
  const bindOptions: BindTargetOption[] = useMemo(
    () => [
      { target: { kind: "narrator" } as BindingTarget, name: t`旁白` },
      ...roles.map((c) => ({
        target: { kind: "character", character_id: c.id } as BindingTarget,
        name: c.displayName,
      })),
    ],
    [roles, t],
  );
  const bindingFor = useCallback(
    (target: BindingTarget) =>
      bindings.find((b) => sameTarget(b.target, target)) ?? null,
    [bindings],
  );
  const hasSuggestion = useCallback(
    (target: BindingTarget) =>
      !!suggestion?.targets.some((entry) => sameTarget(entry.target, target)),
    [suggestion],
  );
  const selectedTarget = selection.kind === "target" ? selection.target : null;
  const selectedCharacter = ((): Character | null => {
    if (selectedTarget?.kind === "character")
      return (
        characters.find((c) => c.id === selectedTarget.character_id) ?? null
      );
    return null;
  })();
  const designCandidates = studio.candidates;
  const candidatesForDetail = selectedTarget
    ? designCandidates.filter((candidate) => {
        const origin = studio.originForCandidate(candidate.id);
        return (
          origin?.projectId === projectId &&
          sameTarget(origin.target, selectedTarget)
        );
      })
    : [];
  const sharedCandidates = designCandidates.filter(
    (candidate) => !studio.originForCandidate(candidate.id),
  );
  function renderCandidates(candidates: typeof designCandidates) {
    if (candidates.length === 0) return null;
    return (
      <DesignCandidates
        projectId={projectId}
        candidates={candidates}
        studio={studio}
        busy={
          busy ||
          loading ||
          readFailed ||
          studio.pending ||
          studio.loading ||
          studio.loadError
        }
        options={bindOptions}
        onBind={(target, libraryId) =>
          void bind(target, { kind: "library", id: libraryId })
        }
      />
    );
  }

  function renderDetail() {
    if (!loaded) {
      if (!loading) return null;
      return (
        <p className="text-xs text-muted-foreground">
          <Trans>读取中…</Trans>
        </p>
      );
    }
    if (!selectedCharacter && !selectedTarget) {
      return (
        <p className="text-sm text-muted-foreground">
          <Trans>从左侧选择一个目标。</Trans>
        </p>
      );
    }
    return (
      <CharacterTargetDetail
        key={`${chapterId}:${selectionKey}`}
        projectId={projectId}
        chapterId={chapterId}
        revision={revision}
        projectRevision={projectRevision}
        characters={characters}
        chapters={chapters}
        selectedRange={selectedRange}
        selection={selection}
        character={selectedCharacter}
        binding={selectedTarget ? (bindingFor(selectedTarget) ?? null) : null}
        profile={
          selectedTarget
            ? (profiles.find((p) => sameTarget(p.target, selectedTarget)) ??
              null)
            : null
        }
        suggestion={suggestion}
        studio={studio}
        models={models}
        voiceName={bindingVoiceLabel}
        libraryVoices={libraryVoices}
        modelsLoading={modelResources.loading}
        modelsError={!!modelResources.error}
        onModelsRetry={() => void modelResources.refresh()}
        busy={busy || loading || readFailed}
        onError={() => {
          if (mounted.current) setFailed(true);
        }}
        onViewChange={() => detailScroll.current?.scrollTo({ top: 0 })}
        onSaved={async () => {
          if (!mounted.current) return;
          await onSaved();
          await refresh();
        }}
        onLocate={onLocate}
        onBindVoice={(target, voice) => void bind(target, voice)}
        onProfileSave={(target, text, expected) =>
          void bindingOperations.startProfile(
            target,
            text,
            projectRevision,
            expected,
          )
        }
        onDesign={(target) => {
          setDesign({
            target,
            draft: {
              engine: null,
              prompt:
                profiles.find((p) => sameTarget(p.target, target))?.text ?? "",
            },
          });
        }}
        designSlot={
          <>
            {renderCandidates(candidatesForDetail)}
            {sharedCandidates.length > 0 && (
              <details className="py-1">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  <Trans comment="尚未正式保存的声音">音色候选</Trans>
                </summary>
                <div className="pt-2">{renderCandidates(sharedCandidates)}</div>
              </details>
            )}
          </>
        }
      />
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1", small ? "flex-col" : undefined)}>
      <aside
        aria-label={t`角色列表`}
        data-slot="character-directory"
        className={cn(
          "flex min-h-0 shrink-0 flex-col",
          small ? "max-h-56 border-b" : "w-72 border-r",
        )}
      >
        <header className="flex h-12 shrink-0 items-center border-b px-3">
          <h2 className="text-sm font-medium">
            <Trans>工程角色</Trans>
          </h2>
        </header>
        <CharacterTargetList
          characters={characters}
          hasSuggestion={hasSuggestion}
          bindingFor={bindingFor}
          voiceName={bindingVoiceLabel}
          query={query}
          onQueryChange={setQuery}
          selection={selection}
          onSelect={setSelection}
        />
      </aside>
      <div
        data-slot="character-detail"
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {failed || readFailed || studio.error ? (
          <div
            role="alert"
            className="flex items-center justify-between border-b px-5 py-2 text-xs text-destructive"
          >
            {readFailed ? (
              <Trans>角色与音色读取失败，请重试。</Trans>
            ) : studio.error && !failed ? (
              <Trans>音色操作未完成，请检查输入与任务状态后重试。</Trans>
            ) : (
              <Trans>操作未保存，请刷新后重试。已有结果保留。</Trans>
            )}
            <Button size="xs" variant="ghost" onClick={() => void refresh()}>
              <Trans>重试读取</Trans>
            </Button>
          </div>
        ) : null}
        <section
          ref={detailScroll}
          aria-label={t`目标详情`}
          className="flex min-w-0 flex-1 flex-col overflow-y-auto px-5 py-4"
        >
          {renderDetail()}
        </section>
      </div>

      {design ? (
        <CharacterDesignDialog
          key={JSON.stringify(design.target)}
          projectId={projectId}
          target={design.target}
          targetLabel={title(design.target)}
          initial={design.draft}
          studio={studio}
          onClose={() => setDesign(null)}
        />
      ) : null}
    </div>
  );
}
