import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  CpuIcon,
  DownloadIcon,
  FolderIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  SquareIcon,
} from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { AppState } from "@/components/app-state";
import { BrowserPreviewGuide } from "@/components/browser-preview-guide";
import { type ListView, ListViewToggle } from "@/components/list-view-toggle";
import { ModelProperties } from "@/components/models/model-properties";
import {
  ModelFailureNotice,
  ResourceProgressPanel,
} from "@/components/models/model-resource-feedback";
import { OpenModelCacheButton } from "@/components/models/open-model-cache-button";
import { ResourceStateBadge } from "@/components/models/resource-state-badge";
import { PageShell } from "@/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DesignResources } from "@/components/voices/design-resources";
import { StudioJobs } from "@/components/voices/studio-jobs";
import { useModelResources } from "@/hooks/use-model-resources";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import type { ModelPreparationPlan } from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import { useDesktopSession, useWorkspaceState } from "@/lib/desktop-session";
import type { ModelEntry } from "@/lib/models";
import {
  failureKind,
  formatBytes,
  insufficientSpace,
  modelId,
  variantOf,
} from "@/lib/models";
import { cn } from "@/lib/utils";

type ModelEntryProps = { entry: ModelEntry };

function CapabilityBadges({ entry }: ModelEntryProps): ReactElement | null {
  const { t } = useLingui();
  const labels = [
    entry.capabilities.preset &&
      t({ comment: "模型可用的声音能力", message: "预置音色" }),
    entry.capabilities.reference_cloning &&
      t({ comment: "从参考录音创建声音的模型能力", message: "参考克隆" }),
    entry.capabilities.style &&
      t({ comment: "支持风格指令的模型能力", message: "风格指令" }),
  ].filter((label) => typeof label === "string");
  if (!labels.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span key={label} className="text-muted-foreground text-xs">
          {label}
        </span>
      ))}
    </div>
  );
}

