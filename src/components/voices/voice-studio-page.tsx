import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  AudioLinesIcon,
  ChevronDownIcon,
  CpuIcon,
  FileAudioIcon,
  InfoIcon,
  MicIcon,
  PlusIcon,
  SaveIcon,
  SparklesIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceState } from "@/lib/desktop-session";
import { useTheme } from "@/hooks/use-theme";
import { ModelSelect } from "@/components/models/model-select";
import { useModelResources } from "@/hooks/use-model-resources";
import { findModel, modelId as toId, stateLabel } from "@/lib/models";
import { AppState } from "@/components/app-state";

interface VoiceDraft {
  method: string;
  name: string;
  description: string;
  text: string | null;
  transcript: string;
  seed: string;
  recording: File | null;
}
const initialDraft: VoiceDraft = {
  method: "design",
  name: "",
  description: "",
  text: null,
  transcript: "",
  seed: "",
  recording: null,
};

export function VoiceStudioPage() {
  const { t } = useLingui();
  const { theme } = useTheme();
  const { model: modelId } = useSearch({ from: "/voices/new" });
  const navigate = useNavigate({ from: "/voices/new" });
  const { entries } = useModelResources();
  const model =
    findModel(entries, modelId) ??
    entries.find((entry) => entry.capabilities.reference_cloning) ??
    entries[0];
  const canCreate =
    !!model && (model.capabilities.reference_cloning || model.capabilities.text_design);
  const [draft, setDraft] = useWorkspaceState<VoiceDraft>(
    "voice-studio",
    "draft",
    initialDraft,
  );
  const [fileError, setFileError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const design =
    !!model &&
    model.capabilities.text_design &&
    (draft.method === "design" || !model.capabilities.reference_cloning);
  const defaultText = t({
    comment: "音色设计时默认朗读的试听文字",
    message: "你好，欢迎收听今天的故事。山风吹过松林，星光照亮归途。",
  });
  const presets = [
    {
      label: t({
        comment: "填入温和叙事音色描述的示例按钮",
        message: "温和旁白",
      }),
      text: t({
        message:
          "温和、自然的叙事声音，音色干净，语速舒缓，像在安静地讲述一段往事。",
      }),
    },
    {
      label: t({
        comment: "填入清亮女声音色描述的示例按钮",
        message: "清亮女声",
      }),
      text: t({
        message: "清亮柔和的成年女声，吐字清晰，声音轻盈，表达自然不过分夸张。",
      }),
    },
    {
      label: t({
        comment: "填入低沉男声音色描述的示例按钮",
        message: "低沉男声",
      }),
      text: t({
        message:
          "低沉温暖的成年男声，略带沙哑，语气沉稳，适合悬疑故事中的旁白。",
      }),
    },
  ];
  useEffect(() => {
    setDuration(null);
    setPlaybackFailed(false);
    if (!draft.recording) {
      setAudioUrl("");
      return;
    }
    const url = URL.createObjectURL(draft.recording);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.recording]);
  function update<K extends keyof VoiceDraft>(key: K, value: VoiceDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function choose(file?: File) {
    if (!file) return;
    if (
      !file.name.toLowerCase().endsWith(".wav") ||
      !file.size ||
      file.size > 25 * 1024 * 1024
    ) {
      setFileError(t({ message: "请选择 25 MB 以内的非空 WAV 录音。" }));
      return;
    }
    let header: string;
    try {
      header = new TextDecoder().decode(await file.slice(0, 12).arrayBuffer());
    } catch {
      setFileError(t({ message: "无法读取录音文件，请重新选择。" }));
      return;
    }
    if (!header.startsWith("RIFF") || header.slice(8, 12) !== "WAVE") {
      setFileError(t({ message: "无法识别这段 WAV 录音，请重新选择。" }));
      return;
    }
    setFileError("");
    update("recording", file);
  }
  const seedInvalid =
    !!draft.seed &&
    (!/^\d+$/.test(draft.seed) || Number(draft.seed) > Number.MAX_SAFE_INTEGER);
  return (
    <PageShell
      active="voices"
      title={t({ comment: "独立音色创建页面标题", message: "创建音色" })}
      description={t({
        message: "从声音描述或参考录音开始，试听满意后再加入音色库。",
      })}
      actions={
        <Button
          variant="ghost"
          nativeButton={false}
          render={<Link to="/voices" />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          <Trans comment="返回应用级声音资源列表，保留当前会话草稿">
            返回音色库
          </Trans>
        </Button>
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-6">
        <p className="text-muted-foreground text-sm">
          <Trans>从声音描述或参考录音开始，试听满意后再加入音色库。</Trans>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <FieldLabel htmlFor="voice-creation-model">
            <Trans comment="仅决定本次音色创建的能力，不修改工程模型">
              创建所用模型
            </Trans>
          </FieldLabel>
          <ModelSelect
            id="voice-creation-model"
            value={model ? toId(model) : ""}
            onChange={(next) => void navigate({ search: { model: next } })}
          />
          <Badge variant="outline">{model ? t(stateLabel(model.resource).label) : ""}</Badge>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/models" search={{ model: model ? toId(model) : undefined }} />}
          >
            <Trans comment="查看所选模型的下载与运行状态">准备模型</Trans>
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          <Trans>
            模型能力为界面示例，尚未连接真实服务。切换模型不会清除输入草稿。
          </Trans>
        </p>
        {!canCreate ? (
          <AppState
            kind="unavailable"
            title={<Trans>此模型仅支持预置音色</Trans>}
            description={
              <Trans>
                无需创建或克隆，直接浏览模型自带的声音。也可以切换到支持创建音色的模型。
              </Trans>
            }
            actions={
              <Button
                nativeButton={false}
                render={
                  <Link
                    to="/voices"
                    search={{ model: model ? toId(model) : undefined, library: "preset" }}
                  />
                }
              >
                <Trans comment="查看该模型随附的声音">浏览预置音色</Trans>
              </Button>
            }
          />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section
              className="min-w-0"
              aria-label={t({
                comment: "音色创建的输入条件区",
                message: "声音设定",
              })}
            >
              <Tabs
                value={design ? "design" : "reference"}
                onValueChange={(value) => update("method", String(value))}
                className="gap-5"
              >
                <TabsList className="w-fit">
                  <TabsTrigger
                    value="design"
                    disabled={!model?.capabilities.text_design}
                  >
                    <SparklesIcon />
                    <Trans comment="通过文字描述设计新的音色">文字设计</Trans>
                  </TabsTrigger>
                  <TabsTrigger
                    value="reference"
                    disabled={!model?.capabilities.reference_cloning}
                  >
                    <MicIcon />
                    <Trans comment="用已有录音和准确转写创建参考音色">
                      参考录音
                    </Trans>
                  </TabsTrigger>
                </TabsList>
                <p className="text-muted-foreground text-xs leading-5">
                  {model?.capabilities.text_design ? (
                    <Trans>此示例模型支持文字设计，不支持参考录音克隆。</Trans>
                  ) : (
                    <Trans>此示例模型支持参考克隆，不支持文字设计。</Trans>
                  )}
                </p>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {design ? (
                        <Trans>描述你想要的声音</Trans>
                      ) : (
                        <Trans>从一段参考录音开始</Trans>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {design ? (
                        <Trans>
                          描述音色、年龄感、质感和表达方式，越具体越容易接近预期。
                        </Trans>
                      ) : (
                        <Trans>
                          选择清晰的单人录音，并填写其中准确的文字。
                        </Trans>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-5">
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="voice-name">
                          <Trans comment="音色资产在共享库中的显示名称">
                            音色名称
                          </Trans>
                        </FieldLabel>
                        <Input
                          id="voice-name"
                          maxLength={80}
                          placeholder={t({
                            comment: "自定义音色名称输入提示",
                            message: "例如：夜航 · 温柔旁白",
                          })}
                          value={draft.name}
                          onChange={(e) => update("name", e.target.value)}
                        />
                        <FieldDescription>
                          <Trans>用于音色库展示，可在保存时调整。</Trans>
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                    <TabsContent value="design" className="mt-0">
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="voice-description">
                            <Trans comment="描述要生成的声音特征，不是朗读内容">
                              声音描述
                            </Trans>
                          </FieldLabel>
                          <Textarea
                            id="voice-description"
                            maxLength={1200}
                            rows={5}
                            className="resize-y"
                            placeholder={t({
                              message:
                                "例如：温和沉静的成年女声，略带气声，吐字清晰，适合夜间故事旁白。",
                            })}
                            value={draft.description}
                            onChange={(e) =>
                              update("description", e.target.value)
                            }
                          />
                          <FieldDescription>
                            <Trans>这是声音的特点，不是需要朗读的台词。</Trans>
                          </FieldDescription>
                        </Field>
                        <div className="flex flex-wrap gap-2">
                          {presets.map((preset) => (
                            <Button
                              key={preset.label}
                              variant="outline"
                              size="xs"
                              onClick={() => update("description", preset.text)}
                            >
                              <PlusIcon data-icon="inline-start" />
                              {preset.label}
                            </Button>
                          ))}
                        </div>
                        <Field>
                          <FieldLabel htmlFor="voice-trial-text">
                            <Trans comment="生成参考声音时朗读的具体文本">
                              试听文案
                            </Trans>
                          </FieldLabel>
                          <Textarea
                            id="voice-trial-text"
                            maxLength={1000}
                            rows={3}
                            value={draft.text ?? defaultText}
                            onChange={(e) => update("text", e.target.value)}
                          />
                          <FieldDescription>
                            <Trans>固定文案更方便比较多次生成的声音。</Trans>
                          </FieldDescription>
                        </Field>
                      </FieldGroup>
                    </TabsContent>
                    <TabsContent value="reference" className="mt-0">
                      <FieldGroup>
                        <Field data-invalid={!!fileError}>
                          <FieldLabel htmlFor="voice-reference-file">
                            <Trans comment="上传用于创建音色的原始参考音频">
                              参考录音
                            </Trans>
                          </FieldLabel>
                          <input
                            ref={input}
                            id="voice-reference-file"
                            type="file"
                            accept=".wav,audio/wav"
                            className="hidden"
                            aria-label={t({
                              comment: "选择参考录音的文件输入框",
                              message: "参考录音文件",
                            })}
                            aria-invalid={!!fileError}
                            onChange={(e) => {
                              void choose(e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                          <fieldset
                            aria-label={t({ message: "参考录音文件" })}
                            className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-5 py-6 text-center"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              void choose(e.dataTransfer.files[0]);
                            }}
                          >
                            {draft.recording ? (
                              <>
                                <FileAudioIcon className="text-primary size-6" />
                                <p className="max-w-full truncate text-sm font-medium">
                                  {draft.recording.name}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                  {(draft.recording.size / 1024).toFixed(1)} KB
                                  {duration !== null &&
                                    ` · ${duration.toFixed(1)} s`}
                                </p>
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => input.current?.click()}
                                  >
                                    <Trans comment="更换音色创建的参考录音">
                                      更换录音
                                    </Trans>
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      update("recording", null);
                                      setFileError("");
                                    }}
                                  >
                                    <XIcon data-icon="inline-start" />
                                    <Trans comment="移除当前参考录音文件">
                                      移除
                                    </Trans>
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <>
                                <UploadIcon className="text-muted-foreground size-6" />
                                <p className="text-sm">
                                  <Trans>拖入录音，或点击选择</Trans>
                                </p>
                                <p className="text-muted-foreground text-xs">
                                  <Trans>WAV · 25 MB 以内 · 仅在本机读取</Trans>
                                </p>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => input.current?.click()}
                                >
                                  <Trans comment="选择参考 WAV 文件">
                                    选择录音
                                  </Trans>
                                </Button>
                              </>
                            )}
                          </fieldset>
                          {fileError && <FieldError>{fileError}</FieldError>}
                          <FieldDescription>
                            <Trans>
                              建议使用无音乐、无其他人声的清晰录音。
                            </Trans>
                          </FieldDescription>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="voice-transcript">
                            <Trans comment="必须与参考录音实际说话内容一致的文字">
                              录音原文
                            </Trans>
                          </FieldLabel>
                          <Textarea
                            id="voice-transcript"
                            maxLength={4000}
                            rows={4}
                            placeholder={t({
                              message:
                                "逐字填写录音中说出的内容，不要填写声音描述。",
                            })}
                            value={draft.transcript}
                            onChange={(e) =>
                              update("transcript", e.target.value)
                            }
                          />
                          <FieldDescription>
                            <Trans>
                              准确转写有助于模型建立声音与文字的对应。
                            </Trans>
                          </FieldDescription>
                        </Field>
                      </FieldGroup>
                    </TabsContent>
                    {design && (
                      <details className="border-border group border-t pt-4">
                        <summary className="text-muted-foreground flex cursor-pointer list-none items-center justify-between text-xs">
                          <Trans comment="展开音色生成的可选控制项">
                            高级设置
                          </Trans>
                          <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
                        </summary>
                        <FieldGroup className="mt-4">
                          <Field data-invalid={seedInvalid}>
                            <FieldLabel htmlFor="voice-seed">
                              <Trans comment="可选的生成随机数种子">
                                随机种子（选填）
                              </Trans>
                            </FieldLabel>
                            <Input
                              id="voice-seed"
                              inputMode="numeric"
                              placeholder={t({
                                comment: "不填写随机种子时的提示",
                                message: "留空使用随机结果",
                              })}
                              value={draft.seed}
                              onChange={(e) => update("seed", e.target.value)}
                              aria-invalid={seedInvalid}
                            />
                            {seedInvalid && (
                              <FieldError>
                                <Trans>请输入有效的非负整数。</Trans>
                              </FieldError>
                            )}
                            <FieldDescription>
                              <Trans>固定种子有助于复现一次生成设置。</Trans>
                            </FieldDescription>
                          </Field>
                        </FieldGroup>
                      </details>
                    )}
                  </CardContent>
                  <CardFooter className="flex-col items-stretch gap-3">
                    <div className="flex items-center gap-2">
                      <CpuIcon className="text-muted-foreground size-4" />
                      <span className="text-muted-foreground flex-1 text-xs">
                        {model?.name ?? ""}
                      </span>
                      <Badge variant="outline">
                        {model ? t(stateLabel(model.resource).label) : ""}
                      </Badge>
                    </div>
                    <Button disabled className="w-full">
                      <SparklesIcon data-icon="inline-start" />
                      {design ? (
                        <Trans comment="根据声音描述生成一段参考声音">
                          生成试听
                        </Trans>
                      ) : (
                        <Trans comment="从参考录音创建可复用音色">
                          创建参考音色
                        </Trans>
                      )}
                    </Button>
                    <p className="text-muted-foreground text-xs leading-5">
                      <Trans>
                        模型可运行后，才能创建试听。当前仅预览输入与流程。
                      </Trans>{" "}
                      <Link
                        to="/models"
                        search={{ model: model ? toId(model) : undefined }}
                        className="text-primary hover:underline"
                      >
                        <Trans comment="查看所选模型的下载与运行状态">
                          准备模型
                        </Trans>
                      </Link>
                    </p>
                  </CardFooter>
                </Card>
              </Tabs>
            </section>
            <aside data-slot="voice-preview" className="lg:sticky lg:top-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>
                      <Trans comment="音色创建页右侧的试听和保存区域标题">
                        试听与保存
                      </Trans>
                    </CardTitle>
                    <Badge variant="outline">
                      <Trans comment="尚未产生任何真实的设计音频">
                        尚未生成
                      </Trans>
                    </Badge>
                  </div>
                  <CardDescription>
                    <Trans>听过再决定，让满意的声音进入音色库。</Trans>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  {!design && audioUrl ? (
                    playbackFailed ? (
                      <AppState
                        kind="error"
                        compact
                        title={<Trans>无法播放这段录音</Trans>}
                        description={
                          <Trans>
                            请检查 WAV 编码，或更换一段可播放的录音。
                          </Trans>
                        }
                        actions={
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => input.current?.click()}
                            >
                              <Trans comment="更换音色创建的参考录音">
                                更换录音
                              </Trans>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                update("recording", null);
                                setFileError("");
                              }}
                            >
                              <Trans comment="移除当前参考录音文件">移除</Trans>
                            </Button>
                          </>
                        }
                      />
                    ) : (
                      <div className="bg-muted/40 flex flex-col gap-3 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-xs font-medium">
                          <FileAudioIcon className="text-primary size-4" />
                          <Trans comment="播放用户提供的原始录音，不是生成结果">
                            原始录音预览
                          </Trans>
                        </div>
                        <audio
                          aria-label={t({ message: "原始录音预览" })}
                          key={audioUrl}
                          src={audioUrl}
                          controls
                          preload="metadata"
                          className="w-full"
                          style={{ colorScheme: theme }}
                          onLoadedMetadata={(e) => {
                            const seconds = e.currentTarget.duration;
                            setDuration(
                              Number.isFinite(seconds) ? seconds : null,
                            );
                          }}
                          onError={() => setPlaybackFailed(true)}
                        >
                          <track kind="captions" />
                        </audio>
                        <p className="text-muted-foreground text-xs leading-5">
                          <Trans>
                            这是你选择的原始录音，尚未创建新的音色。
                          </Trans>
                        </p>
                      </div>
                    )
                  ) : (
                    <Empty className="bg-muted/40 min-h-52">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <AudioLinesIcon />
                        </EmptyMedia>
                        <EmptyTitle>
                          <Trans>等待第一段声音</Trans>
                        </EmptyTitle>
                        <EmptyDescription>
                          <Trans>
                            完成左侧设定后生成试听，在这里比较并选择喜欢的结果。
                          </Trans>
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                  <div className="flex flex-col gap-2">
                    <span className="text-muted-foreground text-xs">
                      <Trans comment="准备保存时使用的音色显示名称">
                        保存名称
                      </Trans>
                    </span>
                    <span className="truncate text-sm font-medium">
                      {draft.name.trim() ||
                        t({
                          comment: "用户尚未给音色起名时的占位",
                          message: "未命名音色",
                        })}
                    </span>
                  </div>
                  <Separator />
                  <ol className="text-muted-foreground flex flex-col gap-3 text-xs">
                    <li className="flex items-center gap-2">
                      <span className="bg-secondary flex size-5 items-center justify-center rounded-full">
                        1
                      </span>
                      <Trans comment="创建流程第一步">生成并试听</Trans>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="bg-secondary flex size-5 items-center justify-center rounded-full">
                        2
                      </span>
                      <Trans comment="创建流程第二步">比较并选择</Trans>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="bg-secondary flex size-5 items-center justify-center rounded-full">
                        3
                      </span>
                      <Trans comment="创建流程最后一步">保存到共享音色库</Trans>
                    </li>
                  </ol>
                </CardContent>
                <CardFooter className="flex-col items-stretch gap-3">
                  <Button variant="outline" disabled>
                    <SaveIcon data-icon="inline-start" />
                    <Trans comment="将选中的生成结果正式加入音色库">
                      保存到音色库
                    </Trans>
                  </Button>
                  <p className="text-muted-foreground text-center text-xs">
                    <Trans>没有生成结果时不会创建音色记录。</Trans>
                  </p>
                </CardFooter>
              </Card>
              <p className="text-muted-foreground mt-4 flex items-start gap-2 px-1 text-xs leading-6">
                <InfoIcon className="mt-1 size-3.5 shrink-0" />
                <span>
                  <Trans>
                    音色可在不同工程中复用，角色绑定在小说工程内完成。
                  </Trans>
                </span>
              </p>
            </aside>
          </div>
        )}
      </div>
    </PageShell>
  );
}
