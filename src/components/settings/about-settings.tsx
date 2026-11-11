import { Trans, useLingui } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, FileDownIcon } from "lucide-react";
import { useState } from "react";
import { commands, type DiagnosticsInventory } from "@/lib/bindings";
import logoUrl from "../../../assets/brand/logo.png";
import mascotUrl from "../../../assets/brand/mascot.png";
import appConfig from "../../../src-tauri/tauri.conf.json";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

const projectHomepage = "https://github.com/yexiyue/castglean";

export function AboutSettings() {
  const { t } = useLingui();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [inventory, setInventory] = useState<DiagnosticsInventory | null>(null);
  const [exportState, setExportState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "done"; path: string }
    | { kind: "failed" }
  >({ kind: "idle" });
  const links = [
    {
      id: "homepage",
      label: t({
        comment: "关于页面中的开源项目主页入口",
        message: "项目主页",
      }),
      text: "GitHub",
      href: projectHomepage,
      accessibleLabel: t({
        comment: "在外部浏览器打开项目主页",
        message: "打开 CastGlean 的 GitHub 项目主页",
      }),
    },
    {
      id: "feedback",
      label: t({ comment: "关于页面中报告问题的入口", message: "问题反馈" }),
      text: "GitHub Issues",
      href: `${projectHomepage}/issues`,
      accessibleLabel: t({
        comment: "在外部浏览器打开项目的问题列表与反馈入口",
        message: "打开 CastGlean 的问题反馈页面",
      }),
    },
  ];

  async function loadInventory() {
    setExportState({ kind: "busy" });
    try {
      setInventory(await commands.diagnosticsInventory());
      setExportState({ kind: "idle" });
    } catch {
      setInventory(null);
      setExportState({ kind: "failed" });
    }
  }

  async function exportDiagnostics() {
    if (!inventory) return;
    setExportState({ kind: "busy" });
    try {
      const target = await save({
        defaultPath: `castglean-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      if (!target) {
        setExportState({ kind: "idle" });
        return;
      }
      const result = await commands.diagnosticsExport(target);
      setExportState({ kind: "done", path: result.path });
    } catch {
      setExportState({ kind: "failed" });
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <img src={logoUrl} alt="" className="size-20 shrink-0 object-contain" />
        <div className="min-w-0 space-y-2">
          <h3 className="text-xl font-semibold">CastGlean · 拾角</h3>
          <p className="text-muted-foreground text-sm">
            <Trans>小说与有声内容制作工作台。</Trans>
          </p>
        </div>
      </div>
      <dl className="space-y-4 border-y py-4 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">
            <Trans comment="关于页面中的应用发布版本">版本</Trans>
          </dt>
          <dd className="tabular-nums">{appConfig.version}</dd>
        </div>
        {links.map((link) => (
          <div
            key={link.id}
            className="flex flex-wrap items-baseline justify-between gap-3"
          >
            <dt className="text-muted-foreground">{link.label}</dt>
            <dd>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.accessibleLabel}
                className="text-primary inline-flex items-center gap-1.5 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4"
                onClick={(event) => {
                  if (!isTauri()) return;
                  event.preventDefault();
                  setFailedUrl(null);
                  void openUrl(link.href).catch(() => setFailedUrl(link.href));
                }}
              >
                {link.text}
                <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
              </a>
            </dd>
          </div>
        ))}
      </dl>
      {failedUrl && (
        <p role="alert" className="text-destructive text-sm wrap-anywhere">
          <Trans>无法打开浏览器，请手动访问 {failedUrl}。</Trans>
        </p>
      )}
      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            {t({
              comment: "诊断导出说明：包含哪些内容、隐私边界",
              message:
                "导出最近日志与应用信息，用于问题排查；不包含小说正文与密钥。",
            })}
          </p>
          {inventory ? (
            <button
              type="button"
              className="text-primary inline-flex items-center gap-1.5 text-sm underline underline-offset-4 disabled:opacity-50"
              disabled={exportState.kind === "busy"}
              onClick={() => void exportDiagnostics()}
            >
              <FileDownIcon aria-hidden="true" className="size-3.5" />
              {t({ comment: "确认导出诊断包按钮", message: "选择位置并导出" })}
            </button>
          ) : (
            <button
              type="button"
              className="text-primary inline-flex items-center gap-1.5 text-sm underline underline-offset-4 disabled:opacity-50"
              disabled={!isTauri() || exportState.kind === "busy"}
              onClick={() => void loadInventory()}
            >
              <FileDownIcon aria-hidden="true" className="size-3.5" />
              {t({ comment: "导出诊断信息入口按钮", message: "导出诊断信息" })}
            </button>
          )}
        </div>
        {inventory && (
          <ul className="text-muted-foreground space-y-1 border-t pt-3 text-xs">
            {inventory.files.map((file) => (
              <li
                key={file.name}
                className="flex justify-between gap-4 tabular-nums"
              >
                <span className="wrap-anywhere">{file.name}</span>
                <span>{formatBytes(file.bytes)}</span>
              </li>
            ))}
            {inventory.summary.map((item) => (
              <li key={item} className="wrap-anywhere">
                {item}
              </li>
            ))}
          </ul>
        )}
        {exportState.kind === "done" && (
          <p className="text-sm wrap-anywhere">
            <Trans>已导出到 {exportState.path}。</Trans>
          </p>
        )}
        {exportState.kind === "failed" && (
          <p role="alert" className="text-destructive text-sm">
            {t({
              comment: "诊断导出失败提示",
              message: "导出失败，请重试或换一个保存位置。",
            })}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-5">
        <img
          src={mascotUrl}
          alt={t({
            comment: "关于页面的品牌吉祥物",
            message: "拾拾，CastGlean 的纸页猫头鹰吉祥物",
          })}
          className="size-28 shrink-0 object-contain"
        />
        <div className="min-w-0 flex-1 basis-40 space-y-2">
          <p className="text-sm font-medium">
            <Trans comment="品牌吉祥物的中英文名字">拾拾 · Shishi</Trans>
          </p>
          <p className="text-muted-foreground text-sm leading-6">
            <Trans>从原文拾取线索，让人物与台词有据可循。</Trans>
          </p>
        </div>
      </div>
    </section>
  );
}
