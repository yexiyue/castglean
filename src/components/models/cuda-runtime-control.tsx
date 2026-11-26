import { Trans, useLingui } from "@lingui/react/macro";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { type CudaStatus, commands } from "@/lib/bindings";
import { formatBytes } from "@/lib/models";

export function CudaRuntimeControl() {
  const { t } = useLingui();
  const [status, setStatus] = useState<CudaStatus>();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const next = await commands.cudaRuntimeStatus();
        if (!disposed) setStatus(next);
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  async function enable(enabled: boolean) {
    setWorking(true);
    setFailed(false);
    try {
      await commands.cudaRuntimeEnable(enabled);
    } catch {
      setFailed(true);
    } finally {
      setWorking(false);
    }
  }

  if (!status || status.kind === "unsupported") return null;
  const total = "total" in status ? formatBytes(status.total) : null;
  const enabled = status.kind === "ready" && status.enabled;
  const busy =
    working || status.kind === "checking" || status.kind === "downloading";
  return (
    <section className="space-y-2 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">
            <Trans comment="模型中心的可选 NVIDIA 章节生成加速设置">
              NVIDIA CUDA 加速
            </Trans>
          </h2>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {status.kind === "checking" ? (
              <Trans>正在检查 NVIDIA 显卡和运行库…</Trans>
            ) : status.kind === "driver_unavailable" ? (
              <Trans>需要受支持的 NVIDIA 显卡和兼容驱动。</Trans>
            ) : status.kind === "needs_download" ? (
              <Trans comment="total 是从 NVIDIA 下载的运行库压缩包总大小">
                为 Kokoro 章节生成启用 CUDA，需先下载 {total}。
              </Trans>
            ) : status.kind === "downloading" ? (
              <Trans>正在准备 CUDA 运行库…</Trans>
            ) : status.kind === "failed" || failed ? (
              <Trans>CUDA 准备失败，可重试或切回 CPU。</Trans>
            ) : enabled ? (
              <Trans>新的 Kokoro 章节生成任务将使用 CUDA。</Trans>
            ) : (
              <Trans>CUDA 运行库已就绪，章节生成当前使用 CPU。</Trans>
            )}
          </p>
        </div>
        {status.kind === "driver_unavailable" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void openUrl("https://www.nvidia.com/Download/index.aspx").catch(
                () => setFailed(true),
              )
            }
          >
            <Trans comment="打开 NVIDIA 官网的显卡驱动下载页">下载驱动</Trans>
          </Button>
        )}
        {status.kind !== "checking" && status.kind !== "driver_unavailable" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void enable(!enabled)}
          >
            {enabled ? (
              <Trans comment="停止用 CUDA 生成新章节，改用 CPU">
                切换到 CPU
              </Trans>
            ) : (
              <Trans comment="确认并启用 CUDA，可触发首次下载运行库">
                启用 CUDA
              </Trans>
            )}
          </Button>
        )}
        {(status.kind === "driver_unavailable" || status.kind === "failed") && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void enable(false)}
          >
            <Trans comment="清除 CUDA 选择，让新的章节生成任务用 CPU">
              使用 CPU
            </Trans>
          </Button>
        )}
      </div>
      {status.kind === "downloading" && (
        <Progress
          value={status.received}
          max={status.total}
          aria-label={t({
            comment: "模型中心可访问性名称，下载 CUDA 运行库时的进度条",
            message: "CUDA 下载进度",
          })}
        />
      )}
    </section>
  );
}
