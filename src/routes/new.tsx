import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BookOpenIcon,
  CheckIcon,
  FileTextIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { readChapterFiles } from "@/lib/chapter-import";
import type { ImportIssue, ImportIssueCode } from "@/lib/chapter-import";
import { usePreviewProjects } from "@/lib/preview-projects";
import type { PreviewChapter } from "@/lib/preview-projects";
import { cn } from "@/lib/utils";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AppState } from "@/components/app-state";

function NewProjectPage() {
  const { t } = useLingui();
  const { draft, setDraft, createProject } = usePreviewProjects();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const reading = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [importFailed, setImportFailed] = useState(false);
  const [creationFailed, setCreationFailed] = useState(false);
  const [preview, setPreview] = useState<PreviewChapter | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const steps = [
    t({ comment: "新建工程的第一步", message: "工程信息" }),
    t({ comment: "新建工程的第二步", message: "导入章节" }),
    t({ comment: "新建工程的第三步", message: "确认顺序" }),
  ];
  const errors: Record<ImportIssueCode, string> = {
    format: t({ message: "暂不支持此格式，请使用 UTF-8 TXT；EPUB 请先转换。" }),
    empty: t({ message: "文件没有可导入的正文。" }),
    encoding: t({ message: "无法读取为 UTF-8 文本，请转换编码后重试。" }),
    large: t({ message: "单个文件不能超过 5 MB。" }),
    duplicate: t({ message: "相同正文已在列表中，已跳过重复导入。" }),
    limit: t({ message: "每个预览工程最多 50 章，合计不超过 20 MB。" }),
    read: t({ message: "文件读取失败，请重新选择。" }),
  };
  const nameInvalid = nameTouched && !draft.title.trim();
  const canContinue =
    draft.step === 0
      ? !!draft.title.trim()
      : draft.chapters.length > 0 &&
        draft.chapters.every((c) => c.title.trim());
  async function importFiles(files: File[]) {
    if (reading.current || !files.length) return;
    reading.current = true;
    setBusy(true);
    setIssues([]);
    setImportFailed(false);
    try {
      const result = await readChapterFiles(files, draft.chapters);
      setDraft((current) => ({
        ...current,
        chapters: [...current.chapters, ...result.chapters],
      }));
      setIssues(result.issues);
    } catch {
      setImportFailed(true);
    } finally {
      reading.current = false;
      setBusy(false);
    }
  }
  function moveChapter(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const chapters = [...current.chapters];
      const next = index + direction;
      if (next < 0 || next >= chapters.length) return current;
      [chapters[index], chapters[next]] = [chapters[next], chapters[index]];
      return { ...current, chapters };
    });
  }
  function renameChapter(id: string, title: string) {
    setDraft((current) => ({
      ...current,
      chapters: current.chapters.map((c) =>
        c.id === id ? { ...c, title } : c,
      ),
    }));
  }
  function continueStep() {
    setNameTouched(true);
    if (canContinue)
      setDraft((current) => ({ ...current, step: current.step + 1 }));
  }
  async function enterWorkspace() {
    if (creating || busy) return;
    setCreating(true);
    setCreationFailed(false);
    try {
      const project = createProject();
      if (project)
        await navigate({ to: "/project/$id", params: { id: project.id } });
    } catch {
      setCreationFailed(true);
    } finally {
      setCreating(false);
    }
  }
  return (
    <PageShell
      active="projects"
      title={t({ comment: "创建工程向导页面标题", message: "新建工程" })}
      description={t({ message: "先整理章节，再开始制作声音。" })}
      actions={
        <Button
          variant="ghost"
          nativeButton={false}
          render={<Link to="/" />}
          disabled={busy || creating}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          <Trans comment="离开向导，当前会话保留草稿">返回工程</Trans>
        </Button>
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-7">
        <nav
          aria-label={t({
            comment: "创建工程向导步骤导航",
            message: "新建工程步骤",
          })}
        >
          <ol className="flex flex-wrap items-center gap-3">
            {steps.map((label, index) => (
              <li key={label} className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || creating || index > draft.step}
                  aria-current={draft.step === index ? "step" : undefined}
                  onClick={() =>
                    setDraft((current) => ({ ...current, step: index }))
                  }
                >
                  <Badge
                    variant={draft.step === index ? "default" : "secondary"}
                  >
                    {index < draft.step ? <CheckIcon /> : index + 1}
                  </Badge>
                  {label}
                </Button>
                {index < 2 ? (
                  <ArrowRightIcon className="text-muted-foreground size-3" />
                ) : null}
              </li>
            ))}
          </ol>
        </nav>
        <Card>
          <CardHeader>
            <CardTitle>{steps[draft.step]}</CardTitle>
            <CardDescription>
              {draft.step === 0
                ? t({ message: "给工程起个名字，稍后可继续添加章节。" })
                : draft.step === 1
                  ? t({
                      message:
                        "每个 TXT 文件作为一章，默认按文件名自然排序，原文不会被改写。",
                    })
                  : t({
                      message: "确认章节标题和顺序。更改标题不会改动原文。",
                    })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {draft.step === 0 ? (
              <FieldGroup className="max-w-xl">
                <Field data-invalid={nameInvalid}>
                  <FieldLabel htmlFor="project-name">
                    <Trans comment="新建工程必填名称">工程名称</Trans>
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    id="project-name"
                    required
                    maxLength={80}
                    value={draft.title}
                    aria-invalid={nameInvalid}
                    aria-describedby={
                      nameInvalid ? "project-name-error" : "project-name-hint"
                    }
                    placeholder={t({
                      comment: "工程名称示例提示",
                      message: "例如：夜航灯",
                    })}
                    onBlur={() => setNameTouched(true)}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        title: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        continueStep();
                      }
                    }}
                  />
                  <FieldDescription id="project-name-hint">
                    <Trans>用于工程列表和工作台显示。</Trans>
                  </FieldDescription>
                  {nameInvalid ? (
                    <FieldError id="project-name-error">
                      <Trans>请输入工程名称。</Trans>
                    </FieldError>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="project-description">
                    <Trans comment="工程可选备注">备注（选填）</Trans>
                  </FieldLabel>
                  <Textarea
                    id="project-description"
                    maxLength={500}
                    value={draft.description}
                    placeholder={t({
                      comment: "新建工程备注输入提示",
                      message: "记录版本、作者或制作计划…",
                    })}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        description: e.target.value,
                      }))
                    }
                  />
                </Field>
              </FieldGroup>
            ) : null}
            {draft.step === 1 ? (
              <>
                <input
                  ref={input}
                  id="chapter-files"
                  type="file"
                  accept=".txt,text/plain"
                  multiple
                  aria-invalid={
                    importFailed ||
                    issues.some((issue) => issue.code !== "duplicate")
                  }
                  aria-describedby={
                    importFailed || issues.length
                      ? "chapter-import-issues"
                      : undefined
                  }
                  disabled={busy}
                  className="sr-only"
                  aria-label={t({
                    comment: "批量选择要导入的 TXT 章节文件",
                    message: "选择章节文件",
                  })}
                  onChange={(e) => {
                    void importFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  disabled={busy}
                  className={cn(
                    "flex h-auto min-h-40 w-full flex-col gap-3 border-dashed py-8",
                    dragging && "bg-accent",
                  )}
                  onClick={() => input.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!busy) setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void importFiles(Array.from(e.dataTransfer.files));
                  }}
                >
                  <UploadIcon />
                  <span>
                    {busy
                      ? t({
                          comment: "章节文件读取状态",
                          message: "正在读取章节…",
                        })
                      : t({
                          comment: "章节文件选择与拖放入口",
                          message: "拖入章节文件，或点击选择",
                        })}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    <Trans>UTF-8 TXT · 单文件 5 MB 以内</Trans>
                  </span>
                </Button>
                {issues.length ? (
                  <Alert id="chapter-import-issues">
                    <AlertTitle>
                      <Trans>有文件未导入</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <ul className="flex flex-col gap-2">
                        {issues.map((issue) => (
                          <li key={issue.id}>
                            <span className="font-medium">
                              {issue.filename}
                            </span>
                            ：{errors[issue.code]}
                          </li>
                        ))}
                      </ul>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => input.current?.click()}
                      >
                        <Trans comment="批量导入出现问题后重新选择章节文件">
                          重新选择文件
                        </Trans>
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}
                {importFailed && (
                  <Alert variant="destructive" id="chapter-import-issues">
                    <AlertTitle>
                      <Trans>未能读取章节</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>已添加的章节仍保留，请重新选择文件。</Trans>
                      <div className="mt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => input.current?.click()}
                        >
                          <Trans comment="批量导入出现问题后重新选择章节文件">
                            重新选择文件
                          </Trans>
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">
                    <Plural
                      value={draft.chapters.length}
                      one="已添加 # 章"
                      other="已添加 # 章"
                      comment="待导入列表中的章节数量"
                    />
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => input.current?.click()}
                  >
                    <PlusIcon data-icon="inline-start" />
                    <Trans comment="继续添加章节文件">添加文件</Trans>
                  </Button>
                </div>
              </>
            ) : null}
            {draft.step > 0 && draft.chapters.length ? (
              <div className="border-border overflow-hidden rounded-lg border">
                <ol className="divide-border flex flex-col divide-y">
                  {draft.chapters.map((chapter, index) => (
                    <li
                      key={chapter.id}
                      className="flex flex-wrap items-center gap-3 p-3"
                    >
                      <span className="text-muted-foreground w-6 shrink-0 text-center font-mono text-xs">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <FileTextIcon className="text-muted-foreground hidden size-4 shrink-0 sm:block" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        {draft.step === 2 ? (
                          <Input
                            value={chapter.title}
                            maxLength={120}
                            aria-label={t({
                              comment: "可编辑的章节元数据标题，不修改原文",
                              message: `章节标题：${chapter.filename}`,
                            })}
                            aria-invalid={!chapter.title.trim()}
                            onChange={(e) =>
                              renameChapter(chapter.id, e.target.value)
                            }
                          />
                        ) : (
                          <span className="truncate text-sm font-medium">
                            {chapter.title}
                          </span>
                        )}
                        <span className="text-muted-foreground truncate text-xs">
                          {chapter.filename} ·{" "}
                          <Plural
                            value={chapter.characters}
                            one="# 字符"
                            other="# 字符"
                            comment="导入文本的 Unicode 码点数量"
                          />
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreview(chapter)}
                          disabled={busy}
                        >
                          <Trans comment="查看此章只读正文">预览</Trans>
                        </Button>
                        {draft.step === 2 ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={index === 0}
                              aria-label={t({
                                comment: "将本章在列表中上移一位",
                                message: `上移：${chapter.title}`,
                              })}
                              onClick={() => moveChapter(index, -1)}
                            >
                              <ArrowUpIcon />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={index === draft.chapters.length - 1}
                              aria-label={t({
                                comment: "将本章在列表中下移一位",
                                message: `下移：${chapter.title}`,
                              })}
                              onClick={() => moveChapter(index, 1)}
                            >
                              <ArrowDownIcon />
                            </Button>
                          </>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          aria-label={t({
                            comment: "仅从导入草稿中移除文件，不删除源文件",
                            message: `移除：${chapter.title}`,
                          })}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              chapters: current.chapters.filter(
                                (c) => c.id !== chapter.id,
                              ),
                            }))
                          }
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {draft.step === 1 && !draft.chapters.length && !busy ? (
              <AppState
                compact
                title={<Trans>还没有章节</Trans>}
                description={
                  <Trans>
                    可以一次选择多个 TXT 文件，导入后再调整标题与顺序。
                  </Trans>
                }
              />
            ) : null}
            {draft.step === 2 ? (
              <>
                <Separator />
                <div className="flex items-center gap-3">
                  <BookOpenIcon className="text-primary size-5" />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{draft.title}</span>
                    <span className="text-muted-foreground text-xs">
                      <Plural
                        value={draft.chapters.length}
                        one="# 章将进入工作台预览"
                        other="# 章将进入工作台预览"
                        comment="确认进入工作台的章节数量"
                      />
                    </span>
                  </div>
                </div>
                {!canContinue ? (
                  <FieldError>
                    <Trans>请至少保留一章，并填写每章的标题。</Trans>
                  </FieldError>
                ) : null}
              </>
            ) : null}
          </CardContent>
          {creationFailed && (
            <Alert variant="destructive" className="mx-4 w-auto">
              <AlertTitle>
                <Trans>未能进入工作台</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>已导入的内容仍保留在本次会话中，请返回首页继续。</Trans>
                <div className="mt-3">
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link to="/" />}
                  >
                    <Trans comment="找不到页面时返回应用工程列表">
                      返回工程首页
                    </Trans>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <CardFooter className="justify-between gap-3">
            <Button
              variant="ghost"
              disabled={draft.step === 0 || busy || creating}
              onClick={() =>
                setDraft((current) => ({ ...current, step: current.step - 1 }))
              }
            >
              <ArrowLeftIcon data-icon="inline-start" />
              <Trans comment="创建工程向导返回前一步">上一步</Trans>
            </Button>
            {draft.step < 2 ? (
              <Button disabled={!canContinue || busy} onClick={continueStep}>
                <Trans comment="创建工程向导进入下一步">下一步</Trans>
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            ) : (
              <Button
                disabled={!canContinue || busy || creating}
                onClick={() => void enterWorkspace()}
              >
                <Trans comment="生成仅存在当前会话的预览工程并打开工作台">
                  创建并进入预览
                </Trans>
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            )}
          </CardFooter>
        </Card>
        <p className="text-muted-foreground text-center text-xs leading-6">
          <Trans>
            文件只在本地读取，不会上传。进入工作台后可保存工程，下次重新打开继续。
          </Trans>
        </p>
      </div>
      <Sheet
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <SheetContent showCloseButton={false} className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{preview?.title}</SheetTitle>
            <SheetDescription>
              {preview?.filename} ·{" "}
              <Trans comment="原文预览不可编辑">只读预览</Trans>
            </SheetDescription>
          </SheetHeader>
          <SheetClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-3 right-3"
                aria-label={t({
                  comment: "关闭章节原文预览侧栏",
                  message: "关闭预览",
                })}
              />
            }
          >
            <XIcon />
          </SheetClose>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <p className="text-sm leading-8 wrap-break-word whitespace-pre-wrap">
              {preview?.source}
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
export const Route = createFileRoute("/new")({ component: NewProjectPage });
