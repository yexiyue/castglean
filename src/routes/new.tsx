import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AuxiliaryDialog } from "@/components/auxiliary-dialog";
import { BrowserPreviewGuide } from "@/components/browser-preview-guide";
import { PageShell } from "@/components/page-shell";
import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type {
  FilePreview,
  LocalProjectSnapshot_Serialize,
} from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import { desktop, useLocalProjects } from "@/lib/local-projects";

export const Route = createFileRoute("/new")({
  component: NovelImport,
  validateSearch: (
    search: Record<string, unknown>,
  ): { draft?: string; append?: boolean } => ({
    append: search.append === true || search.append === "true",
    draft: typeof search.draft === "string" ? search.draft : undefined,
  }),
});

function NovelImport() {
  const { draft: requestedDraft, append } = Route.useSearch();
  return (
    <NovelImportEditor
      key={requestedDraft ?? "new"}
      requestedDraft={requestedDraft}
      append={append}
    />
  );
}

function NovelImportEditor({
  requestedDraft,
  append,
}: {
  requestedDraft?: string;
  append?: boolean;
}) {
  const { t } = useLingui();
  const formId = useId();
  const {
    projects,
    upsertProject,
    draft,
    setDraft,
    loadError,
    setPendingSources,
  } = useLocalProjects();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<LocalProjectSnapshot_Serialize | null>(
    null,
  );
  const [pending, setPending] = useState<FilePreview[]>([]);
  const [split, setSplit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(append ?? false);

  const pendingRef = useRef(pending);
  const mounted = useRef(true);
  pendingRef.current = pending;
  useEffect(() => {
    setPendingSources(pending.length);
  }, [pending.length, setPendingSources]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setPendingSources(0);
      for (const file of pendingRef.current)
        void commands.localSourceRelease(file.id).catch(() => {});
    };
  }, [setPendingSources]);
  useEffect(() => {
    if (!requestedDraft) return;
    let active = true;
    setCurrent(null);
    void commands
      .localProjectSnapshot(requestedDraft)
      .then((next) => {
        if (active) {
          setCurrent(next);
          upsertProject(next);
        }
      })
      .catch(() => {
        if (active) setError(t`无法读取本地工程。`);
      });
    return () => {
      active = false;
    };
  }, [requestedDraft, t, upsertProject]);

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
  function accept(next: LocalProjectSnapshot_Serialize) {
    upsertProject(next);
    if (mounted.current) setCurrent(next);
  }
  async function importSource(
    project: LocalProjectSnapshot_Serialize,
    file: FilePreview,
  ) {
    await commands.localProjectImport({
      projectId: project.id,
      revision: project.revision,
      selectionId: file.id,
      encoding: file.encoding,
      split,
      commandId: commandId("import", [
        project.id,
        project.revision,
        file.id,
        file.encoding,
        split,
      ]),
    });
    return commands.localProjectSnapshot(project.id);
  }
  const failure = useCallback(
    (cause: unknown) => {
      const code = typeof cause === "string" ? cause : "";
      switch (code) {
        case "invalid_encoding":
          return t`无法按所选编码读取，请选择其他编码。`;
        case "invalid_rule":
          return t`正则规则无效或超过限制。请使用不含前后向断言的规则。`;
        case "conflict":
          return t`草案已变化或正文重复，请重新读取。`;
        case "too_large":
          return t`文件、正文范围或结果超过限制，请缩小范围。`;
        case "busy":
          return t`诊断正在使用草案，请先停止诊断。`;
        default:
          return t`操作未完成，已有草案仍保留。请检查文件和存储权限后重试。`;
      }
    },
    [t],
  );
  const operationPending = useRef(false);
  async function run(action: () => Promise<void>) {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current) setError(failure(cause));
    } finally {
      operationPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function selectSources() {
    const selected = await commands.localSourceSelect();
    if (!mounted.current) {
      await Promise.all(
        selected.map((file) =>
          commands.localSourceRelease(file.id).catch(() => {}),
        ),
      );
      return;
    }
    setPending((files) => [...files, ...selected]);
  }

  if (!desktop)
    return (
      <PageShell
        active="import"
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

  if (current?.sources.length && !showImport)
    return (
      <ProjectWorkspace
        project={current}
        onChange={accept}
        onAddSources={() => setShowImport(true)}
      />
    );

  return (
    <PageShell
      active="import"
      title={t`导入小说`}
      description={t`确认编码、检查目录，再开始制作。`}
    >
      <div className="mx-auto max-w-6xl space-y-4 p-5">
        {error || loadError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {error ?? t`无法读取恢复草案，原记录已保留。`}
            </AlertDescription>
          </Alert>
        ) : null}
        {!current ? (
          <>
            {projects.filter((p) => p.sourceCount === 0).length ? (
              <section className="space-y-2">
                <h2 className="text-sm font-medium">
                  <Trans>未完成导入</Trans>
                </h2>
                {projects
                  .filter((p) => p.sourceCount === 0)
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
                            accept(await commands.localProjectSnapshot(p.id)),
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
                    await commands.localProjectCreate(
                      draft.title,
                      draft.description,
                    ),
                  );
                  setDraft({ title: "", description: "" });
                  if (mounted.current) await selectSources();
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
              <AuxiliaryDialog
                title={
                  <>
                    {" "}
                    <Trans comment="按需展开导入工程的可选备注">
                      添加备注
                    </Trans>{" "}
                  </>
                }
              >
                <div className="mt-3">
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
                </div>
              </AuxiliaryDialog>
              <Button type="submit" disabled={busy || !draft.title.trim()}>
                <Trans comment="创建本地草案后立即选择 TXT，之后仍须确认编码">
                  选择 TXT 并继续
                </Trans>
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b pb-4">
              <span className="text-sm font-medium">{current.title}</span>
              <NativeSelect
                aria-label={t`TXT 导入方式`}
                value={split ? "book" : "chapters"}
                disabled={busy}
                onChange={(e) => setSplit(e.target.value === "book")}
              >
                <option value="book">{t`整本小说，自动分章`}</option>
                <option value="chapters">{t`每个文件作为一章`}</option>
              </NativeSelect>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run(selectSources)}
              >
                <Trans>选择 TXT 文件</Trans>
              </Button>
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
                    <NativeSelect
                      value={file.encoding}
                      disabled={busy}
                      onChange={(e) => {
                        const encoding = e.target.value;
                        void run(async () => {
                          const next = await commands.localSourcePreview(
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
                    </NativeSelect>
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
                        const next = await importSource(current, file);
                        accept(next);
                        if (!mounted.current) return;
                        setPending((files) =>
                          files.filter((f) => f.id !== file.id),
                        );
                        if (pending.length === 1)
                          await navigate({
                            to: "/project/$id",
                            params: { id: next.id },
                            search: { section: "chapters" },
                          });
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
                        await commands.localSourceRelease(file.id);
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
            {current.sources.length ? (
              <Button
                variant="outline"
                disabled={busy || pending.length > 0}
                onClick={() => setShowImport(false)}
              >
                <Trans>返回分章检查</Trans>
              </Button>
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
}
