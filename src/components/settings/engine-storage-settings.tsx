import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { AppState } from "@/components/app-state";
import { OpenModelCacheButton } from "@/components/models/open-model-cache-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage, useEngineSettings } from "@/hooks/use-engine-settings";
import type { EngineSettingsChange, EngineSettingsView } from "@/lib/bindings";
import { commands, type StorageLocations } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";

type SaveFeedback = "idle" | "saving" | "saved" | { error: string };
type CacheFeedback =
  | "idle"
  | "saving"
  | { kind: "cleared"; items: number }
  | { error: string };
const downloadSchema = z.object({
  endpoint: z.string().refine((value) => {
    if (!value.trim()) return true;
    try {
      const url = new URL(value.trim());
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !!url.hostname &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }),
  token: z.string(),
  removeToken: z.boolean(),
});

/**
 * 引擎存储与下载源设置：模型缓存目录（默认共享 HF 缓存）、镜像端点与
 * 访问凭据。保存后对后续下载生效；凭据只保存在本地应用配置目录。
 */
export function EngineStorageSettings() {
  const { t } = useLingui();
  const { workspace } = useDesktopSession();
  const { settings, error: loadError, setSettings } = useEngineSettings();
  const [draft, setDraft] = useState<
    Partial<
      Pick<EngineSettingsView, "cache_dir" | "data_dir" | "app_cache_dir">
    >
  >({});
  const form = useForm({
    resolver: zodResolver(downloadSchema),
    defaultValues: { endpoint: "", token: "", removeToken: false },
  });
  const { endpoint, token, removeToken } = form.watch();
  const initialized = useRef(false);
  useEffect(() => {
    if (settings && !initialized.current) {
      initialized.current = true;
      form.reset({
        endpoint: settings.download_endpoint ?? "",
        token: "",
        removeToken: false,
      });
    }
  }, [settings, form.reset]);
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
  const [feedback, setFeedback] = useState<SaveFeedback>("idle");
  const [pendingSave, setPendingSave] = useState<{
    id: string;
    change: EngineSettingsChange;
  } | null>(null);
  const [recoveryRead, setRecoveryRead] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const savingRef = useRef(false);
  const [cacheFeedback, setCacheFeedback] = useState<CacheFeedback>("idle");
  const saving = feedback === "saving";
  const locked = saving || !!pendingSave;
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
      !!token.trim() ||
      (removeToken && settings.has_download_token));

  useEffect(() => {
    const session = workspace("settings");
    session.unsavedEngineSettings = dirty || locked;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty && !locked) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      session.unsavedEngineSettings = false;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, locked, workspace]);

  /** 保存设置并以互斥状态呈现本次提交结果。 */
  const apply = async (operation: {
    id: string;
    change: EngineSettingsChange;
  }): Promise<void> => {
    if (savingRef.current) return;
    savingRef.current = true;
    setFeedback("saving");
    try {
      const saved = await commands.updateEngineSettings(
        operation.change,
        operation.id,
      );
      form.reset({
        endpoint: saved.download_endpoint ?? "",
        token: "",
        removeToken: false,
      });
      setSettings(saved);
      setDraft({});
      setPendingSave(null);
      setRecoveryRead(false);
      setSaveConflict(false);
      setFeedback("saved");
    } catch (cause) {
      const conflict = cause === "Conflict";
      setSaveConflict(conflict);
      setFeedback({
        error: conflict
          ? t`设置已变化，请重新读取并核对草稿后再保存。`
          : t`保存结果尚未确认，请核对或重试原保存。`,
      });
    } finally {
      savingRef.current = false;
    }
  };

  const save = form.handleSubmit(async (values) => {
    if (!current || !settings || pendingSave || savingRef.current) return;
    const change: EngineSettingsChange = {
      expected_revision: settings.revision,
      cache_dir: current.cache_dir,
      data_dir: current.data_dir,
      app_cache_dir: current.app_cache_dir,
      download_endpoint: values.endpoint.trim() || null,
      download_token: values.removeToken
        ? { kind: "remove" }
        : values.token.trim()
          ? { kind: "replace", value: values.token.trim() }
          : { kind: "keep" },
    };
    const operation = { id: crypto.randomUUID(), change };
    setPendingSave(operation);
    setRecoveryRead(false);
    setSaveConflict(false);
    await apply(operation);
  });

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
        align="start"
        className="min-h-0 px-0 py-4"
      />
    );
  }

  return (
    <section>
      <Card variant="section">
        <CardContent>
          <form noValidate onSubmit={(event) => void save(event)}>
            {pendingSave && !saving && (
              <Alert>
                <AlertDescription>
                  <div className="space-y-2">
                    <p>
                      {saveConflict ? (
                        <Trans>
                          本次保存因设置已变化而被拒绝，请重新读取并核对草稿。
                        </Trans>
                      ) : (
                        <Trans>
                          保存结果尚未确认。重试使用原请求；停止核对不会撤销可能已完成的保存。
                        </Trans>
                      )}
                    </p>
                    {recoveryRead && (
                      <p>
                        {saveConflict ? (
                          <Trans>
                            已重新读取设置；草稿仍保留，请核对后决定如何处理。
                          </Trans>
                        ) : (
                          <Trans>
                            已重新读取设置，但无法确认凭据内容或本次保存是否完成。
                          </Trans>
                        )}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {!saveConflict && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void apply(pendingSave)}
                        >
                          <Trans>重试原保存</Trans>
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setFeedback("saving");
                          void commands.getEngineSettings().then(
                            (next) => {
                              setSettings(next);
                              setRecoveryRead(true);
                              setFeedback("idle");
                            },
                            () =>
                              setFeedback({ error: t`设置读取失败，请重试。` }),
                          );
                        }}
                      >
                        <Trans>重新读取设置</Trans>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={!recoveryRead}
                        onClick={() => {
                          setPendingSave(null);
                          setRecoveryRead(false);
                          setSaveConflict(false);
                          setFeedback("idle");
                        }}
                      >
                        <Trans>停止核对并继续编辑</Trans>
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            <fieldset disabled={locked} className="pb-4">
              <div className="flex flex-col gap-10">
                <FieldSet>
                  <FieldLegend variant="label">
                    <Trans comment="存储设置的目录分组标题">目录</Trans>
                  </FieldLegend>
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
                      <OpenModelCacheButton variant="ghost" />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t`选择模型缓存目录`}
                        disabled={!settings || saving}
                        onClick={() => void pickDir("cache_dir")}
                      >
                        <Trans comment="打开系统目录选择器">选择目录</Trans>
                      </Button>
                      {current?.cache_dir && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t`恢复默认模型缓存目录`}
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
                        chooseLabel: t`选择应用数据目录`,
                        resetLabel: t`恢复默认应用数据目录`,
                      },
                      {
                        key: "app_cache_dir" as const,
                        title: <Trans>应用缓存目录</Trans>,
                        active: locations.active_cache,
                        fallback: locations.default_cache,
                        chooseLabel: t`选择应用缓存目录`,
                        resetLabel: t`恢复默认应用缓存目录`,
                      },
                    ].map(
                      ({
                        key,
                        title,
                        active,
                        fallback,
                        chooseLabel,
                        resetLabel,
                      }) => {
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
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={chooseLabel}
                                disabled={!settings || saving}
                                onClick={() => void pickDir(key)}
                              >
                                <Trans comment="打开系统目录选择器">
                                  选择目录
                                </Trans>
                              </Button>
                              {current?.[key] && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={resetLabel}
                                  disabled={saving}
                                  onClick={() => {
                                    setDraft((previous) => ({
                                      ...previous,
                                      [key]: null,
                                    }));
                                    setFeedback("idle");
                                  }}
                                >
                                  <Trans comment="恢复默认存储目录">
                                    恢复默认
                                  </Trans>
                                </Button>
                              )}
                            </div>
                          </Field>
                        );
                      },
                    )}
                  {restartPending && (
                    <Alert>
                      <AlertTitle>
                        <Trans>重启后切换存储目录</Trans>
                      </AlertTitle>
                      <AlertDescription>
                        <Trans>
                          当前仍使用原目录。重启应用后使用已保存的目录。
                        </Trans>
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
                          清理旧试听临时文件与设备校准数据；模型、音色与当前试听不受影响。
                        </Trans>
                      </FieldDescription>
                      {typeof cacheFeedback === "object" &&
                        "kind" in cacheFeedback && (
                          <FieldDescription role="status">
                            {/* 清理回执展示真实回收条目数；0 项也是诚实结果 */}
                            {cacheFeedback.items > 0
                              ? t`已清理 ${cacheFeedback.items} 项：旧试听临时文件和设备校准数据。`
                              : t`没有需要清理的缓存。`}
                          </FieldDescription>
                        )}
                      {typeof cacheFeedback === "object" &&
                        "error" in cacheFeedback && (
                          <FieldDescription role="alert">
                            {cacheFeedback.error}
                          </FieldDescription>
                        )}
                    </FieldContent>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!settings || cacheFeedback === "saving"}
                      onClick={() => {
                        setCacheFeedback("saving");
                        void commands.clearApplicationCache().then(
                          (items) =>
                            setCacheFeedback({ kind: "cleared", items }),
                          (cause) =>
                            setCacheFeedback({ error: errorMessage(cause) }),
                        );
                      }}
                    >
                      {cacheFeedback === "saving" ? (
                        <Trans comment="正在清理应用缓存">清理中…</Trans>
                      ) : (
                        <Trans>清理应用缓存</Trans>
                      )}
                    </Button>
                  </Field>
                </FieldSet>
                <FieldSet>
                  <FieldLegend variant="label">
                    <Trans comment="存储设置的下载源分组标题">下载源</Trans>
                  </FieldLegend>
                  <Field data-invalid={!!form.formState.errors.endpoint}>
                    <FieldLabel htmlFor="engine-download-endpoint">
                      <Trans comment="模型下载源端点设置">下载源端点</Trans>
                    </FieldLabel>
                    <Input
                      {...form.register("endpoint")}
                      id="engine-download-endpoint"
                      placeholder="https://huggingface.co"
                      disabled={!settings || saving}
                      aria-invalid={!!form.formState.errors.endpoint}
                      aria-describedby={`engine-endpoint-description${form.formState.errors.endpoint ? " engine-endpoint-error" : ""}`}
                    />
                    <FieldDescription id="engine-endpoint-description">
                      <Trans>
                        网络受限时可填镜像端点，如 https://hf-mirror.com。
                      </Trans>
                    </FieldDescription>
                    {form.formState.errors.endpoint && (
                      <FieldError id="engine-endpoint-error">
                        <Trans>
                          请输入不含内嵌凭据的有效 HTTP 或 HTTPS 地址。
                        </Trans>
                      </FieldError>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="engine-download-token">
                      <Trans comment="下载源访问凭据设置">
                        访问凭据（可选）
                      </Trans>
                    </FieldLabel>
                    <Input
                      {...form.register("token")}
                      id="engine-download-token"
                      type="password"
                      placeholder={
                        settings?.has_download_token
                          ? t`留空以保留现有凭据`
                          : "hf_…"
                      }
                      disabled={!settings || saving || removeToken}
                      aria-describedby="engine-token-description"
                      autoComplete="new-password"
                    />
                    <FieldDescription id="engine-token-description">
                      <Trans>
                        凭据仅保存在本机应用配置目录，不写入工程或日志。
                      </Trans>
                    </FieldDescription>
                    {settings?.has_download_token && (
                      <Controller
                        control={form.control}
                        name="removeToken"
                        render={({ field }) => (
                          <label
                            htmlFor="engine-remove-token"
                            className="flex items-center gap-2 text-sm"
                          >
                            <Checkbox
                              id="engine-remove-token"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              disabled={saving}
                            />
                            <Trans>移除现有下载凭据</Trans>
                          </label>
                        )}
                      />
                    )}
                  </Field>
                </FieldSet>
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>
                    {typeof feedback === "object" ? (
                      saveConflict ? (
                        <Trans>设置已变化</Trans>
                      ) : (
                        <Trans>设置保存结果未确认</Trans>
                      )
                    ) : (
                      <Trans>设置读取失败</Trans>
                    )}
                  </AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </fieldset>
            {/* 保存栏钉在滚动区底部：主操作始终可达，生效时机跟随决定点。 */}
            <div className="bg-card sticky bottom-0 -mx-5 -mb-5 mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-5 py-3">
              <p role="status" className="text-xs min-w-0 flex-1">
                {feedback === "saved" && !dirty ? (
                  <span className="text-success">
                    <Trans comment="设置已保存的确认，说明生效范围">
                      已保存，对后续任务生效。
                    </Trans>
                  </span>
                ) : dirty ? (
                  <Trans comment="保存前的生效时机提示">
                    应用数据与缓存目录重启后生效，其余保存后生效。
                  </Trans>
                ) : null}
              </p>
              <Button
                type="button"
                variant="ghost"
                disabled={!settings || saving || !dirty}
                onClick={() => {
                  setDraft({});
                  form.reset({
                    endpoint: settings?.download_endpoint ?? "",
                    token: "",
                    removeToken: false,
                  });
                  setFeedback("idle");
                }}
              >
                <Trans>放弃修改</Trans>
              </Button>
              <Button type="submit" disabled={!settings || saving || !dirty}>
                {saving ? (
                  <Trans comment="正在保存设置">保存中…</Trans>
                ) : (
                  <Trans comment="保存下载源设置">保存设置</Trans>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
