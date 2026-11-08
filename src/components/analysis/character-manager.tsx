import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchInput } from "@/components/ui/search-input";
import {
  type AliasView,
  type ByteRange,
  type Chapter_Serialize,
  type Character,
  type CharacterUsage,
  commands,
} from "@/lib/bindings";

export function CharacterManager({
  open,
  onOpenChange,
  characters,
  projectId,
  chapterId,
  revision,
  onSaved,
  chapters,
  selectedRange,
  onLocate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  characters: Character[];
  projectId: string;
  chapterId: string;
  revision: number;
  onSaved: () => Promise<void>;
  chapters: Chapter_Serialize[];
  selectedRange: ByteRange | null;
  onLocate: (
    chapterId: string,
    versionId: string,
    segmentId: string,
    range: ByteRange,
  ) => Promise<void>;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rename, setRename] = useState<{
    id: string;
    name: string;
    affected: string[];
    revision: number;
  } | null>(null);
  const [details, setDetails] = useState<{
    id: string;
    revision: number;
    usage: CharacterUsage[];
    aliases: AliasView[];
  } | null>(null);
  const [aliasName, setAliasName] = useState("");
  const [aliasReason, setAliasReason] = useState("");
  async function inspect(c: Character) {
    setBusy(true);
    setFailed(false);
    try {
      const [usage, aliases] = await Promise.all([
        commands.chapterAnalysisCharacterUsage(projectId, c.id),
        commands.chapterAnalysisCharacterAliases(projectId, c.id),
      ]);
      setDetails({ id: c.id, revision: c.revision, usage, aliases });
      setAliasName("");
      setAliasReason("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const [reuse, setReuse] = useState<Record<string, string>>({});
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setFailed(false);
    try {
      await fn();
      await onSaved();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col">
        <DialogHeader>
          <DialogTitle>
            <Trans>工程角色</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>身份在全书保持稳定；同名角色不会自动合并。</Trans>
          </DialogDescription>
        </DialogHeader>
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t`搜索角色…`}
          aria-label={t`搜索角色`}
        />
        <div className="min-h-0 overflow-y-auto">
          {characters
            .filter((c) =>
              c.displayName
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-2 border-b py-3 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <Button
                    className="min-w-0 flex-1 justify-start truncate"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void inspect(c)}
                  >
                    {c.displayName}
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    {c.status === "candidate" ? t`候选` : t`已确认`}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const usage =
                          await commands.chapterAnalysisCharacterUsage(
                            projectId,
                            c.id,
                          );
                        setRename({
                          id: c.id,
                          name: c.displayName,
                          affected: usage.map((u) => u.chapterId),
                          revision: c.revision,
                        });
                      })
                    }
                  >
                    <Trans>重命名</Trans>
                  </Button>
                </div>
                {c.status === "candidate" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          commands.chapterAnalysisCharacterEdit(
                            projectId,
                            c.id,
                            crypto.randomUUID(),
                            c.revision,
                            { type: "confirm" },
                          ),
                        )
                      }
                    >
                      <Trans>确认为新角色</Trans>
                    </Button>
                    <NativeSelect
                      className="min-w-0 flex-1"
                      value={reuse[c.id] ?? ""}
                      aria-label={t`复用已确认角色`}
                      onChange={(e) =>
                        setReuse((old) => ({ ...old, [c.id]: e.target.value }))
                      }
                    >
                      <option value="">{t`复用已有身份…`}</option>
                      {characters
                        .filter(
                          (other) =>
                            other.status === "confirmed" && other.id !== c.id,
                        )
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.displayName}
                          </option>
                        ))}
                    </NativeSelect>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !reuse[c.id]}
                      onClick={() =>
                        void run(() =>
                          commands.chapterAnalysisCharacterEdit(
                            projectId,
                            c.id,
                            crypto.randomUUID(),
                            c.revision,
                            {
                              type: "reuse",
                              chapter_id: chapterId,
                              existing_id: reuse[c.id],
                              expected_analysis_revision: revision,
                            },
                          ),
                        )
                      }
                    >
                      <Trans>在本章复用</Trans>
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          {details ? (
            <div className="flex flex-col gap-3 border-t pt-4">
              <h3 className="text-sm font-medium">
                {characters.find((c) => c.id === details.id)?.displayName}
              </h3>
              <h4 className="text-muted-foreground text-xs">
                <Trans>别名与出处</Trans>
              </h4>
              {details.aliases.length ? (
                details.aliases.map((alias) => (
                  <p key={alias.id} className="text-sm">
                    {alias.name}
                    <span className="text-muted-foreground block text-xs">
                      {chapters.find((c) => c.id === alias.source.chapterId)
                        ?.title ?? t`已调整的章节`}{" "}
                      · {alias.evidence.reason}
                    </span>
                  </p>
                ))
              ) : (
                <p className="text-muted-foreground text-xs">
                  <Trans>尚无已确认别名</Trans>
                </p>
              )}
              <h4 className="text-muted-foreground text-xs">
                <Trans>出现记录</Trans>
              </h4>
              {details.usage.flatMap((usage) =>
                usage.segmentIds.map((id, index) => (
                  <Button
                    key={`${usage.versionId}:${id}`}
                    size="sm"
                    variant="ghost"
                    className="justify-start"
                    onClick={() =>
                      void onLocate(
                        usage.chapterId,
                        usage.versionId,
                        id,
                        usage.ranges[index],
                      ).catch(() => setFailed(true))
                    }
                  >
                    {chapters.find((c) => c.id === usage.chapterId)?.title} ·{" "}
                    <Trans>第 {index + 1} 处</Trans>
                  </Button>
                )),
              )}
              {details.usage.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  <Trans>当前分析中没有出现记录</Trans>
                </p>
              ) : null}
              {selectedRange ? (
                <form
                  className="flex flex-col gap-3 border-t pt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      await commands.chapterAnalysisCharacterEdit(
                        projectId,
                        details.id,
                        crypto.randomUUID(),
                        details.revision,
                        {
                          type: "alias",
                          name: aliasName,
                          evidence: {
                            range: selectedRange,
                            reason: aliasReason,
                          },
                          chapter_id: chapterId,
                          expected_affected_chapters: details.usage.map(
                            (u) => u.chapterId,
                          ),
                        },
                      );
                      setDetails(null);
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
                  <p className="text-muted-foreground text-xs">
                    <Trans>
                      依据当前选中的本章原文；此别名会作为全书共享角色信息。
                    </Trans>
                  </p>
                  <Button
                    type="submit"
                    size="sm"
                    className="self-start"
                    disabled={busy || !aliasName.trim() || !aliasReason.trim()}
                  >
                    <Trans>确认别名关系</Trans>
                  </Button>
                </form>
              ) : (
                <p className="text-muted-foreground text-xs">
                  <Trans>先选择正文片段，再添加有原文依据的别名。</Trans>
                </p>
              )}
            </div>
          ) : null}
        </div>
        {rename ? (
          <form
            className="flex flex-col gap-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              const c = characters.find((c) => c.id === rename.id);
              if (c)
                void run(async () => {
                  await commands.chapterAnalysisCharacterEdit(
                    projectId,
                    c.id,
                    crypto.randomUUID(),
                    rename.revision,
                    {
                      type: "rename",
                      name: rename.name,
                      expected_affected_chapters: rename.affected,
                    },
                  );
                  setRename(null);
                });
            }}
          >
            <label className="text-sm" htmlFor="character-name">
              <Trans>共享显示名称</Trans>
            </label>
            <Input
              id="character-name"
              value={rename.name}
              onChange={(e) => setRename({ ...rename, name: e.target.value })}
            />
            <p className="text-muted-foreground text-xs">
              <Trans>
                影响 {rename.affected.length} 个章节的显示名称，身份与归属不变。
              </Trans>
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={busy || !rename.name.trim()}
              >
                <Trans>确认更名</Trans>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRename(null)}>
                <Trans>取消</Trans>
              </Button>
            </div>
          </form>
        ) : null}
        {failed ? (
          <p role="alert" className="text-destructive text-sm">
            <Trans>操作未保存，请刷新后重试。已有结果保留。</Trans>
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
