import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  EllipsisIcon,
  FolderTreeIcon,
  LocateFixedIcon,
  PencilIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { HeadingRulesEditor } from "@/components/projects/heading-rules-editor";
import { StructureRecovery } from "@/components/projects/structure-recovery";
import { useWorkspaceMode } from "@/components/projects/workspace-mode";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  Chapter_Serialize,
  HeadingRule,
  LocalProjectSnapshot_Serialize,
  ProjectEdit_Deserialize,
} from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import { appHotkeys } from "@/lib/hotkeys";
import { structureOperations } from "@/lib/structure-operation";

const structureSchema = z
  .object({
    mode: z.enum(["edit", "volume", "jump"]),
    title: z.string(),
    volume: z.string(),
    jump: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "jump") {
      const line = Number(value.jump);
      if (!value.jump.trim() || !Number.isSafeInteger(line) || line < 1)
        ctx.addIssue({
          code: "custom",
          path: ["jump"],
          message: "invalid_line",
        });
    } else if (!value.title.trim() || value.title.length > 120) {
      ctx.addIssue({
        code: "custom",
        path: ["title"],
        message: "invalid_title",
      });
    }
  });

export function StructureActions({
  project,
  chapter,
  line,
  active,
  onChange,
  onLocate,
  onAddSources,
  editRequest = 0,
  deferProposalResult = false,
}: {
  project: LocalProjectSnapshot_Serialize;
  chapter: Chapter_Serialize;
  line: number;
  active: boolean;
  onChange: (next: LocalProjectSnapshot_Serialize) => void;
  onLocate: (sourceId: string, line: number) => void;
  onAddSources: () => void;
  editRequest?: number;
  deferProposalResult?: boolean;
}) {
  const { t } = useLingui();
  const { workspace } = useDesktopSession();
  const operations = useMemo(
    () => structureOperations(workspace(project.id)),
    [project.id, workspace],
  );
  const operation = useSyncExternalStore(
    operations.subscribe,
    operations.snapshot,
    operations.snapshot,
  );
  const visible = useWorkspaceMode()?.active ?? true;
  const formId = useId();
  const [open, setOpen] = useState<"edit" | "volume" | "rules" | "jump" | null>(
    null,
  );
  const form = useForm<z.infer<typeof structureSchema>>({
    resolver: zodResolver(structureSchema),
    defaultValues: { mode: "edit", title: "", volume: "", jump: "1" },
  });
  const busy = operation?.phase === "sending" || operation?.phase === "reading";
  const pending = operations.hasPending();
  const [frozen, setFrozen] = useState({
    revision: project.revision,
    chapter,
    line,
  });
  const [rulesInitial, setRulesInitial] = useState<HeadingRule[]>(
    project.rules,
  );
  const draftKey = useRef<string | null>(null);
  const jumpReturnFocus = useRef<HTMLElement | null>(null);
  const draftStore = useRef<Record<string, unknown> | null>(null);
  const draftBaseline = useRef<z.infer<typeof structureSchema> | null>(null);
  const draftTarget = useRef<typeof frozen | null>(null);
  function show(value: typeof open) {
    if (pending && value !== "jump") return;
    jumpReturnFocus.current =
      value === "jump" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const values = workspace(project.id);
    const key =
      value === "edit"
        ? `structure:edit:${chapter.id}`
        : value === "volume"
          ? `structure:volume:${chapter.sourceId}:${line}`
          : null;
    const saved = key
      ? (values[key] as
          | {
              values: z.infer<typeof structureSchema>;
              baseline: z.infer<typeof structureSchema>;
              frozen: typeof frozen;
            }
          | undefined)
      : undefined;
    const rulesDraft =
      value === "rules"
        ? (values["structure:rules"] as
            | {
                rules: HeadingRule[];
                baseline: HeadingRule[];
                frozen: typeof frozen;
              }
            | undefined)
        : undefined;
    const target = saved?.frozen ??
      rulesDraft?.frozen ?? {
        revision: project.revision,
        chapter,
        line,
      };
    setFrozen(target);
    if (value === "rules")
      setRulesInitial(structuredClone(rulesDraft?.rules ?? project.rules));
    const baseline: z.infer<typeof structureSchema> = saved?.baseline ?? {
      mode: value === "jump" ? "jump" : value === "volume" ? "volume" : "edit",
      title: value === "edit" ? chapter.title : "",
      volume: chapter.volumeId ?? "",
      jump: String(line + 1),
    };
    draftKey.current = null;
    form.reset(saved?.values ?? baseline);
    draftKey.current = key;
    draftStore.current = values;
    draftBaseline.current = baseline;
    draftTarget.current = target;
    setOpen(value);
  }
  useEffect(() => {
    const subscription = form.watch((values) => {
      const key = draftKey.current;
      const store = draftStore.current;
      const baseline = draftBaseline.current;
      const target = draftTarget.current;
      if (key && store && baseline && target) {
        if (JSON.stringify(values) === JSON.stringify(baseline))
          delete store[key];
        else store[key] = { values, baseline, frozen: target };
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);
  useEffect(() => {
    if (
      operation?.phase !== "done" ||
      !operation.snapshot ||
      (deferProposalResult && operation.request.kind === "proposal")
    )
      return;
    onChange(operation.snapshot);
    if (operation.request.draftKey)
      delete workspace(operation.request.projectId)[operation.request.draftKey];
    operations.clearDone();
    draftKey.current = null;
    setOpen(null);
  }, [operation, operations, onChange, workspace, deferProposalResult]);
  useEffect(() => {
    if (
      operation?.phase === "unknown" ||
      operation?.phase === "confirmed-unread"
    )
      setOpen(null);
  }, [operation?.phase]);
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => {
    if (editRequest) showRef.current("edit");
  }, [editRequest]);
  // IME/输入框语义由库处理，重复按键由清单 requireReset 防护
  useHotkey(appHotkeys["structure.jumpToChapter"], () => show("jump"), {
    enabled: visible,
  });
  function save(edit: ProjectEdit_Deserialize | null) {
    if (operations.snapshot()) return;
    const revision = open ? frozen.revision : project.revision;
    operations.start({
      projectId: project.id,
      revision,
      commandId: crypto.randomUUID(),
      ...(edit ? { kind: "edit", edit } : { kind: "undo" }),
      draftKey: open === "rules" ? "structure:rules" : draftKey.current,
    });
  }
  const icon = (label: string, content: React.ReactNode, click: () => void) => (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            onClick={click}
            disabled={busy || pending}
          />
        }
      >
        {content}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        {label}
      </TooltipContent>
    </Tooltip>
  );
  return (
    <>
      {icon(t`转到行`, <LocateFixedIcon />, () => show("jump"))}
      {icon(t`分卷设置`, <FolderTreeIcon />, () => show("volume"))}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t`章节更多操作`}
              disabled={busy || pending}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => show("edit")}>
              <PencilIcon />
              <Trans>编辑章节</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => show("rules")}>
              <Trans>标题规则</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy || active || !project.canUndo}
              onClick={() => void save(null)}
            >
              <Trans>撤销结构调整</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAddSources}>
              <Trans>追加原文文件</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <StructureRecovery operations={operations} onRead={onChange} />
      <Dialog
        open={visible && !!open}
        onOpenChange={(next) => {
          if (!next && !busy) setOpen(null);
        }}
      >
        <DialogContent
          className={open === "rules" ? "sm:max-w-3xl" : undefined}
          finalFocus={() =>
            jumpReturnFocus.current?.isConnected
              ? jumpReturnFocus.current
              : true
          }
        >
          <DialogTitle>
            {open === "edit"
              ? t`编辑章节`
              : open === "volume"
                ? t`分卷设置`
                : open === "rules"
                  ? t`标题规则`
                  : t`转到行`}
          </DialogTitle>
          {open !== "jump" && (
            <div className="text-muted-foreground space-y-1 text-xs">
              <p>
                <Trans>工程：{project.title}</Trans>
              </p>
              {open === "rules" && (
                <p>
                  <Trans>规则会重新检查整个目录。</Trans>
                </p>
              )}
              {open !== "rules" && (
                <>
                  <p>
                    <Trans>章节：{frozen.chapter.title}</Trans>
                  </p>
                  <p>
                    <Trans>
                      来源：
                      {project.sources.find(
                        (source) => source.id === frozen.chapter.sourceId,
                      )?.filename ?? ""}{" "}
                      · 第{" "}
                      {(open === "edit"
                        ? (frozen.chapter.heading ?? 0)
                        : frozen.line) + 1}{" "}
                      行
                    </Trans>
                  </p>
                </>
              )}
            </div>
          )}
          {open !== "jump" ? (
            <p className="text-muted-foreground text-xs">
              <Trans>
                调整章节边界后，相关分析可能失效；历史与人工记录保留，不会自动迁移。
              </Trans>
            </p>
          ) : null}
          {open !== "jump" && (
            <p className="text-muted-foreground text-xs">
              <Trans>
                历史音频会保留；边界变化后需要重新检查音频是否适用。
              </Trans>
            </p>
          )}
          {open === "rules" ? (
            <HeadingRulesEditor
              key={frozen.revision}
              initialRules={rulesInitial}
              disabled={busy || pending}
              onApply={(rules) => void save({ kind: "rules", rules })}
              onDraftChange={(rules) => {
                const values = workspace(project.id);
                const saved = values["structure:rules"] as
                  | { baseline: HeadingRule[]; frozen: typeof frozen }
                  | undefined;
                const baseline = saved?.baseline ?? project.rules;
                if (JSON.stringify(rules) === JSON.stringify(baseline))
                  delete values["structure:rules"];
                else
                  values["structure:rules"] = {
                    rules: structuredClone(rules),
                    baseline: structuredClone(baseline),
                    frozen: saved?.frozen ?? frozen,
                  };
              }}
              onDiscard={() => {
                delete workspace(project.id)["structure:rules"];
                setOpen(null);
              }}
            />
          ) : (
            <form
              className="space-y-3"
              noValidate
              onSubmit={form.handleSubmit(({ title, volume, jump }) => {
                if (open === "jump") {
                  const target = Number(jump);
                  onLocate(frozen.chapter.sourceId, target - 1);
                  setOpen(null);
                } else if (open === "volume")
                  void save({
                    kind: "volume",
                    sourceId: frozen.chapter.sourceId,
                    line: frozen.line,
                    title,
                  });
                else
                  void save({
                    kind: "boundary",
                    correction: {
                      sourceId: frozen.chapter.sourceId,
                      line: frozen.chapter.heading ?? 0,
                      include: true,
                      title,
                      volumeId: volume || null,
                    },
                  });
              })}
            >
              {open === "jump" ? (
                <Field data-invalid={!!form.formState.errors.jump}>
                  <FieldLabel htmlFor={`${formId}-line`}>
                    <Trans>转到行</Trans>
                  </FieldLabel>
                  <Input
                    {...form.register("jump")}
                    id={`${formId}-line`}
                    aria-label={t`原文行号`}
                    autoFocus
                    type="number"
                    min={1}
                    disabled={busy}
                    aria-invalid={!!form.formState.errors.jump}
                    aria-describedby={
                      form.formState.errors.jump
                        ? `${formId}-line-error`
                        : undefined
                    }
                  />
                  {form.formState.errors.jump && (
                    <FieldError id={`${formId}-line-error`}>
                      <Trans>请输入有效行号。</Trans>
                    </FieldError>
                  )}
                </Field>
              ) : (
                <Field data-invalid={!!form.formState.errors.title}>
                  <FieldLabel htmlFor={`${formId}-title`}>
                    {open === "edit" ? t`章节标题` : t`新卷标题`}
                  </FieldLabel>
                  <Input
                    {...form.register("title")}
                    id={`${formId}-title`}
                    autoFocus
                    maxLength={120}
                    disabled={busy}
                    aria-label={open === "edit" ? t`章节标题` : t`新卷标题`}
                    aria-invalid={!!form.formState.errors.title}
                    aria-describedby={
                      form.formState.errors.title
                        ? `${formId}-title-error`
                        : undefined
                    }
                  />
                  {form.formState.errors.title && (
                    <FieldError id={`${formId}-title-error`}>
                      <Trans>请输入标题。</Trans>
                    </FieldError>
                  )}
                </Field>
              )}
              {open === "edit" ? (
                <Field>
                  <FieldLabel htmlFor={`${formId}-volume`}>
                    <Trans>所属卷</Trans>
                  </FieldLabel>
                  <NativeSelect
                    id={`${formId}-volume`}
                    disabled={busy}
                    {...form.register("volume")}
                  >
                    <option value="">{t`按标题位置分组`}</option>
                    {project.volumes
                      .filter((v) => v.sourceId === frozen.chapter.sourceId)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title}
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (draftKey.current && draftStore.current)
                      delete draftStore.current[draftKey.current];
                    draftKey.current = null;
                    setOpen(null);
                  }}
                >
                  <Trans>取消</Trans>
                </Button>
                <Button
                  type="submit"
                  disabled={busy || (open !== "jump" && active)}
                >
                  {open === "jump" ? t`前往` : t`保存`}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
