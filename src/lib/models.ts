import { msg } from "@lingui/core/macro";
import prettyBytes from "pretty-bytes";

import type {
  EngineSettings,
  ModelEntry,
  PrepareOutcome,
  ResourceState,
} from "@/lib/bindings";

export type { EngineSettings, ModelEntry, PrepareOutcome, ResourceState };

/** 模型条目的稳定标识：`backend/model`。 */
export function modelId(entry: ModelEntry): string {
  return `${entry.backend}/${entry.model}`;
}

export function findModel(
  entries: readonly ModelEntry[],
  id: string | undefined | null,
): ModelEntry | undefined {
  if (!id) return undefined;
  return entries.find((entry) => modelId(entry) === id);
}

type ResourceVariant =
  | "Ready"
  | "Missing"
  | "Partial"
  | "Downloading"
  | "Failed";

/** externally-tagged enum 的变体判别（unit 变体是裸字符串）。 */
export function variantOf(state: ResourceState): ResourceVariant {
  if (typeof state === "string") return state;
  if ("Missing" in state) return "Missing";
  if ("Partial" in state) return "Partial";
  if ("Downloading" in state) return "Downloading";
  return "Failed";
}

/** 字节量的紧凑显示（pretty-bytes）；无效或零值显示占位符。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  return prettyBytes(bytes);
}

/** 该条目准备资源还需下载的字节量。 */
export function missingBytes(state: ResourceState): number {
  if (typeof state !== "string" && state.Missing) {
    return state.Missing.missing_bytes ?? 0;
  }
  if (typeof state !== "string" && state.Partial) {
    return state.Partial.missing_bytes ?? 0;
  }
  if (typeof state !== "string" && state.Failed) {
    return state.Failed.missing_bytes ?? 0;
  }
  return 0;
}

/** 下载进度（字节对 + 当前文件）；仅下载中有值。 */
export function downloadProgress(
  state: ResourceState,
): { downloaded: number; total: number; currentFile: string | null } | null {
  if (typeof state === "string" || !state.Downloading) {
    return null;
  }
  const payload = state.Downloading;
  return {
    downloaded: payload.downloaded_bytes ?? 0,
    total: payload.total_bytes ?? 0,
    currentFile: payload.current_file ?? null,
  };
}

export const resourceStateLabels = {
  ready: msg({ comment: "模型资源已全部就绪", message: "已就绪" }),
  missing: msg({ comment: "模型资源尚未下载", message: "未下载" }),
  partial: msg({ comment: "模型资源部分已就绪", message: "部分就绪" }),
  downloading: msg({ comment: "模型资源下载进行中", message: "下载中" }),
} as const;

export const failureLabels = {
  Network: msg({ comment: "网络传输失败", message: "网络失败" }),
  Auth: msg({ comment: "下载源凭据缺失或被拒绝", message: "鉴权失败" }),
  RateLimited: msg({ comment: "下载源限流", message: "被限流" }),
  NotFound: msg({ comment: "清单钉住的远端文件缺失", message: "远端缺失" }),
  Disk: msg({ comment: "模型资源无法写入磁盘", message: "磁盘写入失败" }),
  Cache: msg({ comment: "本地缓存异常", message: "缓存异常" }),
  Internal: msg({ comment: "引擎内部错误", message: "内部错误" }),
} as const;

export type FailureKind = keyof typeof failureLabels;

export function failureKind(state: ResourceState): FailureKind | null {
  return typeof state === "string" ? null : (state.Failed?.error ?? null);
}

export type StateStyle = "ok" | "idle" | "busy" | "error";

/** 状态的简短文案与样式类（列表徽标用）。 */
export function stateLabel(state: ResourceState): {
  kind: StateStyle;
  label: ReturnType<typeof msg>;
} {
  switch (variantOf(state)) {
    case "Ready":
      return { kind: "ok", label: resourceStateLabels.ready };
    case "Missing":
      return { kind: "idle", label: resourceStateLabels.missing };
    case "Partial":
      return { kind: "idle", label: resourceStateLabels.partial };
    case "Downloading":
      return { kind: "busy", label: resourceStateLabels.downloading };
    case "Failed": {
      const failure = failureKind(state);
      return {
        kind: "error",
        label: failure ? failureLabels[failure] : failureLabels.Internal,
      };
    }
  }
}

/** 下载进度百分比（0-100）；未知总量返回 null。 */
export function downloadPercent(state: ResourceState): number | null {
  const progress = downloadProgress(state);
  if (!progress?.total) return null;
  return Math.min(
    100,
    Math.round((progress.downloaded / progress.total) * 100),
  );
}

/** InsufficientSpace 结果的负载（其余结果是裸字符串）。 */
export function insufficientSpace(
  outcome: PrepareOutcome,
): { available: number; required: number } | null {
  if (typeof outcome !== "string" && "InsufficientSpace" in outcome) {
    const payload = outcome.InsufficientSpace;
    return {
      available: payload.available ?? 0,
      required: payload.required ?? 0,
    };
  }
  return null;
}
