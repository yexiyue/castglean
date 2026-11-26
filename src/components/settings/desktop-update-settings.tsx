import { Trans, useLingui } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { commands, type DesktopUpdateStatus, events } from "@/lib/bindings";

export function DesktopUpdateSettings() {
  const { t } = useLingui();
  const [status, setStatus] = useState<DesktopUpdateStatus>({
    status: "disabled",
  });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let updated = false;
    let unlisten: (() => void) | undefined;
    void events.desktopUpdateChanged
      .listen(({ payload }) => {
        updated = true;
        if (!disposed) setStatus(payload);
      })
      .then(async (stop) => {
        if (disposed) return stop();
        unlisten = stop;
        const snapshot = await commands.desktopUpdateStatus();
        if (!disposed && !updated) setStatus(snapshot);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (status.status === "disabled") return null;

  const offer = "offer" in status ? status.offer : null;
  const version = offer?.version;
  const busy =
    status.status === "checking" ||
    status.status === "downloading" ||
    status.status === "installing";
  const install =
    status.status === "ready" ||
    (status.status === "failed" &&
      offer &&
      ["install", "busy"].includes(status.problem));
  const download =
    status.status === "available" ||
    (status.status === "failed" &&
      offer &&
      ["download", "signature"].includes(status.problem));
  const problem = status.status === "failed" ? status.problem : null;
  const message =
    problem === "busy"
      ? t`请等待制作任务结束，再安装更新。`
      : problem === "signature"
        ? t`更新文件的签名校验失败。`
        : problem === "download"
          ? t`未能下载更新，请重试。`
          : problem === "install"
            ? t`未能安装更新，请重试。`
            : problem === "check" || failed
              ? t`无法完成更新操作，请重试。`
              : null;

  async function run(action: () => Promise<unknown>) {
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    }
  }

  return (
    <section className="space-y-3 border-b pb-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          {version && (
            <p>
              <Trans>可用版本 {version}</Trans>
            </p>
          )}
          <p role="status" className="text-muted-foreground">
            {status.status === "current" && <Trans>已是最新版本。</Trans>}
            {status.status === "checking" && <Trans>正在检查应用更新…</Trans>}
            {status.status === "installing" && <Trans>正在安装更新…</Trans>}
            {status.status === "ready" && (
              <Trans>更新已下载，可以稍后安装。</Trans>
            )}
            {status.status === "downloading" && <Trans>正在下载更新…</Trans>}
          </p>
        </div>
        {install ? (
          <Button
            size="sm"
            onClick={() => void run(commands.desktopUpdateRequestInstall)}
          >
            <Trans>安装并重启</Trans>
          </Button>
        ) : download ? (
          <Button
            size="sm"
            onClick={() => void run(commands.desktopUpdateDownload)}
          >
            <Trans>下载更新</Trans>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(commands.desktopUpdateCheck)}
          >
            <Trans>检查更新</Trans>
          </Button>
        )}
      </div>
      {status.status === "downloading" && (
        <progress
          aria-label={t({
            comment: "下载桌面应用更新包的进度",
            message: "更新下载进度",
          })}
          className="block w-full"
          value={status.total ? status.received : undefined}
          max={status.total ?? undefined}
        />
      )}
      {message && (
        <p role="alert" className="text-destructive">
          {message}
        </p>
      )}
      {offer && (
        <>
          {offer.notes && <p className="whitespace-pre-line">{offer.notes}</p>}
          <Button
            size="sm"
            variant="link"
            onClick={() => void run(() => openUrl(offer.release_url))}
          >
            <Trans comment="在外部浏览器打开该应用版本的 GitHub 发行说明">
              版本详情
            </Trans>
          </Button>
        </>
      )}
    </section>
  );
}
