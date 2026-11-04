import { Trans, useLingui } from "@lingui/react/macro";
import {
  AudioLinesIcon,
  CheckIcon,
  DownloadIcon,
  FileAudioIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { findPreviewModel } from "@/lib/preview-models";
import { VoiceUsage } from "@/components/voices/voice-usage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/sheet";

interface PreviewVoice {
  id: string;
  name: string;
  tone: string;
  groupLabel: string;
  source?: string;
  modelId?: string;
}

/** Actions here change only sample UI state; real voice assets belong to the host. */
export function VoiceDetailSheet({
  voice,
  onClose,
  onRename,
  onDelete,
}: {
  voice: PreviewVoice;
  onClose: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const isPreset = voice.source === "preset";
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(voice.name);
  const [attempted, setAttempted] = useState(false);
  const [renamed, setRenamed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const cleanName = name.trim();
  const invalid = attempted && !cleanName;
  const filename = `${voice.name.replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/g, "") || "voice"}.voice`;
  function endEditing() {
    setEditing(false);
    setAttempted(false);
    renameButton.current?.focus();
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        showCloseButton={false}
        className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="gap-4 p-6 pb-5">
          <div className="flex items-center justify-between gap-3">
            <Badge variant="outline">
              <Trans comment="声音详情中的示例资源标记">示例音色</Trans>
            </Badge>
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t({
                    comment: "关闭音色详情侧栏",
                    message: "关闭详情",
                  })}
                />
              }
            >
              <XIcon />
            </SheetClose>
          </div>
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="bg-secondary text-primary flex size-12 shrink-0 items-center justify-center rounded-xl text-lg font-semibold"
            >
              {Array.from(voice.name)[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <SheetTitle className="min-w-0 wrap-break-word">
                  {voice.name}
                </SheetTitle>
                {!isPreset && (
                  <Button
                    ref={renameButton}
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t({
                      comment: "编辑当前音色的显示名称",
                      message: "重命名音色",
                    })}
                    aria-expanded={editing}
                    aria-controls="voice-rename-form"
                    onClick={() => {
                      if (editing) {
                        endEditing();
                        return;
                      }
                      setName(voice.name);
                      setAttempted(false);
                      setRenamed(false);
                      setEditing(true);
                    }}
                  >
                    <PencilIcon />
                  </Button>
                )}
              </div>
              <SheetDescription className="mt-1">
                {voice.groupLabel} · {voice.tone}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-5 px-6 pb-6">
          {editing && (
            <form
              id="voice-rename-form"
              data-slot="voice-rename-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                setAttempted(true);
                if (!cleanName) return;
                if (cleanName !== voice.name) {
                  onRename(cleanName);
                  setRenamed(true);
                }
                endEditing();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  endEditing();
                }
              }}
            >
              <FieldGroup>
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="voice-rename-name">
                    <Trans comment="重命名表单中的音色显示名称">音色名称</Trans>
                  </FieldLabel>
                  <Input
                    id="voice-rename-name"
                    autoFocus
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={invalid}
                    aria-describedby={
                      invalid ? "voice-rename-error" : "voice-rename-hint"
                    }
                  />
                  {invalid && (
                    <FieldError id="voice-rename-error">
                      <Trans>请输入音色名称。</Trans>
                    </FieldError>
                  )}
                  <FieldDescription id="voice-rename-hint">
                    <Trans>只修改显示名称，不改变音色标识。</Trans>
                  </FieldDescription>
                </Field>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={endEditing}
                  >
                    <Trans comment="取消音色名称编辑">取消</Trans>
                  </Button>
                  <Button type="submit" size="sm">
                    <CheckIcon data-icon="inline-start" />
                    <Trans comment="保存本次预览中的音色名称">保存名称</Trans>
                  </Button>
                </div>
              </FieldGroup>
            </form>
          )}
          {renamed && (
            <p
              role="status"
              className="text-muted-foreground flex items-center gap-2 text-xs"
            >
              <CheckIcon className="size-3.5" />
              <Trans>已更新预览名称</Trans>
            </p>
          )}
          <p className="text-muted-foreground text-xs leading-5">
            <Trans>此处修改仅用于本次预览，刷新后恢复。</Trans>
          </p>
          <Separator />
          <section
            aria-label={t({
              comment: "音色详情中的原始声音样本区域",
              message: "试听样本",
            })}
          >
            <Empty className="bg-muted/40">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <AudioLinesIcon />
                </EmptyMedia>
                <EmptyTitle>
                  <Trans comment="声音卡片尚无可播放的音频样本">
                    暂无试听样本
                  </Trans>
                </EmptyTitle>
                <EmptyDescription>
                  <Trans>示例音色不含实际声音资源。</Trans>
                </EmptyDescription>
              </EmptyHeader>
              <Button variant="outline" size="sm" disabled>
                <PlayIcon data-icon="inline-start" />
                <Trans comment="声音详情中试听样本的操作">试听样本</Trans>
              </Button>
            </Empty>
          </section>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-4 text-sm">
            <dt className="text-muted-foreground">
              <Trans comment="音色资产的稳定标识，不随重命名变化">
                音色标识
              </Trans>
            </dt>
            <dd className="text-right font-mono text-xs leading-5 break-all">
              {voice.id}
            </dd>
            <dt className="text-muted-foreground">
              <Trans comment="声音资源的来源">来源</Trans>
            </dt>
            <dd className="text-right">
              <Trans comment="界面设计示例，不是真实音色库资源">界面示例</Trans>
            </dd>
          </dl>
          <p className="text-muted-foreground text-xs leading-6">
            {t(findPreviewModel(voice.modelId).name)} ·{" "}
            {isPreset ? (
              <Trans comment="模型或服务随附的声音，不是工程默认旁白">
                预置音色
              </Trans>
            ) : voice.source === "reference" ? (
              <Trans comment="从参考录音创建声音的模型能力">参考克隆</Trans>
            ) : (
              <Trans comment="从文字描述创建声音的模型能力">文字设计</Trans>
            )}
          </p>
          {isPreset && (
            <p className="text-muted-foreground text-xs leading-6">
              <Trans>
                此声音由模型提供，不作为自定义音色重命名、删除或导出。
              </Trans>
            </p>
          )}
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/models" search={{ model: voice.modelId }} />}
          >
            <Trans comment="查看所选模型的下载与运行状态">准备模型</Trans>
          </Button>
          <Separator />
          <VoiceUsage voiceId={voice.id} />
          {!isPreset && (
            <>
              <Button
                variant="outline"
                disabled={editing}
                onClick={() => setExportOpen(true)}
              >
                <DownloadIcon data-icon="inline-start" />
                <Trans comment="打开当前音色的打包导出说明">导出音色包</Trans>
              </Button>
              <div className="mt-auto flex flex-col gap-3 pt-6">
                <Separator />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-muted-foreground text-xs">
                    <Trans>从共享音色库中移除</Trans>
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={editing}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2Icon data-icon="inline-start" />
                    <Trans comment="打开删除当前音色的确认对话框">
                      删除音色
                    </Trans>
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              <Trans comment="当前音色导出对话框标题">导出音色包</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                将音色保存为 .voice 文件，便于备份或在其他设备导入。
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/40 flex min-w-0 items-center gap-3 rounded-lg p-4">
            <FileAudioIcon className="text-muted-foreground size-6 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium break-all">{filename}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                TaleChime · .voice
              </p>
            </div>
          </div>
          <p className="text-muted-foreground text-sm leading-6">
            <Trans>
              示例音色没有可导出的声音资源。接入音色库后，可导出真实音色。
            </Trans>
          </p>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>
              <Trans comment="关闭音色导出对话框">关闭</Trans>
            </DialogClose>
            <Button disabled>
              <DownloadIcon data-icon="inline-start" />
              <Trans comment="确认导出真实 .voice 文件，示例资源不可导出">
                导出音色包
              </Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-all">
              <Trans comment="删除确认标题，voice.name 是所选音色显示名">
                删除「{voice.name}」？
              </Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                当前为示例音色，确认后仅从本次预览中移除，不会修改小说工程或本地文件。
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>
              <Trans comment="取消删除音色，返回详情">取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDeleteOpen(false);
                onDelete();
              }}
            >
              <Trash2Icon data-icon="inline-start" />
              <Trans comment="确认将示例音色从本次预览中移除">确认删除</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
