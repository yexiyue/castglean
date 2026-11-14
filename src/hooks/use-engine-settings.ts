import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { commands } from "@/lib/bindings";
import type { EngineSettingsView } from "@/lib/bindings";

/** 把宿主返回的错误转成可展示的文本。 */
export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (
    cause !== null &&
    typeof cause === "object" &&
    "Invalid" in cause &&
    typeof cause.Invalid === "string"
  ) {
    return cause.Invalid;
  }
  return String(cause);
}

export type EngineSettingsState = {
  /** 宿主保存的引擎设置；读取完成前为 null。 */
  settings: EngineSettingsView | null;
  /** 读取失败的原因；宿主不可用时说明原因，不假装有默认值。 */
  error: string | null;
  setSettings: (next: EngineSettingsView) => void;
};

/**
 * 读取宿主保存的引擎设置：模型缓存目录、下载源端点与访问凭据。
 * 读取一次即缓存，后续保存走同一条写入路径。
 */
export function useEngineSettings(): EngineSettingsState {
  const [settings, setSettings] = useState<EngineSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void commands
      .getEngineSettings()
      .then((current) => {
        if (!active) return;
        setSettings(current);
        setError(null);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  return { settings, error, setSettings };
}
