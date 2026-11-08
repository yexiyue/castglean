import { Trans, useLingui } from "@lingui/react/macro";
import {
  EllipsisIcon,
  FolderTreeIcon,
  LocateFixedIcon,
  PencilIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { HeadingRulesEditor } from "@/components/projects/heading-rules-editor";
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
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type Chapter_Serialize,
  commands,
  type LocalProjectSnapshot_Serialize,
  type ProjectEdit_Deserialize,
} from "@/lib/bindings";

export function StructureActions({
  project,
  chapter,
  line,
  active,
  onChange,
  onLocate,
  onAddSources,
  editRequest = 0,
}: {
  project: LocalProjectSnapshot_Serialize;
  chapter: Chapter_Serialize;
  line: number;
  active: boolean;
  onChange: (next: LocalProjectSnapshot_Serialize) => void;
  onLocate: (sourceId: string, line: number) => void;
  onAddSources: () => void;
  editRequest?: number;
}) {
  const { t } = useLingui();
  const visible = useWorkspaceMode()?.active ?? true;
  const formId = useId();
  const [open, setOpen] = useState<"edit" | "volume" | "rules" | "jump" | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [volume, setVolume] = useState("");
  const [jump, setJump] = useState("1");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [invalidLine, setInvalidLine] = useState(false);
  const [frozen, setFrozen] = useState({
    revision: project.revision,
    chapter,
    line,
  });
  const commandsByInput = useRef(new Map<string, string>());
  function show(value: typeof open) {
    setFrozen({ revision: project.revision, chapter, line });
    setTitle(value === "edit" ? chapter.title : "");
    setVolume(chapter.volumeId ?? "");
    setJump(String(line + 1));
    setFailed(false);
    setInvalidLine(false);
    setOpen(value);
  }
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => {
    if (editRequest) showRef.current("edit");
  }, [editRequest]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!visible || event.repeat || event.isComposing) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "g" &&
        !event.isComposing
      ) {
        event.preventDefault();
        showRef.current("jump");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible]);
  async function save(edit: ProjectEdit_Deserialize | null) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const revision = open ? frozen.revision : project.revision;
    const key = JSON.stringify([project.id, revision, edit]);
    let id = commandsByInput.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      commandsByInput.current.set(key, id);
    }
    try {
      if (edit) await commands.localProjectEdit(project.id, revision, id, edit);
      else await commands.localProjectUndo(project.id, revision, id);
      const next = await commands.localProjectSnapshot(project.id);
      onChange(next);
      setOpen(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
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
            disabled={busy}
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
      {failed && !open ? (
        <p role="alert" className="text-destructive text-xs">
          <Trans>操作未完成，已有目录仍保留。请重新读取后重试。</Trans>
        </p>
      ) : null}
      <Dialog
        open={visible && !!open}
        onOpenChange={(next) => {
          if (!next && !busy) setOpen(null);
        }}
      >
        <DialogContent
          className={open === "rules" ? "sm:max-w-3xl" : undefined}
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
          {open === "volume" ? (
            <p className="text-muted-foreground text-xs">
              {
                project.sources.find((s) => s.id === frozen.chapter.sourceId)
                  ?.filename
              }{" "}
              · <Trans>第 {frozen.line + 1} 行</Trans>
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="text-destructive text-sm">
              <Trans>操作未完成，输入与已有结果保留。</Trans>
            </p>
          ) : null}
          {open !== "jump" ? (
            <p className="text-muted-foreground text-xs">
              <Trans>
                调整章节边界后，相关分析可能失效；历史与人工记录保留，不会自动迁移。
              </Trans>
            </p>
          ) : null}
          {open === "rules" ? (
            <HeadingRulesEditor
              key={frozen.revision}
              initialRules={project.rules}
              disabled={busy}
              onApply={(rules) => void save({ kind: "rules", rules })}
            />
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (open === "jump") {
                  const target = Number(jump);
                  if (!Number.isSafeInteger(target) || target < 1) {
                    setInvalidLine(true);
                    return;
                  }
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
              }}
            >
              {open === "jump" ? (
                <label
                  htmlFor={`${formId}-line`}
                  className="flex flex-col gap-2 text-sm"
                >
                  <Trans>转到行</Trans>
                  <Input
                    id={`${formId}-line`}
                    aria-label={t`原文行号`}
                    autoFocus
                    type="number"
                    min={1}
                    value={jump}
                    onChange={(e) => {
                      setJump(e.target.value);
                      setInvalidLine(false);
                    }}
                    aria-invalid={invalidLine}
                  />
                </label>
              ) : (
                <label
                  htmlFor={`${formId}-title`}
                  className="flex flex-col gap-2 text-sm"
                >
                  {open === "edit" ? t`章节标题` : t`新卷标题`}
                  <Input
                    id={`${formId}-title`}
                    autoFocus
                    required
                    maxLength={120}
                    aria-label={open === "edit" ? t`章节标题` : t`新卷标题`}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
              )}
              {open === "edit" ? (
                <label className="flex flex-col gap-2 text-sm">
                  <Trans>所属卷</Trans>
                  <NativeSelect
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
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
                </label>
              ) : null}
              {invalidLine ? (
                <p role="alert" className="text-destructive text-xs">
                  <Trans>请输入有效行号。</Trans>
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setOpen(null)}
                >
                  <Trans>取消</Trans>
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy || (open !== "jump" && (active || !title.trim()))
                  }
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
