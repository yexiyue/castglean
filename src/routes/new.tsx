import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BrowserPreviewGuide } from "@/components/browser-preview-guide";
import { PageShell } from "@/components/page-shell";
import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
    if (selected.length > 0) setShowImport(true);
    if (!current && !draft.title.trim() && selected[0])
      setDraft((d) => ({
        ...d,
        title: selected[0].filename.replace(/\.txt$/i, "").slice(0, 80),
      }));
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
      description={t`选择 TXT，检查编码后开始制作。`}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-5 p-5">
        {(error || loadError) && (
          <Alert variant="destructive">
            <AlertDescription>
              {error ?? t`无法读取恢复草案，原记录已保留。`}
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy} onClick={() => void run(selectSources)}>
            <Trans>选择 TXT 文件</Trans>
          </Button>
          <NativeSelect
            aria-label={t`TXT 导入方式`}
            value={split ? "book" : "chapters"}
            disabled={busy}
            onChange={(e) => setSplit(e.target.value === "book")}
          >
            <option value="book">{t`整本小说，自动分章`}</option>
            <option value="chapters">{t`每个文件作为一章`}</option>
          </NativeSelect>
        </div>
        {!current &&
          !pending.length &&
          projects
            .filter((p) => p.sourceCount === 0)
            .map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between border-b py-2 text-sm"
              >
                <span>{p.title}</span>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      accept(await commands.localProjectSnapshot(p.id)),
                    )
                  }
                >
                  <Trans>继续导入</Trans>
                </Button>
              </div>
            ))}
        {(pending.length > 0 || current) && (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                let project =
                  current ??
                  (await commands.localProjectCreate(
                    draft.title,
                    draft.description,
                  ));
                accept(project);
                // Commit each selected file using the new authoritative revision. A failed file
                // stays pending; already committed files are removed and never imported twice.
                for (const file of pending) {
                  project = await importSource(project, file);
                  accept(project);
                  if (!mounted.current) return;
                  setPending((files) => files.filter((f) => f.id !== file.id));
                }
                setDraft({ title: "", description: "" });
                await navigate({
                  to: "/project/$id",
                  params: { id: project.id },
                  search: { section: "chapters" },
                });
              });
            }}
          >
            {!current ? (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`${formId}-title`}>
                    <Trans>工程名称</Trans>
                  </FieldLabel>
                  <Input
                    id={`${formId}-title`}
                    required
                    maxLength={80}
                    value={draft.title}
                    disabled={busy}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, title: e.target.value }))
                    }
                  />
                </Field>
              </FieldGroup>
            ) : (
              <p className="text-sm font-medium">{current.title}</p>
            )}
            {pending.map((file) => (
              <section
                key={file.id}
                className="flex flex-col gap-3 border-b pb-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {file.filename}
                  </span>
                  <NativeSelect
                    aria-label={t`TXT 字符编码`}
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
                  <Button
                    type="button"
                    size="sm"
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
                <div className="grid gap-3 lg:grid-cols-3">
                  {file.samples.map((text, index) => (
                    <pre
                      // biome-ignore lint/suspicious/noArrayIndexKey: 固定的首中尾编码预览。
                      key={`${file.id}-${index}`}
                      className="max-h-36 overflow-auto border-l pl-3 text-xs leading-5 whitespace-pre-wrap"
                    >
                      {text}
                    </pre>
                  ))}
                </div>
              </section>
            ))}
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={
                  busy ||
                  pending.length === 0 ||
                  (!current && !draft.title.trim())
                }
              >
                <Trans>导入并开始制作</Trans>
              </Button>
              {current?.sources.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setShowImport(false)}
                >
                  <Trans>返回章节</Trans>
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </PageShell>
  );
}
