import { msg } from "@lingui/core/macro";

/** Capability profiles for UI design only; never a real backend/model catalog. */
export const modelCapabilities = {
  preset: msg({ comment: "模型可用的声音能力", message: "预置音色" }),
  clone: msg({ comment: "从参考录音创建声音的模型能力", message: "参考克隆" }),
  design: msg({ comment: "从文字描述创建声音的模型能力", message: "文字设计" }),
};
export type ModelCapability = keyof typeof modelCapabilities;
export const modelStates = {
  installed: msg({
    comment: "模型权重已安装但没有加载到设备",
    message: "已安装 · 未加载",
  }),
  missing: msg({ comment: "本地模型资源尚未下载", message: "未下载" }),
  paused: msg({ comment: "模型资源下载的示例状态", message: "下载已暂停" }),
  failed: msg({ comment: "下载后资源校验的示例失败状态", message: "校验失败" }),
  disconnected: msg({ comment: "远程模型服务尚未配置连接", message: "未连接" }),
};
export const previewModels = [
  {
    id: "preview-preset",
    name: msg({
      comment: "示例能力配置名称，不是真实模型产品",
      message: "预置朗读模型",
    }),
    description: msg({ message: "使用模型自带声音，适合直接开始章节朗读。" }),
    kind: "local",
    capabilities: ["preset"],
    state: "installed",
    size: "420 MB",
  },
  {
    id: "preview-reference",
    name: msg({
      comment: "示例能力配置名称，不是真实模型产品",
      message: "参考克隆模型",
    }),
    description: msg({ message: "从清晰的单人参考录音建立可复用音色。" }),
    kind: "local",
    capabilities: ["clone"],
    state: "missing",
    size: "1.5 GB",
  },
  {
    id: "preview-design",
    name: msg({
      comment: "示例能力配置名称，不是真实模型产品",
      message: "声音设计模型",
    }),
    description: msg({ message: "用文字描述设计声音，再生成试听比较。" }),
    kind: "local",
    capabilities: ["design"],
    state: "paused",
    size: "2.8 GB",
  },
  {
    id: "preview-compact",
    name: msg({
      comment: "示例能力配置名称，不是真实模型产品",
      message: "轻量参考模型",
    }),
    description: msg({ message: "展示资源校验失败后的检查与恢复入口。" }),
    kind: "local",
    capabilities: ["clone"],
    state: "failed",
    size: "860 MB",
  },
  {
    id: "preview-cloud",
    name: msg({
      comment: "远程服务示例，不代表已连接供应商",
      message: "云端语音服务",
    }),
    description: msg({
      message: "连接远程服务使用预置声音，无需下载本地权重。",
    }),
    kind: "cloud",
    capabilities: ["preset"],
    state: "disconnected",
    size: null,
  },
] as const;
export type PreviewModel = (typeof previewModels)[number];
export type PreviewModelId = PreviewModel["id"];
export function findPreviewModel(id: string | undefined) {
  return previewModels.find((model) => model.id === id) ?? previewModels[0];
}
export function supports(model: PreviewModel, capability: ModelCapability) {
  return (model.capabilities as readonly ModelCapability[]).includes(
    capability,
  );
}
