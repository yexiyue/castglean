import { Trans, useLingui } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import logoUrl from "../../../assets/brand/logo.png";
import mascotUrl from "../../../assets/brand/mascot.png";
import appConfig from "../../../src-tauri/tauri.conf.json";

const projectHomepage = "https://github.com/yexiyue/castglean";

export function AboutSettings() {
  const { t } = useLingui();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
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
