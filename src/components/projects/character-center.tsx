import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StudioJobs } from "@/components/voices/studio-jobs";
import { useMediaQuery } from "@/hooks/use-media-query";
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
  type ModelEntry,
  type ProfileView_Serialize,
  type SuggestionView_Serialize,
  type VoiceRef,
} from "@/lib/bindings";
import { cn } from "@/lib/utils";
import { sameTarget } from "@/lib/voice-audition";
import { CharacterDesignDialog } from "./character-design-dialog";
import { CharacterTargetDetail } from "./character-target-detail";
import {
  type CenterSelection,
  CharacterTargetList,
} from "./character-target-list";
import { CharacterVoicePickerDialog } from "./character-voice-picker";
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
  if (selection.kind === "candidate")
    return `candidate:${selection.characterId}`;
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
}) {
  const { t } = useLingui();
  const studio = useVoiceStudio();
  const small = useMediaQuery("(max-width: 1100px)");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [bindings, setBindings] = useState<BindingStateView_Serialize[]>([]);
  const [profiles, setProfiles] = useState<ProfileView_Serialize[]>([]);
  const [suggestion, setSuggestion] = useState<SuggestionView_Serialize | null>(
    null,
  );
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [libraryVoices, setLibraryVoices] = useState<LibraryVoice[]>([]);
  const [selection, setSelection] = useState<CenterSelection>({
    kind: "target",
    target: { kind: "narrator" },
  });
  const [picker, setPicker] = useState<BindingTarget | null>(null);
  const [design, setDesign] = useState<{
    target: BindingTarget;
    draft: DesignDraft;
  } | null>(null);
  const [designTarget, setDesignTarget] = useState<BindingTarget | null>(null);
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

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const generation = ++refreshGeneration.current;
    const current = () =>
      mounted.current && generation === refreshGeneration.current;
    refreshing.current = true;
    setLoading(true);
    try {
      const [
        nextBindings,
        nextProfiles,
        nextSuggestion,
        nextModels,
        inventory,
      ] = await Promise.all([
        commands.voiceBindingBindings(projectId),
        commands.voiceBindingProfiles(projectId),
        commands.voiceBindingSuggestion(projectId, null),
        commands.listModels(),
        commands.listLibraryVoices(),
      ]);
      if (!current()) return;
      setBindings(nextBindings);
      setProfiles(nextProfiles);
      setSuggestion(nextSuggestion);
      setModels(nextModels);
      setLibraryVoices(inventory.voices);
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
  }, [projectId]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      refreshGeneration.current += 1;
    };
  }, [refresh]);
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

  async function run(fn: () => Promise<unknown>) {
    if (!mounted.current || refreshing.current || !loaded || readFailed || busy)
      return;
    setBusy(true);
    setFailed(false);
    try {
      await fn();
      if (!mounted.current) return;
      await onSaved();
      await refresh();
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
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
    return (
      characters.find((c) => c.id === target.character_id)?.displayName ??
      t`未知角色`
    );
  }
  function bind(target: BindingTarget, voice: VoiceRef | null) {
    const binding = bindings.find((b) => sameTarget(b.target, target));
    return run(() =>
      commands.voiceBindingEdit(
        projectId,
        target,
        crypto.randomUUID(),
        projectRevision,
        binding?.revision ?? 0,
        voice ? { type: "bind", voice } : { type: "unbind" },
      ),
    );
  }

  const confirmed = useMemo(
    () => characters.filter((c) => c.status === "confirmed"),
    [characters],
  );
  const bindOptions: BindTargetOption[] = useMemo(
    () => [
      { target: { kind: "narrator" } as BindingTarget, name: t`旁白` },
      ...confirmed.map((c) => ({
        target: { kind: "character", character_id: c.id } as BindingTarget,
        name: c.displayName,
      })),
    ],
    [confirmed, t],
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
    if (selection.kind === "candidate")
      return characters.find((c) => c.id === selection.characterId) ?? null;
    if (selectedTarget?.kind === "character")
      return (
        characters.find((c) => c.id === selectedTarget.character_id) ?? null
      );
    return null;
  })();
  const unsavedDesign = studio.candidates.filter(
    (candidate) => !candidate.saved_id,
  );
  const designCandidates = studio.candidates;
  const candidatesForDetail =
    selectedTarget && designTarget && sameTarget(selectedTarget, designTarget)
      ? { origin: designTarget, list: designCandidates }
      : null;

  function renderDetail() {
    if (!loaded) {
      if (!loading) return null;
      return (
        <p className="text-muted-foreground text-xs">
          <Trans>读取中…</Trans>
        </p>
      );
    }
    if (!selectedCharacter && !selectedTarget) {
      return (
        <p className="text-muted-foreground text-sm">
          <Trans>从左侧选择一个目标。</Trans>
        </p>
      );
    }
    return (
      <CharacterTargetDetail
        key={selectionKey}
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
        busy={busy || loading || readFailed}
        onRun={run}
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
        onPick={(target) => setPicker(target)}
        onBind={(target) => void bind(target, null)}
        onProfileSave={(target, text, expected) =>
          void run(() =>
            commands.voiceBindingProfileSet(
              projectId,
              target,
              crypto.randomUUID(),
              projectRevision,
              expected,
              text,
            ),
          )
        }
        onDesign={(target) => {
          setDesignTarget(target);
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
          candidatesForDetail?.list.length ? (
            <DesignCandidates
              candidates={candidatesForDetail.list}
              studio={studio}
              busy={busy || loading || readFailed || studio.pending}
              preselected={candidatesForDetail.origin}
              options={bindOptions}
              onBind={(target, libraryId) =>
                void bind(target, { kind: "library", id: libraryId })
              }
            />
          ) : null
        }
      />
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1",
        small ? "flex-col overflow-y-auto" : undefined,
      )}
    >
      <aside
        aria-label={t`角色列表`}
        className={cn(
          "flex min-h-0 shrink-0 flex-col [&>*]:shrink-0",
          small ? "border-b" : "w-72 border-r",
        )}
      >
        <header className="px-3 pt-3 pb-2">
          <h2 className="text-sm font-medium">
            <Trans>工程角色</Trans>
          </h2>
          <p className="text-muted-foreground text-xs">
            <Trans>
              身份在全书保持稳定；绑定、画像与选角建议都由人工确认。
            </Trans>
          </p>
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
          footer={
            <>
              {studio.error ? (
                <p role="alert" className="text-destructive px-3 pt-2 text-xs">
                  <Trans>音色操作未完成，请检查输入与任务状态后重试。</Trans>
                </p>
              ) : null}
              <div className="px-1">
                <StudioJobs studio={studio} />
              </div>
              {suggestion?.rejected.length ? (
                <details className="px-2 pt-2 pb-3">
                  <summary className="text-muted-foreground cursor-pointer text-xs">
                    <Trans>已剔除条目（{suggestion.rejected.length}）</Trans>
                  </summary>
                  {suggestion.rejected.map((rejected) => (
                    <p
                      key={`${rejected.voiceKey}:${rejected.target ? JSON.stringify(rejected.target) : "any"}:${rejected.reason}`}
                      className="text-muted-foreground pt-1 text-xs"
                    >
                      {rejected.voiceKey} · {rejected.reason}
                    </p>
                  ))}
                </details>
              ) : null}
              {!designTarget && unsavedDesign.length ? (
                <div className="px-2 pb-3">
                  <DesignCandidates
                    candidates={designCandidates}
                    studio={studio}
                    busy={busy || loading || readFailed || studio.pending}
                    preselected={{ kind: "narrator" }}
                    options={bindOptions}
                    onBind={(target, libraryId) =>
                      void bind(target, { kind: "library", id: libraryId })
                    }
                  />
                </div>
              ) : null}
            </>
          }
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {failed || readFailed ? (
          <div
            role="alert"
            className="text-destructive flex items-center justify-between border-b px-5 py-2 text-xs"
          >
            {readFailed ? (
              <Trans>角色与音色读取失败，请重试。</Trans>
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

      {picker ? (
        <CharacterVoicePickerDialog
          label={title(picker)}
          libraryVoices={libraryVoices}
          models={models}
          busy={busy || loading || readFailed || studio.pending}
          studio={studio}
          current={bindingFor(picker)?.voice ?? null}
          onClose={() => setPicker(null)}
          onPick={(voice) => {
            const target = picker;
            setPicker(null);
            void bind(target, voice);
          }}
        />
      ) : null}
      {design ? (
        <CharacterDesignDialog
          targetLabel={title(design.target)}
          initial={design.draft}
          studio={studio}
          onClose={() => setDesign(null)}
        />
      ) : null}
    </div>
  );
}
