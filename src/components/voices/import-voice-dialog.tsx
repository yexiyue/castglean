import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { AuxiliaryDialog } from "@/components/auxiliary-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  activeVoiceTask,
  type VoiceTransfers,
} from "@/hooks/use-voice-transfers";
import {
  commands,
  type VoiceFileSelection,
  type VoiceImportAction,
} from "@/lib/bindings";
import { voiceConflictMessages } from "@/lib/voice-messages";
import {
  VoiceTransferFailure,
  VoiceTransferFeedback,
} from "./voice-transfer-feedback";

export function ImportVoiceDialog({
  open,
  onOpenChange,
  transfers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transfers: VoiceTransfers;
}) {
  const { t } = useLingui();
  const [selection, setSelection] = useState<VoiceFileSelection | null>(null);
  const [included, setIncluded] = useState<number[]>([]);
  const [choices, setChoices] = useState<
    Record<string, VoiceImportAction | "">
  >({});
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const inspections = transfers.tasks.filter((task) => task.kind === "Inspect");
  const inspection = inspections[inspections.length - 1];
  const preview = inspection?.preview;
  const keyFor = (index: number) => `${preview?.id}:${index}`;
  const entries = preview?.entries ?? [];
  const chosen = entries.filter((entry) => !excluded.has(keyFor(entry.index)));
  const entryByIndex = new Map(entries.map((entry) => [entry.index, entry]));
  function actionFor(index: number): VoiceImportAction | "" {
    const choice = choices[keyFor(index)];
    if (choice !== undefined) return choice;
    const entry = entryByIndex.get(index);
    if (
      entry?.conflicts.includes("IdentityConflict") ||
      (entry?.conflicts.includes("MetadataDifference") && !entry.existing_id)
    )
      return "";
    return "Import";
  }
  const originalIds = chosen
    .filter((entry) => actionFor(entry.index) === "Import")
    .map((entry) => entry.voice.id);
  const duplicatedTargets = new Set(originalIds).size !== originalIds.length;
  // 入库要求描述：包内无描述且选择导入的条目必须补填，否则不提交。
  const missingDescription = chosen.filter(
    (entry) =>
      (actionFor(entry.index) === "Import" ||
        actionFor(entry.index) === "ImportAsNew") &&
      !(entry.voice.description ?? "").trim() &&
      !(descriptions[keyFor(entry.index)] ?? "").trim(),
  );
  const unresolved =
    duplicatedTargets ||
    chosen.some((entry) => !actionFor(entry.index)) ||
    missingDescription.length > 0;
  async function choose() {
    await transfers.run(async () => {
      const next = await commands.selectVoicePackages();
      if (!next) return;
      if (inspection && !activeVoiceTask(inspection))
        await transfers.dismiss(inspection.id);
      if (selection) await commands.releaseVoiceSelection(selection.id);
      setSelection(next);
      const indices = next.files.map((file) => file.index);
      setIncluded(indices);
      await commands.inspectVoicePackages(next.id, indices);
    });
  }
  async function inspect() {
    if (!selection) return;
    await transfers.run(async () => {
      if (inspection && !activeVoiceTask(inspection))
        await transfers.dismiss(inspection.id);
      await commands.inspectVoicePackages(selection.id, included);
    });
  }
  async function close(next: boolean) {
    if (!next && transfers.pending) return;
    if (next) {
      onOpenChange(true);
      return;
    }
    onOpenChange(false);
    if (inspection && activeVoiceTask(inspection))
      await transfers.cancel(inspection.id);
    await transfers.run(async () => {
      if (inspection && !activeVoiceTask(inspection))
        await transfers.dismiss(inspection.id);
      if (selection) await commands.releaseVoiceSelection(selection.id);
      setSelection(null);
      setIncluded([]);
    });
  }
  return (
    <Dialog open={open} onOpenChange={(next) => void close(next)}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <Trans comment="批量导入音色资产的对话框标题">导入音色包</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              一次选择多个 .voice 文件，检查后选择要导入的音色。无需下载模型。
            </Trans>
          </DialogDescription>
        </DialogHeader>
        {!transfers.desktop ? (
          <p className="text-muted-foreground text-sm">
            <Trans>
              请在桌面应用中导入音色，浏览器预览不会写入本机音色库。
            </Trans>
          </p>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={transfers.busy}
              onClick={() => void choose()}
            >
              <Trans comment="系统文件选择器支持选择多个音色包">
                选择音色包
              </Trans>
            </Button>
            {selection && (
              <fieldset className="border-border rounded-surface border p-3">
                <legend className="px-1 text-xs">
                  <Trans comment="本次检查包括哪些已选包文件">待检查文件</Trans>
                </legend>
                {selection.files.map((file) => (
                  <label
                    key={file.index}
                    className="flex min-w-0 items-center gap-2 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={included.includes(file.index)}
                      disabled={transfers.busy || !!preview}
                      onChange={(event) =>
                        setIncluded((previous) =>
                          event.target.checked
                            ? [...previous, file.index]
                            : previous.filter((i) => i !== file.index),
                        )
                      }
                    />
                    <span className="truncate">{file.name}</span>
                  </label>
                ))}
                {!preview && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={transfers.busy || included.length === 0}
                    onClick={() => void inspect()}
                  >
                    <Trans comment="排除问题文件后重新校验剩余音色包">
                      重新检查所选文件
                    </Trans>
                  </Button>
                )}
              </fieldset>
            )}
            {inspection && !preview && (
              <VoiceTransferFeedback
                task={inspection}
                busy={transfers.pending}
                onCancel={() => void transfers.cancel(inspection.id)}
                onPreview={() => void choose()}
              />
            )}
            {preview && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <p>
                    <Plural value={chosen.length} other="已选择 # 个音色" />
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExcluded(new Set())}
                    >
                      <Trans comment="选择导入预览中的全部音色">全选</Trans>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExcluded(
                          new Set(entries.map((entry) => keyFor(entry.index))),
                        )
                      }
                    >
                      <Trans comment="取消导入预览中的全部音色选择">
                        取消全选
                      </Trans>
                    </Button>
                  </div>
                </div>
                {duplicatedTargets && (
                  <p role="alert" className="text-destructive text-xs">
                    <Trans>
                      同一身份只能保留一项，其余请选择跳过或作为新音色导入。
                    </Trans>
                  </p>
                )}
                <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
                  {entries.map((entry) => (
                    <div
                      key={entry.index}
                      className="border-border rounded-surface border p-3"
                    >
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={!excluded.has(keyFor(entry.index))}
                          onChange={(event) =>
                            setExcluded((previous) => {
                              const next = new Set(previous);
                              if (event.target.checked)
                                next.delete(keyFor(entry.index));
                              else next.add(keyFor(entry.index));
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium wrap-break-word">
                            {entry.voice.name}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {(entry.voice.duration ?? 0).toFixed(1)} s ·{" "}
                            {((entry.voice.bytes ?? 0) / 1024).toFixed(1)} KiB ·{" "}
                            {entry.voice.source ??
                              t({
                                comment: "音色来自用户参考录音",
                                message: "参考录音",
                              })}
                          </span>
                        </span>
                      </label>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {[...new Set(entry.conflicts)].map((conflict) => (
                          <Badge variant="outline" key={conflict}>
                            {t(voiceConflictMessages[conflict])}
                          </Badge>
                        ))}
                      </div>
                      {entry.existing_id && (
                        <p className="text-muted-foreground mt-2 text-xs">
                          <Trans comment="冲突预览中已存在的本地音色名称">
                            本地音色：
                            {entry.existing_voice?.name ?? entry.existing_id}
                          </Trans>
                        </p>
                      )}
                      <AuxiliaryDialog
                        title={
                          <>
                            {" "}
                            <Trans comment="展开导入资产与已有资产的参考文本">
                              查看参考信息
                            </Trans>{" "}
                          </>
                        }
                      >
                        <p className="mt-2 whitespace-pre-wrap">
                          <Trans comment="音色包中录音的参考文本">
                            包内参考文本：{entry.voice.transcript}
                          </Trans>
                        </p>
                        {entry.existing_voice && (
                          <p className="mt-2 whitespace-pre-wrap">
                            <Trans comment="已在本地保存音色的参考文本">
                              本地参考文本：{entry.existing_voice.transcript}
                            </Trans>
                          </p>
                        )}
                      </AuxiliaryDialog>
                      <label className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <Trans comment="选择此音色的导入冲突策略">
                          处理方式
                        </Trans>
                        <NativeSelect
                          value={actionFor(entry.index)}
                          disabled={
                            excluded.has(keyFor(entry.index)) || transfers.busy
                          }
                          onChange={(event) =>
                            setChoices((previous) => ({
                              ...previous,
                              [keyFor(entry.index)]: event.target.value as
                                | VoiceImportAction
                                | "",
                            }))
                          }
                        >
                          <option value="">
                            <Trans comment="同 ID 不同声音时必须作出明确选择">
                              请选择处理方式
                            </Trans>
                          </option>
                          {!entry.conflicts.includes("IdentityConflict") && (
                            <option value="Import">
                              <Trans comment="新增音色或保留已经存在的本地信息">
                                导入，保留已有信息
                              </Trans>
                            </option>
                          )}
                          {(!entry.existing_id ||
                            entry.conflicts.includes("IdentityConflict")) && (
                            <option value="ImportAsNew">
                              <Trans comment="分配新身份导入，不覆盖旧音色">
                                作为新音色导入
                              </Trans>
                            </option>
                          )}
                          <option value="Skip">
                            <Trans comment="跳过此项音色">跳过</Trans>
                          </option>
                        </NativeSelect>
                      </label>
                      {actionFor(entry.index) !== "Skip" &&
                      !(entry.voice.description ?? "").trim() ? (
                        <label
                          htmlFor={`voice-description-${entry.index}`}
                          className="mt-2 flex flex-wrap items-center gap-2 text-xs"
                        >
                          <Trans comment="入库必填的声音描述输入">
                            声音描述（必填）
                          </Trans>
                          <Input
                            id={`voice-description-${entry.index}`}
                            className="h-7 max-w-64"
                            value={descriptions[keyFor(entry.index)] ?? ""}
                            disabled={
                              excluded.has(keyFor(entry.index)) ||
                              transfers.busy
                            }
                            aria-required={true}
                            onChange={(event) =>
                              setDescriptions((previous) => ({
                                ...previous,
                                [keyFor(entry.index)]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      ) : null}
                    </div>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  <Trans>
                    不会覆盖已有声音。导入中途取消时，已完成的音色会保留。
                  </Trans>
                </p>
              </>
            )}
          </>
        )}
        {transfers.error && <VoiceTransferFailure error={transfers.error} />}
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={transfers.pending}
            onClick={() => void close(false)}
          >
            <Trans comment="关闭音色导入预览">关闭</Trans>
          </Button>
          <Button
            disabled={
              !transfers.desktop ||
              !preview ||
              transfers.busy ||
              chosen.length === 0 ||
              unresolved
            }
            onClick={() => {
              if (!preview) return;
              void transfers.run(async () => {
                await commands.importVoiceEntries(
                  preview.id,
                  chosen.map((entry) => ({
                    entry: entry.index,
                    action: actionFor(entry.index) as VoiceImportAction,
                    description:
                      actionFor(entry.index) === "Skip" ||
                      (entry.voice.description ?? "").trim()
                        ? null
                        : (descriptions[keyFor(entry.index)] ?? "").trim() ||
                          null,
                  })),
                );
                onOpenChange(false);
                if (selection) {
                  await commands.releaseVoiceSelection(selection.id);
                  setSelection(null);
                }
              });
            }}
          >
            <Trans comment="把勾选并解决冲突的音色写入真实库">
              导入所选音色
            </Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
