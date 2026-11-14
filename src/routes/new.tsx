import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { BrowserPreviewGuide } from "@/components/browser-preview-guide";
import { PageShell } from "@/components/page-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type {
  FilePreview,
  LocalProjectSnapshot_Serialize,
} from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import { desktop, useLocalProjects } from "@/lib/local-projects";

const importSchema = z.object({
  title: z.string().trim().min(1).max(80),
  files: z.array(
    z.object({ id: z.string(), encoding: z.enum(["utf-8", "gb18030", "gbk"]) }),
  ),
});

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
  const { draft: requestedDraft } = Route.useSearch();
  return (
    <NovelImportEditor
      key={requestedDraft ?? "new"}
      requestedDraft={requestedDraft}
    />
  );
}

function NovelImportEditor({ requestedDraft }: { requestedDraft?: string }) {
  const { t } = useLingui();
  const formId = useId();
  const {
    projects,
    upsertProject,
    draft,
    setDraft,
    loadError,
    importSession,
    updateImportSession,
    bindImportSession,
    prepareImportSelections,
  } = useLocalProjects();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<LocalProjectSnapshot_Serialize | null>(
    null,
  );
  const [projectState, setProjectState] = useState<
    "loading" | "ready" | "failed"
  >(requestedDraft ? "loading" : "ready");
  const [session] = useState(() => importSession(requestedDraft));
  const pending = session.files;
  const form = useForm({
    resolver: zodResolver(importSchema),
    values: {
      title: current?.title ?? draft.title,
      files: pending.map(({ id, encoding }) => ({
        id,
        encoding: encoding as "utf-8" | "gb18030" | "gbk",
      })),
    },
  });
  const split = session.split;
  function setPending(update: (files: FilePreview[]) => FilePreview[]) {
    updateImportSession(session, (value) => {
      value.files = update(value.files);
    });
  }
  function setSplit(value: boolean) {
    updateImportSession(session, (current) => {
      current.split = value;
    });
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!requestedDraft) return;
    let active = true;
    setCurrent(null);
    setProjectState("loading");
    void commands
      .localProjectSnapshot(requestedDraft)
      .then((next) => {
        if (active) {
          setCurrent(next);
          setProjectState("ready");
          upsertProject(next);
        }
      })
      .catch(() => {
        if (active) {
          setError(t`无法读取本地工程。`);
          setProjectState("failed");
        }
      });
    return () => {
      active = false;
    };
  }, [requestedDraft, t, upsertProject]);

  function commandId(operation: string, value: unknown) {
    const key = JSON.stringify([operation, value]);
    let id = session.commandIds.get(key);
    if (!id) {
      id = crypto.randomUUID();
      session.commandIds.set(key, id);
    }
    return id;
  }
  function accept(next: LocalProjectSnapshot_Serialize) {
    bindImportSession(session, next.id);
    upsertProject(next);
    if (mounted.current) setCurrent(next);
  }
  async function importSource(
    project: LocalProjectSnapshot_Serialize,
    file: FilePreview,
  ) {
    const request = session.operations[file.id] ?? {
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
    };
    session.operations[file.id] = request;
    try {
      await commands.localProjectImport(request);
    } catch (cause) {
      if (
        typeof cause === "string" &&
        [
          "conflict",
          "duplicate_source",
          "invalid_encoding",
          "invalid_rule",
          "too_large",
          "busy",
          "read_failed",
          "not_found",
          "invalid_format",
          "invalid_project",
          "cancelled",
        ].includes(cause)
      ) {
        delete session.operations[file.id];
      }
      throw cause;
    }
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
          return t`工程已变化，请重新读取后重试。`;
        case "duplicate_source":
          return t`正文已导入，请移除此文件。`;
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
    await prepareImportSelections();
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
    if (!current && !draft.title.trim() && selected[0])
      setDraft((d) => ({
        ...d,
        title: selected[0].filename.replace(/\.txt$/i, "").slice(0, 80),
      }));
  }

  async function reloadProject() {
    const id = current?.id ?? requestedDraft;
    if (!id) return;
    const next = await commands.localProjectSnapshot(id);
    accept(next);
    setProjectState("ready");
    updateImportSession(session, (value) => {
      for (const fileId of Object.keys(value.errors)) {
        if (value.errors[fileId] === "conflict") delete value.errors[fileId];
      }
    });
  }

  if (!desktop)
    return (
      <PageShell
        title={t({ comment: "新建工程并导入章节", message: "新建工程" })}
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
      title={t({ comment: "新建工程并导入章节", message: "新建工程" })}
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
        {(projectState === "failed" ||
          Object.values(session.errors).includes("conflict")) && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void run(reloadProject)}
          >
            <Trans>重新读取工程</Trans>
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy || projectState !== "ready"}
            onClick={() => void run(selectSources)}
          >
            <Trans>选择 TXT 文件</Trans>
          </Button>
          <NativeSelect
            aria-label={t`TXT 导入方式`}
            value={split ? "book" : "chapters"}
            disabled={
              busy ||
              projectState !== "ready" ||
              Object.keys(session.operations).length > 0
            }
            onChange={(e) => setSplit(e.target.value === "book")}
          >
            <option value="book">{t`整本小说，自动分章`}</option>
            <option value="chapters">{t`每个文件作为一章`}</option>
          </NativeSelect>
        </div>
        {!requestedDraft &&
          !current &&
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
                    void navigate({ to: "/new", search: { draft: p.id } })
                  }
                >
                  <Trans>继续导入</Trans>
                </Button>
              </div>
            ))}
        {(pending.length > 0 || current) && (
          <form
            className="flex flex-col gap-5"
            onSubmit={form.handleSubmit(({ title }) => {
              void run(async () => {
                let project =
                  current ??
                  (await commands.localProjectCreate(title, draft.description));
                accept(project);
                if (!current) setDraft({ title: "", description: "" });
                // Commit each selected file using the new authoritative revision. A failed file
                // stays pending; already committed files are removed and never imported twice.
                for (const file of pending) {
                  try {
                    project = await importSource(project, file);
                  } catch (cause) {
                    updateImportSession(session, (value) => {
                      value.errors[file.id] =
                        typeof cause === "string" ? cause : "unknown";
                    });
                    throw cause;
                  }
                  accept(project);
                  updateImportSession(session, (value) => {
                    value.files = value.files.filter((f) => f.id !== file.id);
                    value.completed.push({
                      id: file.id,
                      filename: file.filename,
                    });
                    delete value.errors[file.id];
                    delete value.operations[file.id];
                  });
                  if (!mounted.current) return;
                }
                setDraft({ title: "", description: "" });
                await navigate({
                  to: "/project/$id",
                  params: { id: project.id },
                  search: { section: "chapters" },
                });
              });
            })}
          >
            {!current ? (
              <FieldGroup>
                <Controller
                  control={form.control}
                  name="title"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={`${formId}-title`}>
                        <Trans>工程名称</Trans>
                      </FieldLabel>
                      <Input
                        {...field}
                        id={`${formId}-title`}
                        maxLength={80}
                        disabled={busy}
                        aria-invalid={fieldState.invalid}
                        aria-describedby={
                          fieldState.invalid
                            ? `${formId}-title-error`
                            : undefined
                        }
                        onChange={(e) => {
                          field.onChange(e);
                          setDraft((d) => ({ ...d, title: e.target.value }));
                        }}
                      />
                      {fieldState.invalid && (
                        <FieldError id={`${formId}-title-error`}>
                          <Trans>请输入工程名称。</Trans>
                        </FieldError>
                      )}
                    </Field>
                  )}
                />
              </FieldGroup>
            ) : (
              <p className="text-sm font-medium">{current.title}</p>
            )}
            {session.completed.map(({ id, filename }) => (
              <p key={id} className="text-muted-foreground text-sm">
                <Trans>已导入：{filename}</Trans>
              </p>
            ))}
            {pending.map((file, index) => (
              <section
                key={file.id}
                className="flex flex-col gap-3 border-b pb-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {file.filename}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {session.errors[file.id] ? (
                      <Trans>未完成</Trans>
                    ) : (
                      <Trans>待导入</Trans>
                    )}
                  </span>
                  <Controller
                    control={form.control}
                    name={`files.${index}.encoding`}
                    render={({ field }) => (
                      <NativeSelect
                        ref={field.ref}
                        name={field.name}
                        onBlur={field.onBlur}
                        aria-label={t`${file.filename} 的 TXT 字符编码`}
                        aria-invalid={!!session.errors[file.id]}
                        aria-describedby={
                          session.errors[file.id]
                            ? `${formId}-file-${index}-error`
                            : undefined
                        }
                        value={field.value}
                        disabled={busy || !!session.operations[file.id]}
                        onChange={(e) => {
                          const encoding = e.target.value;
                          field.onChange(encoding);
                          void run(async () => {
                            try {
                              const next = await commands.localSourcePreview(
                                file.id,
                                encoding,
                              );
                              updateImportSession(session, (value) => {
                                value.files = value.files.map((f) =>
                                  f.id === file.id ? next : f,
                                );
                                delete value.errors[file.id];
                              });
                            } catch (cause) {
                              form.setValue(
                                `files.${index}.encoding`,
                                file.encoding as "utf-8" | "gb18030" | "gbk",
                              );
                              updateImportSession(session, (value) => {
                                value.errors[file.id] =
                                  typeof cause === "string" ? cause : "unknown";
                              });
                              throw cause;
                            }
                          });
                        }}
                      >
                        <option value="utf-8">UTF-8</option>
                        <option value="gb18030">GB18030</option>
                        <option value="gbk">GBK</option>
                      </NativeSelect>
                    )}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t`移除 ${file.filename}`}
                    disabled={busy || !!session.operations[file.id]}
                    onClick={() =>
                      void run(async () => {
                        await commands.localSourceRelease(file.id);
                        updateImportSession(session, (value) => {
                          value.files = value.files.filter(
                            (f) => f.id !== file.id,
                          );
                          delete value.errors[file.id];
                        });
                      })
                    }
                  >
                    <Trans comment="移除尚未导入的 TXT">移除</Trans>
                  </Button>
                </div>
                {session.errors[file.id] && (
                  <p
                    id={`${formId}-file-${index}-error`}
                    role="alert"
                    className="text-destructive text-sm"
                  >
                    {failure(session.errors[file.id])}
                    {session.operations[file.id] && (
                      <Trans>
                        请重试以确认上次导入结果；确认前不能更改编码或移除文件。
                      </Trans>
                    )}
                  </p>
                )}
                <p className="text-muted-foreground text-sm">
                  <Trans>以下是编码预览，并非分章后的正文。</Trans>{" "}
                  {file.samplesOverlap && (
                    <Trans>预览片段在原文中有重叠。</Trans>
                  )}
                </p>
                <div className="grid gap-3 lg:grid-cols-3">
                  {file.samples.map((text, index) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: 固定的首中尾编码预览。
                      key={`${file.id}-${index}`}
                    >
                      <p className="text-muted-foreground mb-1 text-xs font-medium">
                        {[t`开头`, t`中间`, t`末尾`][index]}
                      </p>
                      <pre className="max-h-36 overflow-auto border-l pl-3 text-xs leading-5 whitespace-pre-wrap">
                        {text}
                      </pre>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={
                  busy || projectState !== "ready" || pending.length === 0
                }
              >
                <Trans>导入并开始制作</Trans>
              </Button>
              {current?.sources.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void navigate({
                      to: "/project/$id",
                      params: { id: current.id },
                      search: { section: "chapters" },
                    })
                  }
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