export function ModelCenter(): ReactElement {
  const { t } = useLingui();
  const { openSettings } = useDesktopSession();
  const { model: selectedId } = useSearch({ from: "/models" });
  const navigate = useNavigate({ from: "/models" });
  const resources = useModelResources();
  const studio = useVoiceStudio();
  const details = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("speech");
  const [view, setView] = useWorkspaceState<ListView>(
    "models",
    "listView",
    "cards",
  );
  const [preparing, setPreparing] = useState<ModelEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [spaceIssue, setSpaceIssue] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [storage, setStorage] = useState<ModelPreparationPlan | null>(null);

  useEffect(() => {
    if (selectedId) {
      details.current?.focus({ preventScroll: true });
      details.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedId]);

  // 确认对话打开时取存储概览（缓存目录 + 可用空间）。
  useEffect(() => {
    setStorage(null);
    if (!preparing) return;
    setSpaceIssue(null);
    let active = true;
    commands
      .modelPreparationPlan(preparing.backend, preparing.model || null)
      .then((next) => {
        if (active) setStorage(next);
      })
      .catch(() => {
        if (active)
          setSpaceIssue(t({ message: "无法获取资源准备计划，请关闭后重试。" }));
      });
    return () => {
      active = false;
    };
  }, [preparing, t]);

  const entries = resources.entries;
  const selected = entries.find((entry) => modelId(entry) === selectedId);
  const selectedFailure = selected ? failureKind(selected.resource) : null;
  const visible = entries.filter((entry) =>
    `${entry.name} ${entry.backend} ${entry.model}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );

  const startPrepare = async (entry: ModelEntry) => {
    if (!storage) return;
    setSpaceIssue(null);
    setBusy(modelId(entry));
    try {
      const outcome = await commands.prepareModel(
        entry.backend,
        entry.model || null,
        storage.fingerprint,
      );
      if (outcome === "PlanChanged") {
        setStorage(
          await commands.modelPreparationPlan(
            entry.backend,
            entry.model || null,
          ),
        );
        setSpaceIssue(
          t({ message: "资源计划已变化，请查看更新后的需求并重新确认。" }),
        );
        return;
      }
      const space = insufficientSpace(outcome);
      setPreparing(null);
      if (space) {
        const message = t({
          comment: "磁盘空间不足提示，后接所需/可用体积",
          message: "可用空间不足，可调整存储位置后重试。",
        });
        setSpaceIssue(
          `${message}（${formatBytes(space.required)} / ${formatBytes(space.available)}）`,
        );
      }
      await resources.refresh();
    } catch (cause) {
      setSpaceIssue(t({ message: "准备任务未能发起，请重试。" }));
      console.error("prepare failed", cause);
    } finally {
      setBusy(null);
    }
  };

  const startVerify = async (entry: ModelEntry) => {
    setSpaceIssue(null);
    setVerifying(modelId(entry));
    try {
      await commands.verifyModel(entry.backend, entry.model || null);
    } catch (cause) {
      setSpaceIssue(
        t({
          message: "模型验证未完成，请重试验证；若仍然失败，请重新准备资源。",
        }),
      );
      console.error("verify failed", cause);
    } finally {
      setVerifying(null);
    }
  };

  return (
    <PageShell
      active="models"
      title={t({ comment: "应用级共享模型资源页面标题", message: "模型中心" })}
      description={t({ message: "准备制作所需的模型，声音和工程保持独立。" })}
      actions={
        <Button variant="outline" onClick={() => openSettings("storage")}>
          <FolderIcon data-icon="inline-start" />
          <Trans comment="打开应用资源存储偏好">存储设置</Trans>
        </Button>
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
        {isTauri() && (
          <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <Tabs
              value={category}
              onValueChange={(value) => setCategory(String(value))}
            >
              <TabsList variant="line">
                <TabsTrigger value="speech">
                  <Trans comment="用于生成朗读音频的模型分类">语音合成</Trans>
                </TabsTrigger>
                <TabsTrigger value="design">
                  <Trans comment="用于从描述生成声音的模型分类">音色设计</Trans>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              <div className="flex w-64 max-w-full items-center gap-2">
                <SearchIcon className="text-muted-foreground size-4 shrink-0" />
                <Input
                  aria-label={t({
                    comment: "按名称或用途筛选模型",
                    message: "搜索模型",
                  })}
                  placeholder={t({ message: "名称或模型用途…" })}
                  value={query}
                  disabled={
                    !isTauri() ||
                    (category === "speech"
                      ? entries.length === 0
                      : studio.engines.length === 0)
                  }
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <ListViewToggle value={view} onChange={setView} />
            </div>
          </div>
        )}

        <StudioJobs studio={studio} />
        {resources.error && (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>
              <Trans>模型目录读取失败</Trans>
            </AlertTitle>
            <AlertDescription>{resources.error}</AlertDescription>
          </Alert>
        )}
        {spaceIssue && (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>
              <Trans comment="下载、准备、暂停或验证命令未完成">
                模型操作未完成
              </Trans>
            </AlertTitle>
            <AlertDescription>
              <span>{spaceIssue}</span>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => openSettings("storage")}
              >
                <Trans comment="打开应用资源存储偏好">存储设置</Trans>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!isTauri() ? (
          <BrowserPreviewGuide
            className="min-h-80"
            summary={
              <Trans>
                模型下载、进度与可用性验证需要读取本机资源，请在桌面应用中使用。
              </Trans>
            }
          />
        ) : category === "design" ? (
          <DesignResources studio={studio} query={query} view={view} />
        ) : (
          <div
            className={
              selected
                ? "grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"
                : "grid gap-6"
            }
          >
            <div className="flex min-w-0 flex-col">
              {resources.loading ? (
                <AppState
                  kind="loading"
                  title={<Trans>正在读取模型目录…</Trans>}
                />
              ) : view === "cards" ? (
                <div
                  className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4"
                  aria-label={t({
                    comment: "语音合成模型卡片目录",
                    message: "模型",
                  })}
                >
                  {visible.map((entry) => {
                    const id = modelId(entry);
                    return (
                      <section
                        key={id}
                        data-model-id={id}
                        aria-label={entry.name}
                        className={cn(
                          "border-border bg-card hover:border-ring/50 flex min-w-0 flex-col gap-3 rounded-lg border p-4 transition-colors",
                          selectedId === id && "border-ring/60 bg-accent/30",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <CpuIcon className="text-muted-foreground mt-0.5 size-5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <h2 className="text-sm font-medium">
                              {entry.name}
                            </h2>
                            <p className="text-muted-foreground mt-1 text-xs">
                              {`${entry.voices} ${t({
                                comment: "模型预置音色数量的单位词",
                                message: "个音色",
                              })}`}
                            </p>
                          </div>
                          <ResourceStateBadge resource={entry.resource} />
                        </div>
                        <CapabilityBadges entry={entry} />
                        {["Downloading", "Preparing", "Paused"].includes(
                          variantOf(entry.resource),
                        ) && (
                          <ResourceProgressPanel resource={entry.resource} />
                        )}
                        <div className="mt-auto flex justify-end pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              void navigate({ search: { model: id } })
                            }
                          >
                            <Trans comment="查看模型资源、能力和准备操作">
                              管理模型
                            </Trans>
                            <ChevronRightIcon data-icon="inline-end" />
                          </Button>
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="@container min-w-0">
                  <div
                    aria-hidden="true"
                    className="text-muted-foreground hidden gap-4 border-b px-3 py-2 text-xs @min-[760px]:grid @min-[760px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_4rem_7.5rem_5.5rem]"
                  >
                    <span>
                      <Trans comment="模型列表的名称列">模型名称</Trans>
                    </span>
                    <span>
                      <Trans comment="模型列表的能力列">能力</Trans>
                    </span>
                    <span>
                      <Trans comment="模型列表的预置音色数量列">音色</Trans>
                    </span>
                    <span>
                      <Trans comment="模型资源状态列">资源状态</Trans>
                    </span>
                    <span />
                  </div>
                  <ul className="border-border border-b">
                    {visible.map((entry) => {
                      const id = modelId(entry);
                      const active = selectedId === id;
                      return (
                        <li
                          key={id}
                          data-model-id={id}
                          aria-label={entry.name}
                          className={cn(
                            "border-border border-b last:border-b-0",
                            active ? "bg-accent/30" : "hover:bg-accent/40",
                          )}
                        >
                          <div className="grid items-center gap-x-4 gap-y-2 p-3 @min-[760px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_4rem_7.5rem_5.5rem]">
                            <div className="flex min-w-0 items-center gap-3">
                              <CpuIcon className="text-muted-foreground size-4 shrink-0" />
                              <span className="truncate text-sm font-medium">
                                {entry.name}
                              </span>
                            </div>
                            <div className="text-muted-foreground col-span-2 min-w-0 text-xs @min-[760px]:col-span-1">
                              <CapabilityBadges entry={entry} />
                            </div>
                            <span className="text-muted-foreground text-xs tabular-nums">
                              {entry.voices}
                            </span>
                            <div>
                              <ResourceStateBadge resource={entry.resource} />
                            </div>
                            <div className="justify-self-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={active}
                                onClick={() =>
                                  void navigate({ search: { model: id } })
                                }
                              >
                                <Trans comment="查看模型资源、能力和准备操作">
                                  管理模型
                                </Trans>
                              </Button>
                            </div>
                          </div>
                          {["Downloading", "Preparing", "Paused"].includes(
                            variantOf(entry.resource),
                          ) && (
                            <div className="px-3 pb-3">
                              <ResourceProgressPanel
                                resource={entry.resource}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {!resources.loading &&
                visible.length === 0 &&
                entries.length > 0 && (
                  <AppState
                    kind="search"
                    title={<Trans>没有匹配的模型</Trans>}
                    actions={
                      <Button variant="outline" onClick={() => setQuery("")}>
                        <Trans comment="重置搜索关键词">清除搜索</Trans>
                      </Button>
                    }
                  />
                )}
              {!resources.loading &&
                entries.length === 0 &&
                !resources.error && (
                  <AppState
                    kind="empty"
                    title={<Trans>本构建没有编译进任何模型</Trans>}
                    description={
                      <Trans>
                        模型目录由应用构建决定；重新构建时选择需要的声音引擎。
                      </Trans>
                    }
                  />
                )}
            </div>

            {selected && (
              <Card
                className="focus-visible:ring-ring order-first min-w-0 outline-none focus-visible:ring-2 xl:sticky xl:top-6 xl:order-last"
                ref={details}
                tabIndex={-1}
                data-slot="model-details"
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{selected.name}</CardTitle>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => void navigate({ search: {} })}
                    >
                      <Trans comment="收起模型管理详情面板">收起</Trans>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <ModelProperties entry={selected} />
                  {selected.unavailable_reason && (
                    <p role="status" className="text-muted-foreground text-xs">
                      {selected.unavailable_reason === "NoCompiledDevice" ? (
                        <Trans>当前构建未包含此模型可用的计算设备。</Trans>
                      ) : (
                        <Trans>本机没有此模型可用的计算设备。</Trans>
                      )}
                    </p>
                  )}
                  {["Downloading", "Preparing", "Paused"].includes(
                    variantOf(selected.resource),
                  ) && <ResourceProgressPanel resource={selected.resource} />}
                  {selectedFailure && (
                    <ModelFailureNotice
                      failure={selectedFailure}
                      onOpenSettings={() => openSettings("storage")}
                    />
                  )}
                </CardContent>
                <CardFooter className="flex-col items-stretch gap-2 bg-transparent">
                  <PrepareActions
                    entry={selected}
                    busy={busy === modelId(selected)}
                    verifying={verifying === modelId(selected)}
                    onPrepare={() => setPreparing(selected)}
                    onPause={async () => {
                      setBusy(modelId(selected));
                      try {
                        await commands.pausePrepare(
                          selected.backend,
                          selected.model,
                        );
                      } catch {
                        setSpaceIssue(
                          t({
                            comment: "暂停下载命令失败时提示",
                            message: "暂停下载失败，请重试。",
                          }),
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                    onResume={() => setPreparing(selected)}
                    onCancel={async () => {
                      setBusy(modelId(selected));
                      try {
                        await commands.cancelPrepare(
                          selected.backend,
                          selected.model,
                        );
                      } catch {
                        setSpaceIssue(
                          t({
                            comment: "取消下载命令失败时提示",
                            message: "取消下载失败，请重试。",
                          }),
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                    onVerify={() => void startVerify(selected)}
                  />
                  {selected.capabilities.reference_cloning && (
                    <Button
                      variant="outline"
                      nativeButton={false}
                      render={
                        <Link
                          to="/voices/new"
                          search={{ model: modelId(selected) }}
                        />
                      }
                    >
                      <Trans comment="用该模型进入音色创建">创建音色</Trans>
                    </Button>
                  )}
                  <p className="text-muted-foreground text-xs leading-5">
                    <Trans>
                      准备模型不会更改工程的模型选择，也不会替换角色音色。
                    </Trans>
                  </p>
                </CardFooter>
              </Card>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={!!preparing}
        onOpenChange={(open) => {
          if (!open) setPreparing(null);
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              <Trans comment="模型下载前的确认对话框标题">准备模型资源</Trans>
            </DialogTitle>
            <DialogDescription>
              {preparing
                ? `${preparing.name}（${preparing.backend}/${preparing.model}）`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {spaceIssue && (
            <p role="alert" className="text-destructive text-sm">
              {spaceIssue}
            </p>
          )}
          <dl className="bg-muted/40 flex flex-col gap-2.5 rounded-lg p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">
                <Trans comment="该模型尚需下载的体积">待下载体积</Trans>
              </dt>
              <dd>{storage ? formatBytes(storage.download_bytes) : "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">
                <Trans comment="下载缓存所在目录">存储位置</Trans>
              </dt>
              <dd className="max-w-[60%] truncate" title={storage?.cache_dir}>
                {storage?.cache_dir ?? "—"}
                <OpenModelCacheButton />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">
                <Trans comment="存储位置所在磁盘的可用空间">可用空间</Trans>
              </dt>
              <dd>{storage ? formatBytes(storage.available_bytes) : "—"}</dd>
            </div>
          </dl>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt>
                <Trans comment="资源准备确认中的保守空间估算">
                  峰值额外空间
                </Trans>
              </dt>
              <dd>
                {storage ? formatBytes(storage.peak_additional_bytes) : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>
                <Trans comment="资源准备确认中的本机转换组件">待转换组件</Trans>
              </dt>
              <dd className="max-w-[65%] text-right break-all">
                {!storage && "—"}
                {storage && storage.conversions.length === 0 && (
                  <Trans comment="已验证成品可直接下载，无需在用户机器上转换">
                    无需转换
                  </Trans>
                )}
                {storage &&
                  storage.conversions.length > 0 &&
                  storage.conversions.join(", ")}
              </dd>
            </div>
          </dl>
          <p className="text-muted-foreground text-sm leading-6">
            <Trans>
              将复用已校验的缓存，下载缺少的资源，完整校验后才会就绪。
            </Trans>
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setPreparing(null);
              openSettings("storage");
            }}
          >
            <Trans comment="打开应用资源存储偏好">存储设置</Trans>
          </Button>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>
              <Trans comment="关闭资源准备确认，不发起下载">取消</Trans>
            </DialogClose>
            <Button
              disabled={
                !preparing ||
                busy === modelId(preparing) ||
                !storage ||
                (storage.available_bytes != null &&
                  storage.available_bytes <
                    (storage.peak_additional_bytes ?? 0))
              }
              onClick={() => preparing && void startPrepare(preparing)}
            >
              <DownloadIcon data-icon="inline-start" />
              {busy ? (
                <Trans comment="正在向宿主提交模型准备任务">正在提交…</Trans>
              ) : (
                <Trans comment="确认开始下载并按需转换模型资源">开始准备</Trans>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function PrepareActions({
  entry,
  busy,
  verifying,
  onPrepare,
  onPause,
  onResume,
  onCancel,
  onVerify,
}: {
  entry: ModelEntry;
  busy: boolean;
  verifying: boolean;
  onPrepare: () => void;
  onPause: () => Promise<void>;
  onResume: () => void;
  onCancel: () => Promise<void>;
  onVerify: () => void;
}): ReactElement {
  const variant = variantOf(entry.resource);
  if (variant === "Preparing") {
    const cancelling =
      typeof entry.resource !== "string" &&
      entry.resource.Preparing?.phase === "Cancelling";
    return (
      <Button
        variant="outline"
        disabled={busy || cancelling}
        onClick={() => void onCancel()}
      >
        <SquareIcon data-icon="inline-start" />
        <Trans comment="取消模型准备并等待后台转换退出">取消准备</Trans>
      </Button>
    );
  }
  if (variant === "Downloading") {
    return (
      <>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void onPause()}
        >
          <PauseIcon data-icon="inline-start" />
          <Trans comment="停止网络请求，保存断点和任务">暂停下载</Trans>
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void onCancel()}>
          <SquareIcon data-icon="inline-start" />
          <Trans comment="取消任务，已下载的缓存仍保留">取消下载</Trans>
        </Button>
      </>
    );
  }
  if (variant === "Paused") {
    return (
      <>
        <Button disabled={busy} onClick={onResume}>
          <PlayIcon data-icon="inline-start" />
          {typeof entry.resource !== "string" && entry.resource.Interrupted ? (
            <Trans comment="重新确认中断的模型准备计划">继续准备</Trans>
          ) : (
            <Trans comment="从保存的下载断点恢复任务">继续下载</Trans>
          )}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void onCancel()}>
          <Trans comment="移除暂停任务记录，保留共享缓存">取消下载</Trans>
        </Button>
      </>
    );
  }
  if (variant === "Ready") {
    return (
      <>
        <Button
          disabled={verifying || entry.available_devices.length === 0}
          onClick={onVerify}
        >
          {verifying ? (
            <Trans comment="加载验证进行中">正在验证…</Trans>
          ) : (
            <Trans comment="加载一次模型以验证可用，随后释放">验证可用性</Trans>
          )}
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={
            <Link
              to="/voices"
              search={{ model: modelId(entry), library: "preset" }}
            />
          }
        >
          <Trans comment="查看该模型随附的声音">浏览预置音色</Trans>
        </Button>
      </>
    );
  }
  const isRetry = variant === "Failed" || variant === "Partial";
  let label = <Trans comment="确认需求后准备模型资源">准备模型</Trans>;
  if (variant === "Partial") {
    label = <Trans comment="重新确认后补齐模型资源">继续准备</Trans>;
  } else if (variant === "Failed") {
    label = <Trans comment="重新确认失败的模型准备任务">重试准备</Trans>;
  }
  return (
    <Button disabled={busy} onClick={onPrepare}>
      {isRetry ? (
        <RotateCcwIcon data-icon="inline-start" />
      ) : (
        <DownloadIcon data-icon="inline-start" />
      )}
      {label}
    </Button>
  );
}
