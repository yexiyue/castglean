import { Trans, useLingui } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
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
import { commands, type StorageLocations } from "@/lib/bindings";
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
  const [locations, setLocations] = useState<StorageLocations | null>(null);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void commands.storageLocations().then(
      (value) => {
        if (active) setLocations(value);
      },
      (cause) => {
        if (active) setLocationsError(errorMessage(cause));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const current = settings ? { ...settings, ...draft } : null;
  const endpoint = current?.download_endpoint ?? "";
  const token = current?.download_token ?? "";
  const [feedback, setFeedback] = useState<SaveFeedback>("idle");
  const [cacheFeedback, setCacheFeedback] = useState<SaveFeedback>("idle");
  const saving = feedback === "saving";
  const error =
    typeof feedback === "object"
      ? feedback.error
      : (loadError ?? locationsError);

  const dirty =
    !!settings &&
    (current?.cache_dir !== settings.cache_dir ||
      current?.data_dir !== settings.data_dir ||
      current?.app_cache_dir !== settings.app_cache_dir ||
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

  const restartPending =
    !!settings &&
    !!locations &&
    ((settings.data_dir ?? locations.default_data) !== locations.active_data ||
      (settings.app_cache_dir ?? locations.default_cache) !==
        locations.active_cache);

  const pickDir = async (key: "cache_dir" | "data_dir" | "app_cache_dir") => {
    if (!settings) return;
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") {
        setDraft((previous) => ({ ...previous, [key]: picked }));
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
            <Trans>
              模型缓存和下载源保存后生效；应用数据和应用缓存目录重启后生效，旧目录不会自动迁移或删除。
            </Trans>
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
                  onClick={() => void pickDir("cache_dir")}
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
            {locations &&
              [
                {
                  key: "data_dir" as const,
                  title: <Trans>应用数据目录</Trans>,
                  active: locations.active_data,
                  fallback: locations.default_data,
                },
                {
                  key: "app_cache_dir" as const,
                  title: <Trans>应用缓存目录</Trans>,
                  active: locations.active_cache,
                  fallback: locations.default_cache,
                },
              ].map(({ key, title, active, fallback }) => {
                const selected = current?.[key] ?? fallback;
                return (
                  <Field key={key} orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>{title}</FieldTitle>
                      <FieldDescription className="break-all">
                        {selected}
                      </FieldDescription>
                      {selected !== active && (
                        <FieldDescription className="break-all">
                          <Trans>当前使用：{active}</Trans>
                        </FieldDescription>
                      )}
                    </FieldContent>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!settings || saving}
                        onClick={() => void pickDir(key)}
                      >
                        <Trans comment="打开系统目录选择器">选择目录</Trans>
                      </Button>
                      {current?.[key] && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={saving}
                          onClick={() => {
                            setDraft((previous) => ({
                              ...previous,
                              [key]: null,
                            }));
                            setFeedback("idle");
                          }}
                        >
                          <Trans comment="恢复默认存储目录">恢复默认</Trans>
                        </Button>
                      )}
                    </div>
                  </Field>
                );
              })}
            {restartPending && (
              <Alert>
                <AlertTitle>
                  <Trans>重启后切换存储目录</Trans>
                </AlertTitle>
                <AlertDescription>
                  <Trans>当前仍使用原目录。重启应用后使用已保存的目录。</Trans>
                </AlertDescription>
              </Alert>
            )}
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>
                  <Trans>应用缓存清理</Trans>
                </FieldTitle>
                <FieldDescription>
                  <Trans>
                    清理设备校准和已结束的旧试听临时文件；共享模型、保存的音色和当前试听不会被删除。
                  </Trans>
                </FieldDescription>
                {cacheFeedback === "saved" && (
                  <FieldDescription>
                    <Trans>已清理可回收的应用缓存。</Trans>
                  </FieldDescription>
                )}
                {typeof cacheFeedback === "object" && (
                  <FieldDescription role="alert">
                    {cacheFeedback.error}
                  </FieldDescription>
                )}
              </FieldContent>
              <Button
                variant="outline"
                size="sm"
                disabled={!settings || cacheFeedback === "saving"}
                onClick={() => {
                  setCacheFeedback("saving");
                  void commands.clearApplicationCache().then(
                    () => setCacheFeedback("saved"),
                    (cause) => setCacheFeedback({ error: errorMessage(cause) }),
                  );
                }}
              >
                <Trans>清理应用缓存</Trans>
              </Button>
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
