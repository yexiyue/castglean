import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useModelResources } from "@/hooks/use-model-resources";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type { InferenceDevice, VoiceSelection } from "@/lib/bindings";
import { modelId } from "@/lib/models";

export function AuditionPanel({
  studio,
  voice,
  fixedModel,
}: {
  studio: VoiceStudio;
  voice: VoiceSelection;
  fixedModel?: string;
}) {
  const formId = useId();
  const { t } = useLingui();
  const { entries } = useModelResources();
  const models = entries.filter((m) =>
    fixedModel ? modelId(m) === fixedModel : m.capabilities.reference_cloning,
  );
  const [selected, setSelected] = useState("");
  const [device, setDevice] = useState<InferenceDevice | "">("");
  const [text, setText] = useState(
    t({ message: "你好，欢迎收听今天的故事。山风吹过松林，星光照亮归途。" }),
  );
  const [style, setStyle] = useState("");
  const model = models.find((m) => modelId(m) === selected) ?? models[0];
  const actualDevice =
    model?.available_devices.find((d) => d === device) ??
    model?.available_devices[0];
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">
        <Trans comment="用所选模型合成新文字，与原始参考区分">模型试听</Trans>
      </h3>
      <label className="flex flex-col gap-1 text-sm">
        <Trans comment="合成试听模型选项">模型</Trans>
        <select
          className="border-input bg-background rounded-md border p-2"
          value={model ? modelId(model) : ""}
          onChange={(e) => {
            setSelected(e.target.value);
            setDevice("");
          }}
        >
          <option value="" disabled>
            {t({ message: "请选择模型" })}
          </option>
          {models.map((m) => (
            <option key={modelId(m)} value={modelId(m)}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <Trans comment="试听推理使用的本机计算设备">计算设备</Trans>
        <select
          className="border-input bg-background rounded-md border p-2"
          value={actualDevice ?? ""}
          onChange={(e) => setDevice(e.target.value as InferenceDevice)}
        >
          {model?.available_devices.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label htmlFor={`${formId}-1`} className="flex flex-col gap-1 text-sm">
        <Trans comment="新合成试听的朗读文字">试听文本</Trans>
        <Textarea
          id={`${formId}-1`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {model?.capabilities.style && (
        <label htmlFor={`${formId}-2`} className="flex flex-col gap-1 text-sm">
          <Trans comment="当前试听模型支持的风格输入">风格指令</Trans>
          <Textarea
            id={`${formId}-2`}
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          />
        </label>
      )}
      <p className="text-muted-foreground text-xs">
        <Trans>参考录音是否兼容，以所选模型实际校验和生成结果为准。</Trans>
      </p>
      {model?.resource !== "Ready" && (
        <Button
          variant="outline"
          nativeButton={false}
          render={
            <Link
              to="/models"
              search={{ model: model ? modelId(model) : undefined }}
            />
          }
        >
          <Trans comment="前往模型中心准备试听权重">前往准备模型资源</Trans>
        </Button>
      )}
      <Button
        disabled={
          model?.resource !== "Ready" ||
          !actualDevice ||
          !text.trim() ||
          [...text].length > 500 ||
          studio.pending ||
          !studio.desktop
        }
        onClick={() => {
          if (model && actualDevice)
            void studio.start({
              kind: "audition",
              backend: model.backend,
              model: model.model,
              device: actualDevice,
              voice,
              text,
              style: model.capabilities.style && style.trim() ? style : null,
            });
        }}
      >
        <Trans comment="用当前声音和模型生成新试听">生成试听</Trans>
      </Button>
    </section>
  );
}
