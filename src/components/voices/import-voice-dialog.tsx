import { zodResolver } from "@hookform/resolvers/zod";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AuxiliaryDialog } from "@/components/auxiliary-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  type VoiceImportDecision_Deserialize,
} from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";
import { voiceConflictMessages } from "@/lib/voice-messages";
import { importDraftSchema, importEntriesSchema } from "./import-validation";
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
  const [selection, setSelection] =
    useWorkspaceState<VoiceFileSelection | null>(
      "voices",
      "importSelection",
      null,
    );
  const [inspectionRequest, setInspectionRequest] = useWorkspaceState<{
    id: number;
    filenames: string[];
  } | null>("voices", "importInspection", null);
  const [submission, setSubmission] = useWorkspaceState<{
    preview: number;
    decisions: VoiceImportDecision_Deserialize[];
  } | null>("voices", "importSubmission", null);
  const [draft, setDraft] = useWorkspaceState<{
    included: number[];
    choices: Record<string, VoiceImportAction | "">;
    excluded: string[];
    descriptions: Record<string, string>;
  }>("voices", "importDraft", {
    included: [],
    choices: {},
    excluded: [],
    descriptions: {},
  });
  const form = useForm({
    defaultValues: draft,
    resolver: zodResolver(importDraftSchema),
  });
  const {
    included,
    choices,
    excluded: excludedKeys,
    descriptions,
  } = form.watch();
  const excluded = new Set(excludedKeys);
  function update<K extends keyof typeof draft>(
    key: K,
    value: (current: (typeof draft)[K]) => (typeof draft)[K],
  ) {
    const next = value(form.getValues(key));
    form.reset(
      { ...form.getValues(), [key]: next },
      { keepDefaultValues: true },
    );
    setDraft((current) => ({ ...current, [key]: next }));
  }
  const [attempted, setAttempted] = useState(false);
  const inspections = transfers.tasks.filter((task) => task.kind === "Inspect");
  const inspection = inspectionRequest
    ? inspections.find((task) => task.id === inspectionRequest.id)
    : !selection
      ? inspections[inspections.length - 1]
      : undefined;
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
  const validation = importEntriesSchema.safeParse(
    chosen.map((entry) => ({
      index: entry.index,
      originalId: entry.voice.id,
      action: actionFor(entry.index),
      description: descriptions[keyFor(entry.index)] ?? "",
      existingDescription: entry.voice.description ?? "",
    })),
  );
  const issues = validation.success ? [] : validation.error.issues;
  const duplicatedTargets = issues.some(
    (issue) => issue.message === "duplicate",
  );
  const missingDescription = chosen.filter((_, index) =>
    issues.some(
      (issue) => issue.message === "description" && issue.path[0] === index,
    ),
  );
  const unresolved = !validation.success;
  async function choose() {
    await transfers.run(async () => {
      const next = await commands.selectVoicePackages();
      if (!next) return;
      if (inspection && !activeVoiceTask(inspection))
        await transfers.dismiss(inspection.id);
      setInspectionRequest(null);
      if (selection) await commands.releaseVoiceSelection(selection.id);
      setSelection(next);
      const indices = next.files.map((file) => file.index);
      update("included", () => indices);
      const id = await commands.inspectVoicePackages(next.id, indices);
      setInspectionRequest({
        id,
        filenames: next.files.map((file) => file.name),
      });
    });
  }
  async function inspect() {
    if (!selection) return;
    await transfers.run(async () => {
      if (inspection && !activeVoiceTask(inspection))
        await transfers.dismiss(inspection.id);
      setInspectionRequest(null);
      const id = await commands.inspectVoicePackages(selection.id, included);
      setInspectionRequest({
        id,
        filenames: included.map(
          (index) =>
            selection.files.find((file) => file.index === index)?.name ?? "",
        ),
      });
    });
  }
  async function close(next: boolean) {
    if (!next && transfers.pending) return;
    onOpenChange(next);
  }
  async function discard() {
    await transfers.run(async () => {
      if (inspection) await transfers.dismiss(inspection.id);
      if (selection) await commands.releaseVoiceSelection(selection.id);
      setSelection(null);
      update("included", () => []);
      update("choices", () => ({}));
      update("excluded", () => []);
      update("descriptions", () => ({}));
      setAttempted(false);
      setInspectionRequest(null);
      onOpenChange(false);
    });
  }
  async function submitImport(request: NonNullable<typeof submission>) {
    setSubmission(request);
    await transfers.run(async () => {
      await commands.importVoiceEntries(request.preview, request.decisions);
      setSubmission(null);
      onOpenChange(false);
      if (selection) await commands.releaseVoiceSelection(selection.id);
      setSelection(null);
      update("included", () => []);
      update("choices", () => ({}));
      update("excluded", () => []);
      update("descriptions", () => ({}));
      setAttempted(false);
      setInspectionRequest(null);
    });
  }
  return (
    <Dialog open={open} onOpenChange={(next) => void close(next)}>
      <DialogContent scrollable="large">
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
              disabled={
                transfers.busy || !!selection || !!preview || !!submission
              }
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
                    htmlFor={`voice-file-${file.index}`}
                    className="flex min-w-0 items-center gap-2 py-1 text-sm"
                  >
                    <Checkbox
                      id={`voice-file-${file.index}`}
                      checked={included.includes(file.index)}
                      disabled={transfers.busy || !!preview || !!submission}
                      onCheckedChange={(checked) =>
                        update("included", (previous) =>
                          checked
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
                    disabled={
                      transfers.busy || !!submission || included.length === 0
                    }
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
                filenames={inspectionRequest?.filenames}
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
                      disabled={!!submission || transfers.busy}
                      onClick={() => update("excluded", () => [])}
                    >
                      <Trans comment="选择导入预览中的全部音色">全选</Trans>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!submission || transfers.busy}
                      onClick={() =>
                        update("excluded", () =>
                          entries.map((entry) => keyFor(entry.index)),
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
                  <p
                    id="voice-import-conflict"
                    tabIndex={-1}
                    role="alert"
                    className="text-destructive text-xs"
                  >
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
                      <label
                        htmlFor={`voice-entry-${entry.index}`}
                        className="flex items-start gap-3"
                      >
                        <Checkbox
                          id={`voice-entry-${entry.index}`}
                          className="mt-1"
                          checked={!excluded.has(keyFor(entry.index))}
                          disabled={!!submission}
                          onCheckedChange={(checked) =>
                            update("excluded", (previous) => {
                              const next = new Set(previous);
                              if (checked) next.delete(keyFor(entry.index));
                              else next.add(keyFor(entry.index));
                              return [...next];
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
                      {inspectionRequest &&
                        entry.sources.some(
                          (source) => inspectionRequest.filenames[source],
                        ) && (
                          <p className="text-muted-foreground mt-2 text-xs wrap-break-word">
                            <Trans>
                              来源文件：
                              {entry.sources
                                .map(
                                  (source) =>
                                    inspectionRequest.filenames[source],
                                )
                                .filter(Boolean)
                                .join("、")}
                            </Trans>
                          </p>
                        )}
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
                          id={`voice-action-${entry.index}`}
                          aria-label={t`处理方式：${entry.voice.name}`}
                          aria-invalid={
                            attempted &&
                            !excluded.has(keyFor(entry.index)) &&
                            !actionFor(entry.index)
                          }
                          aria-describedby={
                            attempted &&
                            !excluded.has(keyFor(entry.index)) &&
                            !actionFor(entry.index)
                              ? `voice-action-error-${entry.index}`
                              : undefined
                          }
                          value={actionFor(entry.index)}
                          disabled={
                            excluded.has(keyFor(entry.index)) ||
                            transfers.busy ||
                            !!submission
                          }
                          onChange={(event) =>
                            update("choices", (previous) => ({
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
                        {attempted &&
                          !excluded.has(keyFor(entry.index)) &&
                          !actionFor(entry.index) && (
                            <span
                              id={`voice-action-error-${entry.index}`}
                              role="alert"
                              className="text-destructive"
                            >
                              <Trans>请选择处理方式。</Trans>
                            </span>
                          )}
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
                              transfers.busy ||
                              !!submission
                            }
                            aria-required={true}
                            aria-label={t`声音描述：${entry.voice.name}`}
                            aria-invalid={
                              attempted && missingDescription.includes(entry)
                            }
                            aria-describedby={
                              attempted && missingDescription.includes(entry)
                                ? `voice-description-error-${entry.index}`
                                : undefined
                            }
                            onChange={(event) =>
                              update("descriptions", (previous) => ({
                                ...previous,
                                [keyFor(entry.index)]: event.target.value,
                              }))
                            }
                          />
                          {attempted && missingDescription.includes(entry) && (
                            <span
                              id={`voice-description-error-${entry.index}`}
                              role="alert"
                              className="text-destructive"
                            >
                              <Trans>请填写声音描述。</Trans>
                            </span>
                          )}
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
        {submission && (
          <p role="status" className="text-sm">
            <Trans>导入请求的结果尚未确认。可重试同一请求以恢复任务。</Trans>{" "}
            <Trans>停止恢复不会撤销可能已开始的任务，请先检查任务结果。</Trans>
          </p>
        )}
        <DialogFooter>
          {submission && (
            <Button
              variant="ghost"
              disabled={transfers.pending}
              onClick={() => setSubmission(null)}
            >
              <Trans>停止恢复原请求</Trans>
            </Button>
          )}
          {(selection || preview) && !submission && (
            <Button
              variant="ghost"
              disabled={transfers.busy}
              onClick={() => void discard()}
            >
              <Trans>放弃本次导入</Trans>
            </Button>
          )}
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
              (submission
                ? transfers.pending
                : !preview || transfers.busy || chosen.length === 0)
            }
            onClick={() => {
              if (submission) {
                void submitImport(submission);
                return;
              }
              void form.handleSubmit(() => {
                if (!preview) return;
                setAttempted(true);
                if (unresolved) {
                  const firstChoice = chosen.find(
                    (entry) => !actionFor(entry.index),
                  );
                  const firstMissing = missingDescription[0];
                  document
                    .getElementById(
                      firstChoice
                        ? `voice-action-${firstChoice.index}`
                        : firstMissing
                          ? `voice-description-${firstMissing.index}`
                          : "voice-import-conflict",
                    )
                    ?.focus();
                  return;
                }
                void submitImport({
                  preview: preview.id,
                  decisions: chosen.map((entry) => ({
                    entry: entry.index,
                    action: actionFor(entry.index) as VoiceImportAction,
                    description:
                      actionFor(entry.index) === "Skip" ||
                      (entry.voice.description ?? "").trim()
                        ? null
                        : (descriptions[keyFor(entry.index)] ?? "").trim() ||
                          null,
                  })),
                });
              })();
            }}
          >
            {submission ? (
              <Trans>重试原导入请求</Trans>
            ) : (
              <Trans comment="把勾选并解决冲突的音色写入真实库">
                导入所选音色
              </Trans>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
