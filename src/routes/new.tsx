import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useState } from "react";
import { BrowserPreviewGuide } from "@/components/browser-preview-guide";
import { PageShell } from "@/components/page-shell";
import { ChapterDiagnostics } from "@/components/projects/chapter-diagnostics";
import { HeadingRulesEditor } from "@/components/projects/heading-rules-editor";
import { SaveProjectButton } from "@/components/projects/project-file-controls";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FilePreview, ImportSnapshot, TextPage } from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import { usePreviewProjects } from "@/lib/preview-projects";
import { desktop } from "@/lib/project-files";

export const Route = createFileRoute("/new")({
  component: NovelImport,
  validateSearch: (search: Record<string, unknown>): { draft?: string } => ({
    draft: typeof search.draft === "string" ? search.draft : undefined,
  }),
});
const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-sm";

function NovelImport() {
  const { t } = useLingui();
  const formId = useId();
  const { draft: requestedDraft } = Route.useSearch();
  const { projects, upsertProject, draft, setDraft, loadError } =
    usePreviewProjects();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<ImportSnapshot | null>(null);
  const [pending, setPending] = useState<FilePreview[]>([]);
  const [split, setSplit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<TextPage | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [line, setLine] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterLine, setChapterLine] = useState<number | null>(null);
  const [volumeId, setVolumeId] = useState("");
  const [volumeTitle, setVolumeTitle] = useState("");
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<"directory" | "diagnostics">("directory");

  useEffect(() => {
    if (requestedDraft)
      void commands
        .importSnapshot(requestedDraft)
        .then((next) => {
          setCurrent(next);
        })
        .catch(() => setError(t`无法读取导入草案。`));
  }, [requestedDraft, t]);

  useEffect(() => {
    const saved = projects.find((project) => project.id === current?.id);
    if (
      saved &&
      saved.revision === current?.revision &&
      saved.filename !== current?.filename
    ) {
      setCurrent(saved);
    }
  }, [projects, current]);

  function accept(next: ImportSnapshot) {
    setCurrent(next);
    upsertProject(next);
  }
  const failure = useCallback(
    (cause: unknown) => {
      const code = typeof cause === "string" ? cause : "";
      return code === "invalid_encoding"
        ? t`无法按所选编码读取，请选择其他编码。`
        : code === "invalid_rule"
          ? t`正则规则无效或超过限制。请使用不含前后向断言的规则。`
          : code === "conflict"
            ? t`草案已变化或正文重复，请重新读取。`
            : code === "too_large"
              ? t`文件、正文范围或结果超过限制，请缩小范围。`
              : code === "busy"
                ? t`诊断正在使用草案，请先停止诊断。`
                : t`操作未完成，已有草案仍保留。请检查文件和存储权限后重试。`;
    },
    [t],
  );
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!current?.sources.length) return;
    const selected =
      sourceId && current.sources.some((s) => s.id === sourceId)
        ? sourceId
        : current.sources[0].id;
    let active = true;
    void commands
      .importText(current.id, selected, line, 30)
      .then((next) => {
        if (active) {
          setPage(next);
          setSourceId(selected);
        }
      })
      .catch((cause) => {
        if (active) {
          setPage(null);
          setError(failure(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [current, sourceId, line, failure]);

  if (!desktop)
    return (
      <PageShell
        active="projects"
        title={t`导入小说`}
        description={t`整本 TXT 与章节文件`}
      >
        <div className="mx-auto w-full max-w-6xl px-6 py-12">
          <BrowserPreviewGuide
            summary={
              <Trans>
                整本 TXT
                导入、编码确认、目录检查与分章诊断需要读取本机文件，请在桌面应用中使用。
              </Trans>
            }
          />
        </div>
      </PageShell>
    );

  return (
    <PageShell
      active="projects"
      title={t`导入小说`}
      description={t`确认编码、检查目录，再开始制作。`}
    >
      <div className="space-y-5">
        {error || loadError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {error ?? t`无法读取恢复草案，原记录已保留。`}
            </AlertDescription>
          </Alert>
        ) : null}
        {!current ? (
          <>
            {projects.filter((p) => !p.filename).length ? (
              <section className="space-y-2">
                <h2 className="text-sm font-medium">
                  <Trans>未完成导入</Trans>
                </h2>
                {projects
                  .filter((p) => !p.filename)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between border-b py-2 text-sm"
                    >
                      <span>{p.title}</span>
                      <Button
                        variant="outline"
                        onClick={() =>
                          void run(async () =>
                            accept(await commands.importSnapshot(p.id)),
                          )
                        }
                      >
                        <Trans comment="恢复导入草案">继续导入</Trans>
                      </Button>
                    </div>
                  ))}
              </section>
            ) : null}
            <form
              className="max-w-xl space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  accept(
                    await commands.importCreate(draft.title, draft.description),
                  );
                  setDraft({
                    title: "",
                    description: "",
                    chapters: [],
                    step: 0,
                  });
                });
              }}
            >
              <label
                htmlFor={`${formId}-title`}
                className="block space-y-1 text-sm"
              >
                <span>
                  <Trans>工程名称</Trans>
                </span>
                <Input
                  id={`${formId}-title`}
                  required
                  maxLength={80}
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, title: e.target.value }))
                  }
                />
              </label>
              <label
                htmlFor={`${formId}-description`}
                className="block space-y-1 text-sm"
              >
                <span>
                  <Trans comment="工程说明，可留空">备注</Trans>
                </span>
                <Textarea
                  id={`${formId}-description`}
                  maxLength={500}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, description: e.target.value }))
                  }
                />
              </label>
              <Button type="submit" disabled={busy || !draft.title.trim()}>
                <Trans>创建导入草案</Trans>
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b pb-4">
              <span className="text-sm font-medium">{current.title}</span>
              <select
                className={selectClass}
                aria-label={t`TXT 导入方式`}
                value={split ? "book" : "chapters"}
                disabled={busy}
                onChange={(e) => setSplit(e.target.value === "book")}
              >
                <option value="book">{t`整本小说，自动分章`}</option>
                <option value="chapters">{t`每个文件作为一章`}</option>
              </select>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const selected = await commands.importSelect();
                    setPending((files) => [...files, ...selected]);
                  })
                }
              >
                <Trans>选择 TXT 文件</Trans>
              </Button>
              {current.chapters.length ? (
                <SaveProjectButton
                  project={{
                    ...current,
                    fileState: current.filename
                      ? { filename: current.filename }
                      : undefined,
                  }}
                />
              ) : null}
              {current.chapters.length ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    upsertProject(current);
                    void navigate({
                      to: "/project/$id",
                      params: { id: current.id },
                      search: { section: "chapters" },
                    });
                  }}
                >
                  <Trans>进入章节制作</Trans>
                </Button>
              ) : null}
            </div>
            {pending.map((file) => (
              <section key={file.id} className="space-y-3 border-b pb-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium">{file.filename}</span>
                  <label className="flex items-center gap-2 text-sm">
                    <span>
                      <Trans comment="TXT 字符编码">编码</Trans>
                    </span>
                    <select
                      className={selectClass}
                      value={file.encoding}
                      disabled={busy}
                      onChange={(e) => {
                        const encoding = e.target.value;
                        void run(async () => {
                          const next = await commands.importPreviewEncoding(
                            file.id,
                            encoding,
                          );
                          setPending((files) =>
                            files.map((f) => (f.id === file.id ? next : f)),
                          );
                        });
                      }}
                    >
                      <option value="utf-8">UTF-8</option>
                      <option value="gb18030">GB18030</option>
                      <option value="gbk">GBK</option>
                    </select>
                  </label>
                </div>
                <div className="grid gap-3 lg:grid-cols-3">
                  {file.samples.map((text, index) => (
                    <pre
                      // biome-ignore lint/suspicious/noArrayIndexKey: The three fixed encoding samples are start, middle and end.
                      key={`${file.id}-${index}`}
                      className="max-h-36 overflow-auto border-l pl-3 text-xs leading-5 whitespace-pre-wrap"
                    >
                      {text}
                    </pre>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        accept(
                          await commands.importConfirm(
                            current.id,
                            current.revision,
                            file.id,
                            file.encoding,
                            split,
                          ),
                        );
                        setPending((files) =>
                          files.filter((f) => f.id !== file.id),
                        );
                        setLine(0);
                        await commands.importReleaseSelection(file.id);
                      })
                    }
                  >
                    <Trans>确认编码并导入</Trans>
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await commands.importReleaseSelection(file.id);
                        setPending((files) =>
                          files.filter((f) => f.id !== file.id),
                        );
                      })
                    }
                  >
                    <Trans comment="移除尚未导入的 TXT">移除</Trans>
                  </Button>
                </div>
              </section>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={tab === "directory" ? "secondary" : "ghost"}
                onClick={() => setTab("directory")}
              >
                <Trans>目录与原文</Trans>
              </Button>
              <Button
                variant={tab === "diagnostics" ? "secondary" : "ghost"}
                disabled={!current.sources.length}
                onClick={() => setTab("diagnostics")}
              >
                <Trans>分章诊断</Trans>
              </Button>
              <Button
                variant="ghost"
                disabled={busy || !current.canUndo}
                onClick={() =>
                  void run(async () =>
                    accept(
                      await commands.importEdit(current.id, current.revision, {
                        kind: "undo",
                      }),
                    ),
                  )
                }
              >
                <Trans comment="撤销最近一次分章调整">撤销调整</Trans>
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  void run(async () =>
                    accept(await commands.importSnapshot(current.id)),
                  )
                }
              >
                <Trans comment="读取宿主最新导入草案">重新读取</Trans>
              </Button>
            </div>
            {tab === "diagnostics" ? (
              <ChapterDiagnostics
                project={current}
                onChange={accept}
                onLocate={(source, line) => {
                  setSourceId(source);
                  setLine(Math.max(0, line - 2));
                  setTab("directory");
                }}
              />
            ) : (
              <div className="grid min-w-0 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
                <section className="min-w-0 space-y-3">
                  <h2 className="text-sm font-medium">
                    <Trans>章节目录</Trans> · {current.chapters.length}
                  </h2>
                  <div className="max-h-[32rem] overflow-auto">
                    {current.chapters
                      .slice(offset, offset + 100)
                      .map((chapter, index) => (
                        <button
                          type="button"
                          key={chapter.id}
                          className="hover:bg-muted flex w-full gap-2 border-b p-2 text-left text-sm"
                          onClick={() => {
                            setSourceId(chapter.sourceId);
                            setLine(chapter.heading ?? 0);
                            setChapterTitle(chapter.title);
                            setChapterLine(chapter.heading ?? 0);
                            setVolumeId(chapter.volumeId ?? "");
                          }}
                        >
                          <span className="text-muted-foreground">
                            {offset + index + 1}
                          </span>
                          <span className="min-w-0 wrap-break-word">
                            {chapter.title}
                          </span>
                        </button>
                      ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={offset === 0}
                      onClick={() => setOffset((v) => Math.max(0, v - 100))}
                    >
                      <Trans comment="目录上一页">上一页</Trans>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={offset + 100 >= current.chapters.length}
                      onClick={() => setOffset((v) => v + 100)}
                    >
                      <Trans comment="目录下一页">下一页</Trans>
                    </Button>
                  </div>
                  {chapterLine !== null ? (
                    <form
                      className="space-y-2 border-t pt-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(async () =>
                          accept(
                            await commands.importEdit(
                              current.id,
                              current.revision,
                              {
                                kind: "boundary",
                                correction: {
                                  sourceId,
                                  line: chapterLine,
                                  include: true,
                                  title: chapterTitle,
                                  volumeId: volumeId || null,
                                },
                              },
                            ),
                          ),
                        );
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
                        <select
                          className={`${selectClass} w-full`}
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
                        </select>
                      </label>
                      <Button
                        size="sm"
                        type="submit"
                        disabled={busy || !chapterTitle.trim()}
                      >
                        <Trans>保存标题与分卷</Trans>
                      </Button>
                    </form>
                  ) : null}
                  {current.issues.length ? (
                    <p className="text-muted-foreground text-xs">
                      <Trans>
                        检测到 {current.issues.length}{" "}
                        处待检查位置。命中标题不代表分章正确。
                      </Trans>
                    </p>
                  ) : null}
                  {current.issues.slice(0, 20).map((issue) => (
                    <button
                      type="button"
                      key={`${issue.sourceId}-${issue.line}-${issue.kind}`}
                      className="block text-left text-xs underline underline-offset-4"
                      onClick={() => {
                        setSourceId(issue.sourceId);
                        setLine(Math.max(0, issue.line - 2));
                      }}
                    >
                      {issue.kind === "duplicate_heading"
                        ? t`标题重复`
                        : issue.kind === "short_chapter"
                          ? t`章节过短`
                          : issue.kind === "long_chapter"
                            ? t`章节过长`
                            : issue.kind === "numbering_gap"
                              ? t`章节编号跳变`
                              : t`未识别到标题`}{" "}
                      · {issue.line + 1}
                    </button>
                  ))}
                </section>
                <section className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className={`${selectClass} max-w-full min-w-0`}
                      aria-label={t`原文文件`}
                      value={sourceId}
                      onChange={(e) => {
                        setSourceId(e.target.value);
                        setLine(0);
                      }}
                    >
                      {current.sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.filename}
                        </option>
                      ))}
                    </select>
                    <label
                      htmlFor={`${formId}-line`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span>
                        <Trans comment="定位原文行号，从 1 开始">行</Trans>
                      </span>
                      <Input
                        id={`${formId}-line`}
                        type="number"
                        min={1}
                        className="w-24"
                        value={line + 1}
                        onChange={(e) =>
                          setLine(Math.max(0, Number(e.target.value) - 1))
                        }
                      />
                    </label>
                  </div>
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
                            await commands.importEdit(
                              current.id,
                              current.revision,
                              {
                                kind: "volume",
                                sourceId,
                                line,
                                title: volumeTitle,
                              },
                            ),
                          );
                          setVolumeTitle("");
                        })
                      }
                    >
                      <Trans>设置卷</Trans>
                    </Button>
                  </div>
                  <div className="max-h-[32rem] overflow-auto border-y">
                    {page?.lines.map((item) => {
                      const chapter = current.chapters.find(
                        (c) =>
                          c.sourceId === page.sourceId &&
                          c.heading === item.line,
                      );
                      return (
                        <div
                          key={item.line}
                          className="group flex gap-2 border-b py-2"
                        >
                          <span className="text-muted-foreground w-10 shrink-0 text-right text-xs">
                            {item.line + 1}
                          </span>
                          <pre className="min-w-0 flex-1 text-sm leading-7 wrap-break-word whitespace-pre-wrap">
                            {item.text}
                          </pre>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy || !item.text.trim()}
                            onClick={() =>
                              void run(async () =>
                                accept(
                                  await commands.importEdit(
                                    current.id,
                                    current.revision,
                                    {
                                      kind: "boundary",
                                      correction: {
                                        sourceId: page.sourceId,
                                        line: item.line,
                                        include: !chapter,
                                        title: null,
                                        volumeId: null,
                                      },
                                    },
                                  ),
                                ),
                              )
                            }
                          >
                            {chapter ? (
                              <Trans comment="移除章节起点，合并相邻章">
                                合并
                              </Trans>
                            ) : (
                              <Trans comment="在此原文行建立章节起点">
                                分章
                              </Trans>
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={line === 0}
                      onClick={() => setLine((v) => Math.max(0, v - 30))}
                    >
                      <Trans comment="原文上一段">上一段</Trans>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page?.nextLine == null}
                      onClick={() => setLine(page?.nextLine ?? 0)}
                    >
                      <Trans comment="原文下一段">下一段</Trans>
                    </Button>
                  </div>
                </section>
              </div>
            )}
            <Button variant="ghost" onClick={() => setShowRules((v) => !v)}>
              <Trans>分章规则</Trans>
            </Button>
            {showRules ? (
              <HeadingRulesEditor
                key={`${current.id}:${current.revision}`}
                initialRules={current.rules}
                disabled={busy || !current.sources.length}
                onApply={(rules) =>
                  void run(async () =>
                    accept(
                      await commands.importEdit(current.id, current.revision, {
                        kind: "rules",
                        rules,
                      }),
                    ),
                  )
                }
              />
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
}
