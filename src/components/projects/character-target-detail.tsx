import { Trans, useLingui } from "@lingui/react/macro";
import { AudioLinesIcon, BarChart3Icon, PencilIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type { VoiceRef } from "@/lib/bindings";
import {
  type AliasView,
  type BindingStateView_Serialize,
  type BindingTarget,
  type ByteRange,
  type Chapter_Serialize,
  type Character,
  type CharacterUsage,
  commands,
  type ModelEntry,
  type ProfileView_Serialize,
  type SuggestionView_Serialize,
  type TargetUsageView,
} from "@/lib/bindings";
import { cn } from "@/lib/utils";
import { CastingSuggestionPanel } from "./casting-suggestion-panel";
import type { CenterSelection } from "./character-target-list";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b py-5 first:pt-1 last:border-b-0">
      <h3 className="text-foreground/80 text-xs font-medium tracking-wide">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Detail column of the character center: a stable tabbed frame (voice work vs
 * identity work). Actions never appear or disappear with state; expanded data
 * lives in bounded boxes instead of pushing the page around.
 */
export function CharacterTargetDetail({
  projectId,
  chapterId,
  revision,
  projectRevision,
  characters,
  chapters,
  selectedRange,
  selection,
  character,
  binding,
  profile,
  suggestion,
  studio,
  models,
  voiceName,
  busy,
  onRun,
  onError,
  onSaved,
  onViewChange,
  onLocate,
  onPick,
  onBind,
  onProfileSave,
  onDesign,
  designSlot,
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
  selection: CenterSelection;
  character: Character | null;
  binding: BindingStateView_Serialize | null;
  profile: ProfileView_Serialize | null;
  suggestion: SuggestionView_Serialize | null;
  studio: VoiceStudio;
  models: ModelEntry[];
  voiceName: (voice: VoiceRef) => string;
  busy: boolean;
  onRun: (fn: () => Promise<unknown>) => Promise<void>;
  onError: () => void;
  /** 视图切换（tab）时的复位钩子，由持有滚动容器的父级提供。 */
  onViewChange?: () => void;
  onSaved: () => Promise<void>;
  onLocate: (
    chapterId: string,
    versionId: string,
    segmentId: string,
    range: ByteRange,
  ) => Promise<void>;
  onPick: (target: BindingTarget) => void;
  onBind: (target: BindingTarget) => void;
  onProfileSave: (
    target: BindingTarget,
    text: string,
    expectedRevision: number,
  ) => void;
  onDesign: (target: BindingTarget) => void;
  designSlot: ReactNode;
}) {
  const { t } = useLingui();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState(character?.displayName ?? "");
  const [aliasName, setAliasName] = useState("");
  const [aliasReason, setAliasReason] = useState("");
  const [reuse, setReuse] = useState("");
  const [profileText, setProfileText] = useState(profile?.text ?? "");
  const [usage, setUsage] = useState<TargetUsageView | null>(null);
  const [identity, setIdentity] = useState<{
    revision: number;
    usage: CharacterUsage[];
    aliases: AliasView[];
  } | null>(null);
  useEffect(() => setProfileText(profile?.text ?? ""), [profile?.text]);
  const isCandidate = character?.status === "candidate";
  const target: BindingTarget = selection.target;
  const roles = characters;
  const voice = binding?.voice ?? null;
  const invalid = voice && binding?.validity && binding.validity !== "valid";
  const title = target
    ? target.kind === "narrator"
      ? t`旁白`
      : (character?.displayName ?? t`未知角色`)
    : (character?.displayName ?? t`未知角色`);

  async function loadIdentity() {
    if (!character) return;
    try {
      const [used, aliases] = await Promise.all([
        commands.chapterAnalysisCharacterUsage(projectId, character.id),
        commands.chapterAnalysisCharacterAliases(projectId, character.id),
      ]);
      setIdentity({ revision: character.revision, usage: used, aliases });
      setAliasName("");
      setAliasReason("");
    } catch {
      onError();
    }
  }
  // 身份内容随选择读取一次，不做二次点击展开。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 依目标身份读取一次出现记录与别名。
  useEffect(() => {
    if (character && !identity) void loadIdentity();
  }, [character?.id]);
  // 别名引导的桥接锚点：用第一条出现记录把用户带回可选择的正文。
  const firstOccurrence = (() => {
    if (!identity) return null;
    for (const used of identity.usage) {
      if (used.segmentIds.length > 0 && used.ranges[0]) {
        return {
          chapterId: used.chapterId,
          versionId: used.versionId,
          segmentId: used.segmentIds[0],
          range: used.ranges[0],
        };
      }
    }
    return null;
  })();

  const voiceContent = target ? (
    <>
      <Section title={t`声音`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <AudioLinesIcon className="text-muted-foreground size-4 shrink-0" />
          {voice ? (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                invalid && "text-warning-foreground",
              )}
            >
              {invalid ? (
                <Trans>绑定音色已失效（目录缺失）</Trans>
              ) : (
                voiceName(voice)
              )}
              {binding?.origin?.origin === "suggestion" ? (
                <span className="text-muted-foreground ml-2 text-xs">
                  <Trans>来自建议</Trans>
                </span>
              ) : null}
            </span>
          ) : (
            <span className="min-w-0 flex-1 text-sm">
              <Trans>未绑定</Trans>
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onPick(target)}
          >
            <Trans>选择音色</Trans>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !voice}
            onClick={() => onBind(target)}
          >
            <Trans>解绑</Trans>
          </Button>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t`使用统计`}
                  title={t`使用统计`}
                  disabled={busy}
                  onClick={() =>
                    void commands
                      .voiceBindingUsage(projectId, target)
                      .then(setUsage)
                      .catch(onError)
                  }
                />
              }
            >
              <BarChart3Icon className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-64 overflow-y-auto">
              {usage ? (
                <div className="text-xs">
                  <p className="text-muted-foreground pb-1">
                    <Trans>共 {usage.totalSegments} 处</Trans>
                  </p>
                  {usage.chapters.map((chapter) => (
                    <p key={chapter.chapterId}>
                      {chapters.find((c) => c.id === chapter.chapterId)
                        ?.title ?? chapter.chapterId}{" "}
                      · {chapter.segmentIds.length}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  <Trans>读取中…</Trans>
                </p>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </Section>
      <Section title={t`声音画像`}>
        <Textarea
          className="min-h-16 min-w-0 flex-1 resize-none text-sm"
          aria-label={t`${title} 的声音画像`}
          placeholder={t`声音特征，如：中年男声、语速偏慢、沉稳`}
          value={profileText}
          onChange={(e) => setProfileText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || profileText === (profile?.text ?? "")}
            onClick={() =>
              onProfileSave(target, profileText, profile?.revision ?? 0)
            }
          >
            <Trans>保存画像</Trans>
          </Button>
        </div>
      </Section>
      {suggestion ? (
        <Section title={t`选角建议`}>
          <CastingSuggestionPanel
            projectId={projectId}
            projectRevision={projectRevision}
            target={target}
            suggestion={suggestion}
            binding={binding}
            profile={profile}
            models={models}
            studio={studio}
            disabled={busy}
            onAdopted={onSaved}
            onDesign={onDesign}
          />
        </Section>
      ) : null}
      <Section title={t`设计音色`}>
        <p className="text-muted-foreground text-xs">
          <Trans>
            目录中没有合适音色时，按画像设计一个：生成候选、试听、入库后绑定回此目标。
          </Trans>
        </p>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDesign(target)}
          >
            <Trans>设计音色</Trans>
          </Button>
        </div>
        {designSlot}
      </Section>
    </>
  ) : null;

  const identityContent = character ? (
    <>
      {isCandidate ? (
        <Section title={t`身份复用`}>
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              className="min-w-0 flex-1"
              value={reuse}
              aria-label={t`复用已有角色`}
              onChange={(e) => setReuse(e.target.value)}
            >
              <option value="">{t`复用已有身份…`}</option>
              {roles
                .filter((other) => other.id !== character.id)
                .map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.displayName}
                  </option>
                ))}
            </NativeSelect>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !reuse}
              onClick={() =>
                void onRun(() =>
                  commands.chapterAnalysisCharacterEdit(
                    projectId,
                    character.id,
                    crypto.randomUUID(),
                    character.revision,
                    {
                      type: "reuse",
                      chapter_id: chapterId,
                      existing_id: reuse,
                      expected_analysis_revision: revision,
                    },
                  ),
                )
              }
            >
              <Trans>在本章复用</Trans>
            </Button>
          </div>
        </Section>
      ) : null}
      <Section title={t`名称与别名`}>
        {renameOpen ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onRun(async () => {
                const used = await commands.chapterAnalysisCharacterUsage(
                  projectId,
                  character.id,
                );
                await commands.chapterAnalysisCharacterEdit(
                  projectId,
                  character.id,
                  crypto.randomUUID(),
                  character.revision,
                  {
                    type: "rename",
                    name: renameName,
                    expected_affected_chapters: used.map((u) => u.chapterId),
                  },
                );
                setRenameOpen(false);
              });
            }}
          >
            <Input
              aria-label={t`共享显示名称`}
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={busy || !renameName.trim()}
              >
                <Trans>确认更名</Trans>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRenameOpen(false)}
              >
                <Trans>取消</Trans>
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">
              {character.displayName}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setRenameOpen(true);
                setRenameName(character.displayName);
              }}
            >
              <PencilIcon data-icon="inline-start" />
              <Trans>重命名</Trans>
            </Button>
          </div>
        )}
        {identity && identity.revision === character.revision ? (
          identity.aliases.length ? (
            <div className="flex flex-col">
              {identity.aliases.map((alias) => (
                <p
                  key={alias.id}
                  className="border-t py-2 text-sm first:border-t-0"
                >
                  {alias.name}
                  <span className="text-muted-foreground block text-xs">
                    {chapters.find((c) => c.id === alias.source.chapterId)
                      ?.title ?? t`已调整的章节`}{" "}
                    · {alias.evidence.reason}
                  </span>
                </p>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              <Trans>尚无已确认别名</Trans>
            </p>
          )
        ) : null}
      </Section>
      <Section title={t`出现记录`}>
        {identity && identity.revision === character.revision ? (
          <div className="flex max-h-64 flex-col overflow-y-auto rounded-md border">
            {identity.usage.flatMap((used) =>
              used.segmentIds.map((id, index) => (
                <Button
                  key={`${used.versionId}:${id}`}
                  size="sm"
                  variant="ghost"
                  className="justify-start rounded-none border-b last:border-b-0"
                  onClick={() =>
                    void onLocate(
                      used.chapterId,
                      used.versionId,
                      id,
                      used.ranges[index],
                    ).catch(onError)
                  }
                >
                  {chapters.find((c) => c.id === used.chapterId)?.title} ·{" "}
                  <Trans>第 {index + 1} 处</Trans>
                </Button>
              )),
            )}
            {!identity.usage.length ? (
              <p className="text-muted-foreground p-3 text-xs">
                <Trans>当前分析中没有出现记录</Trans>
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            <Trans>读取中…</Trans>
          </p>
        )}
        {selectedRange &&
        identity &&
        identity.revision === character.revision ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onRun(async () => {
                await commands.chapterAnalysisCharacterEdit(
                  projectId,
                  character.id,
                  crypto.randomUUID(),
                  character.revision,
                  {
                    type: "alias",
                    name: aliasName,
                    evidence: {
                      range: selectedRange,
                      reason: aliasReason,
                    },
                    chapter_id: chapterId,
                    expected_affected_chapters: identity.usage.map(
                      (u) => u.chapterId,
                    ),
                  },
                );
                await loadIdentity();
              });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="character-alias">
                  <Trans>添加别名</Trans>
                </FieldLabel>
                <Input
                  id="character-alias"
                  value={aliasName}
                  onChange={(e) => setAliasName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="character-alias-reason">
                  <Trans>所选原文如何支持此别名</Trans>
                </FieldLabel>
                <Input
                  id="character-alias-reason"
                  value={aliasReason}
                  onChange={(e) => setAliasReason(e.target.value)}
                />
              </Field>
            </FieldGroup>
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={busy || !aliasName.trim() || !aliasReason.trim()}
              >
                <Trans>确认别名关系</Trans>
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted-foreground min-w-0 flex-1 text-xs">
              <Trans>先选择正文片段，再添加有原文依据的别名。</Trans>
            </p>
            {firstOccurrence ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void onLocate(
                    firstOccurrence.chapterId,
                    firstOccurrence.versionId,
                    firstOccurrence.segmentId,
                    firstOccurrence.range,
                  ).catch(onError)
                }
              >
                <Trans>去正文选择</Trans>
              </Button>
            ) : null}
          </div>
        )}
      </Section>
    </>
  ) : null;

  return (
    <div className="flex flex-col gap-2">
      <header className="flex flex-wrap items-center gap-2 pb-3">
        <h2 className="text-base font-medium">{title}</h2>
        {character ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs",
              isCandidate
                ? "border-dashed"
                : "text-muted-foreground border-transparent",
            )}
          >
            {isCandidate ? t`AI 分析` : t`人工处理`}
          </span>
        ) : null}
      </header>
      {!character ? (
        voiceContent
      ) : (
        <Tabs defaultValue="voice" onValueChange={() => onViewChange?.()}>
          <TabsList variant="line" aria-label={t`目标视图`}>
            <TabsTrigger value="voice">
              <Trans>配音</Trans>
            </TabsTrigger>
            <TabsTrigger value="identity">
              <Trans>身份</Trans>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="voice">{voiceContent}</TabsContent>
          <TabsContent value="identity">{identityContent}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}
