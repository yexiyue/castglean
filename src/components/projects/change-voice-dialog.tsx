import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  InfoIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { FieldSet, FieldLegend, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { useModelResources } from "@/hooks/use-model-resources";
import { findModel, modelId } from "@/lib/models";
import { sampleVoices, sampleVoiceNames } from "@/lib/sample-voice-bindings";
import type { SampleVoiceBinding } from "@/lib/sample-voice-bindings";

export function ChangeVoiceDialog({
  binding,
  names,
  removed,
  onClose,
  onConfirm,
}: {
  binding: SampleVoiceBinding;
  names: Record<string, string>;
  removed: string[];
  onClose: () => void;
  onConfirm: (voiceId: string) => boolean;
}) {
  const { t } = useLingui();
  const [step, setStep] = useState<"choose" | "review">("choose");
  const [nextId, setNextId] = useState("");
  const [error, setError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  const reviewed = useRef(false);
  const role =
    binding.kind === "character"
      ? binding.characterName
      : t({ comment: "朗读职能，不是小说人物身份", message: "旁白" });
  const voiceName = (id: string) => names[id] ?? sampleVoiceNames[id] ?? id;
  const { entries } = useModelResources();
  const projectModel =
    sampleVoices.find((voice) => voice.id === binding.voiceId)?.modelId ??
    (entries[0] ? modelId(entries[0]) : "");
  const candidates = sampleVoices.filter(
    (voice) =>
      voice.id !== binding.voiceId &&
      !removed.includes(voice.id) &&
      voice.modelId === projectModel,
  );
  const nextVoice = candidates.find((voice) => voice.id === nextId);
  useEffect(() => {
    if (step === "review") {
      reviewed.current = true;
      heading.current?.focus();
    } else if (reviewed.current) {
      choices.current
        ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
        ?.focus();
    }
  }, [step]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100svh-3rem)] flex-col gap-0 p-0 sm:max-w-xl"
      >
        <DialogHeader className="shrink-0 gap-3 p-6 pb-4">
          <div className="flex items-center justify-between gap-3">
            <Badge variant="outline">
              <Trans comment="只改变当前会话的示例声音绑定">交互预览</Trans>
            </Badge>
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t({
                    comment: "取消本次声音绑定更换并关闭对话框",
                    message: "取消更换",
                  })}
                />
              }
            >
              <XIcon />
            </DialogClose>
          </div>
          <DialogTitle ref={heading} tabIndex={-1} className="outline-none">
            <Trans comment="role 为所选小说角色或旁白职能的名称">
              为「{role}」更换音色
            </Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans comment="声音绑定更换只属于示例小说工程">
              夜航灯 · 仅当前工程
            </Trans>
          </DialogDescription>
          <ol
            aria-label={t({
              comment: "音色更换对话框的两步进度",
              message: "更换音色步骤",
            })}
            className="text-muted-foreground flex items-center gap-3 pt-1 text-xs"
          >
            <li
              aria-current={step === "choose" ? "step" : undefined}
              className="aria-[current=step]:text-foreground flex items-center gap-1.5"
            >
              {step === "review" ? (
                <CheckIcon className="size-3.5" />
              ) : (
                <span aria-hidden="true">1</span>
              )}
              <span>
                <Trans comment="更换声音的第一步">选择音色</Trans>
              </span>
            </li>
            <ArrowRightIcon className="size-3" />
            <li
              aria-current={step === "review" ? "step" : undefined}
              className="aria-[current=step]:text-foreground flex items-center gap-1.5"
            >
              <span aria-hidden="true">2</span>
              <span>
                <Trans comment="更换声音的第二步，查看范围与保留策略">
                  确认影响
                </Trans>
              </span>
            </li>
          </ol>
        </DialogHeader>
        <Separator />
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-6">
          {step === "choose" ? (
            <>
              <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  <Trans comment="更换前的角色声音绑定">当前音色</Trans>
                </span>
                <span className="min-w-0 truncate font-medium">
                  {voiceName(binding.voiceId)}
                  {removed.includes(binding.voiceId) && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      <Trans comment="当前绑定的声音在会话预览中被移除">
                        已移除
                      </Trans>
                    </span>
                  )}
                </span>
              </div>
              <p className="text-muted-foreground text-xs leading-5">
                <Trans comment="modelName 为示例工程当前合成模型名，只列出兼容音色">
                  仅显示与本工程模型「{findModel(entries, projectModel)?.name ?? projectModel}
                  」兼容的音色。
                </Trans>
              </p>
              {candidates.length ? (
                <FieldSet className="gap-3">
                  <FieldLegend className="mb-0" variant="label">
                    <Trans comment="选择用于替换当前绑定的声音">
                      选择新音色
                    </Trans>
                  </FieldLegend>
                  <RadioGroup
                    ref={choices}
                    value={nextId}
                    onValueChange={(value) => setNextId(String(value))}
                    aria-label={t({
                      comment: "可用于此次预览更换的声音选择列表",
                      message: "选择新音色",
                    })}
                    className="gap-2"
                  >
                    {candidates.map((voice) => (
                      <FieldLabel
                        key={voice.id}
                        htmlFor={`replacement-${voice.id}`}
                        className="border-border flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3"
                      >
                        <RadioGroupItem
                          id={`replacement-${voice.id}`}
                          value={voice.id}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {voiceName(voice.id)}
                          </p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {t(voice.tone)}
                          </p>
                        </div>
                        <Badge variant="outline">
                          <Trans comment="选择列表中的设计示例声音">
                            示例音色
                          </Trans>
                        </Badge>
                      </FieldLabel>
                    ))}
                  </RadioGroup>
                </FieldSet>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>
                      <Trans>没有可替换的音色</Trans>
                    </EmptyTitle>
                    <EmptyDescription>
                      <Trans>请先在音色库恢复或添加其他音色。</Trans>
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              <p className="text-muted-foreground text-xs leading-5">
                <Trans>这里只选择新音色，下一步再确认更换范围。</Trans>
              </p>
            </>
          ) : (
            <>
              <div className="bg-muted/40 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-lg p-4">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">
                    <Trans comment="确认更换前的原声音">原音色</Trans>
                  </p>
                  <p className="mt-1 text-sm font-medium wrap-break-word">
                    {voiceName(binding.voiceId)}
                  </p>
                </div>
                <ArrowRightIcon className="text-muted-foreground size-4" />
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">
                    <Trans comment="确认后用于该角色的声音">新音色</Trans>
                  </p>
                  <p className="mt-1 text-sm font-medium wrap-break-word">
                    {voiceName(nextId)}
                  </p>
                </div>
              </div>
              <section
                aria-labelledby="voice-change-scope"
                className="flex flex-col gap-3"
              >
                <h3 id="voice-change-scope" className="text-sm font-medium">
                  <Trans comment="更换绑定影响哪些文本的范围说明">
                    应用范围
                  </Trans>
                </h3>
                <p className="text-sm leading-6">
                  {binding.kind === "character" ? (
                    <Trans comment="role 是稳定人物身份的显示名，更换作用于工程内全部已归属台词">
                      本工程中「{role}」已归属的全部台词。
                    </Trans>
                  ) : (
                    <Trans>本工程中使用此旁白绑定的全部片段。</Trans>
                  )}
                </p>
                <p className="text-muted-foreground text-xs leading-5">
                  <Trans>其他角色的声音、人物身份和原文归属保持不变。</Trans>
                </p>
                <div className="border-border flex flex-wrap justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs">
                  <span className="text-muted-foreground">
                    <Trans comment="需要由宿主计算的影响规模">
                      受影响章节与片段数量
                    </Trans>
                  </span>
                  <span>
                    <Trans comment="真实绑定依赖索引尚未接入，不能给出伪造数量">
                      待宿主计算
                    </Trans>
                  </span>
                </div>
              </section>
              <section
                aria-labelledby="voice-change-audio"
                className="flex flex-col gap-3"
              >
                <h3 id="voice-change-audio" className="text-sm font-medium">
                  <Trans comment="已有音频在切换角色音色后如何保留">
                    已有音频如何处理
                  </Trans>
                </h3>
                <ul className="text-muted-foreground flex list-disc flex-col gap-2 pl-4 text-sm leading-6">
                  <li>
                    <Trans>保留旧音频和当前采用结果，不删除、不覆盖。</Trans>
                  </li>
                  <li>
                    <Trans>
                      新音色用于后续生成；相关旧音频需提示与新配置不一致。
                    </Trans>
                  </li>
                  <li>
                    <Trans>
                      本次只更换绑定，不自动生成，也不自动采用新候选。
                    </Trans>
                  </li>
                </ul>
              </section>
              <p className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                <Trans>
                  当前仅更新会话中的示例绑定，不保存工程，也不创建生成任务。
                </Trans>
              </p>
              {(error || !nextVoice) && (
                <p role="alert" className="text-destructive text-xs">
                  <Trans>音色或绑定已变化，请返回重新选择。</Trans>
                </p>
              )}
            </>
          )}
        </div>
        <Separator />
        <DialogFooter className="m-0 shrink-0 rounded-b-xl border-0 px-6 py-4">
          {step === "choose" ? (
            <>
              <DialogClose render={<Button variant="ghost" />}>
                <Trans comment="取消此次声音绑定更换">取消</Trans>
              </DialogClose>
              <Button
                disabled={!nextVoice}
                onClick={() => {
                  setError(false);
                  setStep("review");
                }}
              >
                <Trans comment="进入更换声音的影响确认步骤">
                  下一步：确认影响
                </Trans>
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setStep("choose");
                  setError(false);
                }}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                <Trans comment="回到新音色选择并保留已选项">返回选择</Trans>
              </Button>
              <Button
                disabled={!nextVoice}
                onClick={() => {
                  if (!nextVoice || !onConfirm(nextId)) setError(true);
                }}
              >
                <CheckIcon data-icon="inline-start" />
                <Trans comment="只确认当前会话中的示例声音绑定更换">
                  确认更换（预览）
                </Trans>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
