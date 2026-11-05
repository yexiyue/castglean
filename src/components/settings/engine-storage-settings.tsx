import { Trans, useLingui } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import { OpenModelCacheButton } from "@/components/models/open-model-cache-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage, useEngineSettings } from "@/hooks/use-engine-settings";
import { commands } from "@/lib/bindings";
import type { EngineSettings } from "@/lib/models";

type SaveFeedback = "idle" | "saving" | "saved" | { error: string };

/**
 * 引擎存储与下载源设置：模型缓存目录（默认共享 HF 缓存）、镜像端点与
 * 访问凭据。保存后对后续下载生效；凭据只保存在本地应用配置目录。
 */
export function EngineStorageSettings() {
  const { t } = useLingui();
  const { settings, error: loadError, setSettings } = useEngineSettings();
  const [draft, setDraft] = useState<Partial<EngineSettings>>({});
  const current = settings ? { ...settings, ...draft } : null;
  const endpoint = current?.download_endpoint ?? "";
  const token = current?.download_token ?? "";
  const [feedback, setFeedback] = useState<SaveFeedback>("idle");
  const saving = feedback === "saving";
  const error = typeof feedback === "object" ? feedback.error : loadError;

  const dirty =
    !!settings &&
    (current?.cache_dir !== settings.cache_dir ||
      (endpoint.trim() || null) !== (settings.download_endpoint ?? null) ||
      (token.trim() || null) !== (settings.download_token ?? null));

  /** 保存设置并以互斥状态呈现本次提交结果。 */
  const apply = async (next: EngineSettings): Promise<void> => {
    setFeedback("saving");
    try {
      setSettings(await commands.updateEngineSettings(next));
      setDraft({});
      setFeedback("saved");
    } catch (cause) {
      setFeedback({ error: errorMessage(cause) });
    }
  };

  const save = async () => {
    if (!current) return;
    await apply({
      ...current,
      download_endpoint: endpoint.trim() || null,
      download_token: token.trim() || null,
    });
  };

  const pickCacheDir = async () => {
    if (!settings) return;
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") {
        setDraft((previous) => ({ ...previous, cache_dir: picked }));
        setFeedback("idle");
      }
    } catch (cause) {
      setFeedback({ error: errorMessage(cause) });
    }
  };

  if (!isTauri()) {
    return (
      <AppState
        kind="unavailable"
        title={<Trans>存储设置需要桌面应用</Trans>}
        description={
          <Trans>请在桌面应用中选择模型目录、配置下载源和保存访问凭据。</Trans>
        }
        className="min-h-0 items-start px-0 py-4 text-left [&_[data-slot=empty-header]]:items-start"
      />
    );
  }

  return (
    <section>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans comment="引擎存储与下载源设置标题">存储位置与下载源</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              模型权重下载到共享缓存目录，与其他 Hugging Face
              工具复用同一份文件；下载源可切换镜像端点。
            </Trans>{" "}
            <Trans>目录、下载源和凭据在点击保存后生效。</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>
                  <Trans comment="模型权重缓存目录">模型缓存目录</Trans>
                </FieldTitle>
                <FieldDescription>
                  {current?.cache_dir ??
                    t({
                      comment: "默认共享 Hugging Face 缓存目录",
                      message:
                        "共享 Hugging Face 缓存（~/.cache/huggingface/hub）",
                    })}
                </FieldDescription>
              </FieldContent>
              <div className="flex flex-wrap gap-2">
                <OpenModelCacheButton />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!settings || saving}
                  onClick={() => void pickCacheDir()}
                >
                  <Trans comment="打开系统目录选择器">选择目录</Trans>
                </Button>
                {current?.cache_dir && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => {
                      setDraft((previous) => ({
                        ...previous,
                        cache_dir: null,
                      }));
                      setFeedback("idle");
                    }}
                  >
                    <Trans comment="恢复默认共享缓存目录">恢复默认</Trans>
                  </Button>
                )}
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="engine-download-endpoint">
                <Trans comment="模型下载源端点设置">下载源端点</Trans>
              </FieldLabel>
              <Input
                id="engine-download-endpoint"
                placeholder="https://huggingface.co"
                value={endpoint}
                disabled={!settings || saving}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    download_endpoint: event.target.value,
                  }))
                }
              />
              <FieldDescription>
                <Trans>
                  默认官方端点；网络受限时可填写镜像（如
                  https://hf-mirror.com）。仅对后续下载生效。
                </Trans>
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="engine-download-token">
                <Trans comment="下载源访问凭据设置">访问凭据（可选）</Trans>
              </FieldLabel>
              <Input
                id="engine-download-token"
                type="password"
                placeholder="hf_…"
                value={token}
                disabled={!settings || saving}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    download_token: event.target.value,
                  }))
                }
              />
              <FieldDescription>
                <Trans>仅保存在本机应用配置目录，不会写入工程或日志。</Trans>
              </FieldDescription>
            </Field>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>
                  {typeof feedback === "object" ? (
                    <Trans>设置保存失败</Trans>
                  ) : (
                    <Trans>设置读取失败</Trans>
                  )}
                </AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {feedback === "saved" && !dirty && (
              <p className="text-primary text-xs">
                <Trans comment="设置已保存的确认">已保存。</Trans>
              </p>
            )}
            <div>
              <Button
                disabled={!settings || saving || !dirty}
                onClick={() => void save()}
              >
                {saving ? (
                  <Trans comment="正在保存设置">保存中…</Trans>
                ) : (
                  <Trans comment="保存下载源设置">保存设置</Trans>
                )}
              </Button>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>
    </section>
  );
}
