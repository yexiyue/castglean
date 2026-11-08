import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { AudioWaveformIcon, CpuIcon, HardDriveIcon } from "lucide-react";
import { Property, PropertyGroup } from "@/components/detail-properties";
import type { InferenceDevice, ModelEntry } from "@/lib/bindings";
import { formatBytes, missingBytes, stateLabel, variantOf } from "@/lib/models";

const deviceNames: Record<InferenceDevice, string> = {
  Cpu: "CPU",
  Metal: "Metal",
  Cuda: "CUDA",
};

export function ModelProperties({ entry }: { entry: ModelEntry }) {
  const { t } = useLingui();
  const state = variantOf(entry.resource);
  const pendingResource =
    typeof entry.resource === "string"
      ? null
      : (entry.resource.Missing ??
        entry.resource.Partial ??
        entry.resource.Failed);
  const transfer =
    typeof entry.resource === "string"
      ? null
      : (entry.resource.Downloading ?? entry.resource.Paused);
  const remaining =
    pendingResource?.missing_bytes === null ||
    transfer?.total_bytes === null ||
    (transfer !== null && transfer?.downloaded_bytes === null)
      ? null
      : missingBytes(entry.resource);
  const supported = (value: boolean) =>
    value ? (
      <span className="text-success font-medium">
        {t({ comment: "模型具备此声音能力", message: "支持" })}
      </span>
    ) : (
      <span className="text-muted-foreground">
        {t({ comment: "模型不具备此声音能力", message: "不支持" })}
      </span>
    );
  return (
    <div className="flex flex-col gap-4 py-1" data-slot="model-properties">
      <PropertyGroup
        title={<Trans comment="模型属性中的资源分组">资源</Trans>}
        icon={HardDriveIcon}
      >
        <Property label={<Trans comment="模型资源准备状态">资源状态</Trans>}>
          <span
            className={
              state === "Ready"
                ? "text-success font-medium"
                : state === "Failed"
                  ? "text-destructive font-medium"
                  : state === "Downloading" || state === "Preparing"
                    ? "text-info font-medium"
                    : undefined
            }
          >
            {t(stateLabel(entry.resource).label)}
          </span>
        </Property>
        {!["Ready", "Preparing"].includes(state) && (
          <Property
            label={<Trans comment="尚需准备的模型资源大小">待准备资源</Trans>}
          >
            {state === "Paused" &&
            typeof entry.resource !== "string" &&
            entry.resource.Interrupted
              ? "—"
              : formatBytes(remaining)}
          </Property>
        )}
        <Property
          secondary
          label={<Trans comment="模型在本机还是远端运行">运行方式</Trans>}
        >
          <Trans comment="模型运行于本机设备">本机运行</Trans>
        </Property>
      </PropertyGroup>
      <PropertyGroup
        title={<Trans comment="模型计算后端与可用设备分组">运行设备</Trans>}
        icon={CpuIcon}
      >
        <Property
          secondary
          label={<Trans comment="语音模型所属后端">引擎</Trans>}
        >
          {entry.backend}
        </Property>
        <Property
          secondary
          label={<Trans comment="后端中的具体模型变体">模型版本</Trans>}
        >
          {entry.model || "—"}
        </Property>
        <Property
          secondary
          label={<Trans comment="此应用构建支持的计算设备">构建支持</Trans>}
        >
          {entry.compiled_devices
            .map((device) => deviceNames[device])
            .join(" / ") || "—"}
        </Property>
        <Property
          label={
            <Trans comment="当前机器能用于此模型的计算设备">本机可用</Trans>
          }
        >
          {entry.available_devices
            .map((device) => deviceNames[device])
            .join(" / ") ||
            t({ comment: "没有可用的模型计算设备", message: "无可用设备" })}
        </Property>
      </PropertyGroup>
      <PropertyGroup
        title={<Trans comment="模型的声音功能分组">声音能力</Trans>}
        icon={AudioWaveformIcon}
      >
        <Property label={<Trans comment="是否提供预置声音">预置音色</Trans>}>
          {supported(entry.capabilities.preset)}
        </Property>
        {entry.capabilities.preset && (
          <Property
            label={<Trans comment="可用预置声音的数量">音色数量</Trans>}
          >
            <Plural
              value={entry.voices}
              other="# 个"
              comment="模型目录中的预置音色数量"
            />
          </Property>
        )}
        <Property
          label={<Trans comment="是否支持参考录音克隆声音">参考克隆</Trans>}
        >
          {supported(entry.capabilities.reference_cloning)}
        </Property>
        <Property
          label={<Trans comment="是否支持声音风格指令">风格指令</Trans>}
        >
          {supported(entry.capabilities.style)}
        </Property>
      </PropertyGroup>
    </div>
  );
}
