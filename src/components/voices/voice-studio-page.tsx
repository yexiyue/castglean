import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { useId } from "react";
import { AuxiliaryDialog } from "@/components/auxiliary-dialog";
import { BrowserPreviewGuide } from "@/components/browser-preview-guide";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import { commands, type InferenceDevice } from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";
import { DesignResources } from "./design-resources";
import { StudioJobs } from "./studio-jobs";
import { VoiceCandidate } from "./voice-candidate";

export function VoiceStudioPage() {
  const { t } = useLingui();
  const formId = useId();
  const studio = useVoiceStudio();
  const [draft, setDraft] = useWorkspaceState(
    "voice-studio",
    "creation-draft",
    {
      method: "design",
      name: "",
      description: "",
      transcript: "",
      text: "你好，欢迎收听今天的故事。山风吹过松林，星光照亮归途。",
      engine: "",
      device: "" as InferenceDevice | "",
      seed: "",
    },
  );
  const engine =
    studio.engines.find((e) => e.id === draft.engine) ??
    studio.engines.find((e) => e.devices.length > 0) ??
    studio.engines[0];
  const device =
    engine?.devices.find((d) => d === draft.device) ?? engine?.devices[0];
  const update = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) => setDraft((old) => ({ ...old, [key]: value }));
  const validSeed =
    !draft.seed ||
    (/^\d+$/.test(draft.seed) && Number(draft.seed) <= 0xffffffff);
  const validDesign =
    !!engine &&
    !!device &&
    engine.ready &&
    draft.name.trim() &&
    draft.description.trim() &&
    new TextEncoder().encode(draft.description).length <=
      engine.description_max_bytes &&
    (!engine.description_max_chars ||
      [...draft.description].length <= engine.description_max_chars) &&
    (!engine.forbid_parentheses || !/[()（）]/.test(draft.description)) &&
    draft.text.trim() &&
    [...draft.text].length <= Math.min(500, engine.text_max_chars) &&
    validSeed;
  return (
    <PageShell
      active="voices"
      title={t({ comment: "独立音色制作页标题", message: "创建音色" })}
      navigation={
        <div className="flex items-center gap-3">
          <Link
            to="/voices"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-item inline-flex items-center gap-1.5 text-sm outline-none focus-visible:ring-2"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            <Trans>音色中心</Trans>
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span className="text-sm font-medium">
            <Trans>创建音色</Trans>
          </span>
        </div>
      }
      description={t({
        message: "从声音描述或参考录音开始，试听满意后再加入音色库。",
      })}
    >
      {!studio.desktop ? (
        <div className="mx-auto w-full max-w-6xl px-6 py-12 pb-32">
          <BrowserPreviewGuide
            summary={
              <Trans>
                音色创建需要读取参考录音、加载本机模型并保存结果，请在桌面应用中使用。
              </Trans>
            }
          />
        </div>
      ) : (
        <div className="mx-auto grid max-w-6xl gap-5 p-5 pb-28 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col gap-4">
            <Tabs
              value={draft.method}
              onValueChange={(value) => update("method", String(value))}
            >
              <TabsList
                variant="line"
                aria-label={t({
                  message: "创建方式",
                  comment: "选择文字描述或已有录音创建音色",
                })}
              >
                <TabsTrigger value="design">
                  <Trans comment="从描述生成参考音色的方法">文字设计</Trans>
                </TabsTrigger>
                <TabsTrigger value="recording">
                  <Trans comment="从本地录音创建音色的方法">参考录音</Trans>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="grid gap-3 sm:grid-cols-2">
              {" "}
              <label
                htmlFor={`${formId}-1`}
                className="flex flex-col gap-1 text-sm"
              >
                <Trans comment="正式入库时显示的音色名称">音色名称</Trans>
                <Input
                  id={`${formId}-1`}
                  value={draft.name}
                  onChange={(e) => update("name", e.target.value)}
                />
              </label>
              {draft.method === "design" && (
                <label className="flex flex-col gap-1 text-sm">
                  <Trans comment="独立音色生成器选择">设计引擎</Trans>
                  <NativeSelect
                    value={engine?.id ?? ""}
                    onChange={(e) => {
                      update("engine", e.target.value);
                      update("device", "");
                    }}
                  >
                    {studio.engines.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              )}
            </div>
            {draft.method === "design" ? (
              <>
                <label
                  htmlFor={`${formId}-2`}
                  className="flex flex-col gap-1 text-sm"
                >
                  <Trans comment="描述想设计的声音特征">声音描述</Trans>
                  <Textarea
                    id={`${formId}-2`}
                    value={draft.description}
                    onChange={(e) => update("description", e.target.value)}
                  />
                </label>
                <label
                  htmlFor={`${formId}-3`}
                  className="flex flex-col gap-1 text-sm"
                >
                  <Trans comment="设计结果实际朗读的文字">朗读文本</Trans>
                  <Textarea
                    id={`${formId}-3`}
                    value={draft.text}
                    onChange={(e) => update("text", e.target.value)}
                  />
                  {engine && (
                    <span className="text-muted-foreground text-xs">
                      <Trans>
                        最多 {Math.min(engine.text_max_chars, 500)}{" "}
                        个字符，描述最多 {engine.description_max_bytes} 字节。
                      </Trans>
                    </span>
                  )}
                </label>
                <AuxiliaryDialog
                  title={
                    <>
                      {" "}
                      <Trans comment="音色制作中较少调整的设备与随机种子">
                        高级选项
                      </Trans>{" "}
                    </>
                  }
                >
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      <Trans comment="音色设计推理的计算设备">计算设备</Trans>
                      <NativeSelect
                        value={device ?? ""}
                        onChange={(e) =>
                          update("device", e.target.value as InferenceDevice)
                        }
                      >
                        {engine?.devices.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </NativeSelect>
                    </label>
                    <label
                      htmlFor={`${formId}-4`}
                      className="flex flex-col gap-1 text-sm"
                    >
                      <Trans comment="可选的音色生成随机种子">
                        随机种子（可选）
                      </Trans>
                      <Input
                        id={`${formId}-4`}
                        value={draft.seed}
                        inputMode="numeric"
                        onChange={(e) => update("seed", e.target.value)}
                        aria-invalid={!validSeed}
                      />
                    </label>
                  </div>
                  {!validSeed && (
                    <p role="alert" className="text-destructive mt-2 text-sm">
                      <Trans>随机种子请输入 0 到 4294967295 之间的整数。</Trans>
                    </p>
                  )}
                </AuxiliaryDialog>
                {!validSeed && (
                  <p role="alert" className="text-destructive mt-2 text-sm">
                    <Trans>随机种子请输入 0 到 4294967295 之间的整数。</Trans>
                  </p>
                )}
                <Button
                  disabled={!studio.desktop || studio.pending || !validDesign}
                  onClick={() => {
                    if (engine && device)
                      void studio.start({
                        kind: "design",
                        engine: engine.id,
                        device,
                        name: draft.name,
                        description: draft.description,
                        text: draft.text,
                        seed: draft.seed ? Number(draft.seed) : null,
                      });
                  }}
                >
                  <Trans comment="生成待确认候选，不直接入库">
                    生成音色候选
                  </Trans>
                </Button>
                {!engine?.ready && (
                  <DesignResources studio={studio} query={engine?.name ?? ""} />
                )}
              </>
            ) : (
              <>
                <label
                  htmlFor={`${formId}-5`}
                  className="flex flex-col gap-1 text-sm"
                >
                  <Trans comment="与参考 WAV 完全对应的人工准确转写">
                    准确转写
                  </Trans>
                  <Textarea
                    id={`${formId}-5`}
                    value={draft.transcript}
                    onChange={(e) => update("transcript", e.target.value)}
                  />
                </label>
                <p className="text-muted-foreground text-sm">
                  <Trans>
                    选择 25 MiB 以内的非空 WAV。试听和保存参考录音无需下载模型。
                  </Trans>
                </p>
                <Button
                  disabled={
                    !studio.desktop ||
                    studio.pending ||
                    !draft.name.trim() ||
                    !draft.transcript.trim()
                  }
                  onClick={() =>
                    void studio.run(() =>
                      commands.selectVoiceReference(
                        draft.name,
                        draft.transcript,
                      ),
                    )
                  }
                >
                  <Trans comment="打开系统选择器建立录音候选">
                    选择参考 WAV
                  </Trans>
                </Button>
              </>
            )}
          </section>
          <section className="bg-muted/25 border-border flex min-w-0 flex-col gap-4 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
            <h2 className="font-medium">
              <Trans comment="尚未正式保存的声音">音色候选</Trans>
            </h2>
            {!studio.candidates.length && (
              <p className="text-muted-foreground text-sm">
                <Trans>
                  候选会保留在当前应用会话中，确认保存后才能加入音色库。
                </Trans>
              </p>
            )}
            {studio.candidates.map((candidate) => (
              <VoiceCandidate
                key={candidate.id}
                candidate={candidate}
                studio={studio}
              />
            ))}
            <StudioJobs studio={studio} />
          </section>
        </div>
      )}
    </PageShell>
  );
}
