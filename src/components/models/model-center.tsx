import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CpuIcon,
  DownloadIcon,
  FolderIcon,
  InfoIcon,
  PackageCheckIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  SquareIcon,
} from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { AppState } from "@/components/app-state";
import { OpenModelCacheButton } from "@/components/models/open-model-cache-button";
import { PageShell } from "@/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DesignResources } from "@/components/voices/design-resources";
import { StudioJobs } from "@/components/voices/studio-jobs";
import { useModelResources } from "@/hooks/use-model-resources";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import type { ModelPreparationPlan } from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import type { ModelEntry } from "@/lib/models";
import {
  downloadPercent,
  downloadProgress,
  failureKind,
  formatBytes,
  insufficientSpace,
  missingBytes,
  modelId,
  preparationPhaseLabels,
  stateLabel,
  variantOf,
} from "@/lib/models";

const stateStyles = {
  ok: "text-primary text-xs",
  idle: "text-muted-foreground text-xs",
  busy: "text-muted-foreground text-xs",
  error: "text-destructive text-xs",
} as const;

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
        <Badge key={label} variant="secondary">
          {label}
        </Badge>
      ))}
    </div>
  );
}

export function ModelCenter(): ReactElement {
  const { t } = useLingui();
  const { model: selectedId } = useSearch({ from: "/models" });
  const navigate = useNavigate({ from: "/models" });
  const resources = useModelResources();
  const studio = useVoiceStudio();
  const details = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
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
    setVerifying(modelId(entry));
    try {
      await commands.verifyModel(entry.backend, entry.model || null);
    } catch (cause) {
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
        <Button
          variant="outline"
          nativeButton={false}
          render={
            <Link to="/settings/$section" params={{ section: "storage" }} />
          }
        >
          <FolderIcon data-icon="inline-start" />
          <Trans comment="打开应用资源存储偏好">存储设置</Trans>
        </Button>
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-7">
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            <Trans>模型跨工程共享，每本小说分别选择自己的合成模型。</Trans>
          </p>
          <p className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            <Trans comment="下载与验证已接宿主；更新与移除仍在接入中">
              下载、状态与验证由本机引擎执行；模型的更新与移除仍在接入中。
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value="local">
            <TabsList variant="line">
              <TabsTrigger value="local">
                <Trans comment="在当前设备运行的模型目录">本机模型</Trans>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex w-64 max-w-full items-center gap-2">
            <SearchIcon className="text-muted-foreground size-4 shrink-0" />
            <Input
              aria-label={t({
                comment: "按名称或用途筛选模型",
                message: "搜索模型",
              })}
              placeholder={t({ message: "名称或模型用途…" })}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <DesignResources studio={studio} />
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
              <Trans comment="下载前磁盘空间不足">空间不足</Trans>
            </AlertTitle>
            <AlertDescription>
              <span>{spaceIssue}</span>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                nativeButton={false}
                render={
                  <Link
                    to="/settings/$section"
                    params={{ section: "storage" }}
                  />
                }
              >
                <Trans comment="打开应用资源存储偏好">存储设置</Trans>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div
          className={
            selected
              ? "grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"
              : "grid gap-6"
          }
        >
          <div className="flex min-w-0 flex-col gap-3">
            {resources.loading ? (
              <AppState
                kind="loading"
                title={<Trans>正在读取模型目录…</Trans>}
              />
            ) : (
              visible.map((entry) => {
                const id = modelId(entry);
                const label = stateLabel(entry.resource);
                return (
                  <Card
                    key={id}
                    data-model-id={id}
                    className={selectedId === id ? "ring-ring" : undefined}
                  >
                    <CardContent className="flex flex-wrap items-start gap-4 py-5">
                      <div className="bg-secondary text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                        <CpuIcon className="size-5" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-semibold">
                            {entry.name}
                          </h2>
                          <Badge variant="outline">
                            {entry.backend}/{entry.model}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="secondary">
                            {`${entry.voices} ${t({
                              comment: "模型预置音色数量的单位词",
                              message: "个音色",
                            })}`}
                          </Badge>
                        </div>
                        <CapabilityBadges entry={entry} />
                      </div>
                      <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto sm:flex-col sm:items-end">
                        <span className={stateStyles[label.kind]}>
                          {t(label.label)}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void navigate({ search: { model: id } })
                          }
                        >
                          <Trans comment="查看模型资源、能力和准备操作">
                            管理模型
                          </Trans>
                        </Button>
                      </div>
                      {["Downloading", "Preparing", "Paused"].includes(
                        variantOf(entry.resource),
                      ) && (
                        <div className="w-full sm:pl-14">
                          <ResourceProgressPanel entry={entry} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
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
            {!resources.loading && entries.length === 0 && !resources.error && (
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
                <CardDescription>
                  {t(stateLabel(selected.resource).label)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <dl className="flex flex-col gap-3 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">
                      <Trans comment="模型运行位置">运行方式</Trans>
                    </dt>
                    <dd>
                      <Trans comment="模型在本机执行">本机运行</Trans>
                    </dd>
                  </div>
                  {variantOf(selected.resource) !== "Preparing" && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">
                        <Trans comment="尚未就绪的运行资源体积，下载需求另见准备确认">
                          待准备资源
                        </Trans>
                      </dt>
                      <dd>{formatBytes(missingBytes(selected.resource))}</dd>
                    </div>
                  )}
                </dl>
                <p className="text-muted-foreground text-xs">
                  <Trans>
                    已编译设备：{selected.compiled_devices.join(" · ") || "—"}
                  </Trans>
                  <br />
                  <Trans>
                    本机可用设备：
                    {selected.available_devices.join(" · ") || "—"}
                  </Trans>
                </p>
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
                ) && <ResourceProgressPanel entry={selected} />}
                {selectedFailure && (
                  <Alert variant="destructive">
                    <AlertTriangleIcon />
                    <AlertTitle>
                      <Trans>资源准备失败</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <span>{t(stateLabel(selected.resource).label)}</span>
                      {selectedFailure === "Auth" && (
                        <span className="mt-1 block">
                          <Trans comment="鉴权失败的下一步引导">
                            请在存储设置的下载源中检查访问凭据，或改用镜像端点后重试。
                          </Trans>
                        </span>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {variantOf(selected.resource) === "Ready" && (
                  <Alert>
                    <PackageCheckIcon />
                    <AlertTitle>
                      <Trans>资源已就绪</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        可验证模型加载，或前往音色中心创建和试听音色。
                      </Trans>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-3">
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
            nativeButton={false}
            render={
              <Link to="/settings/$section" params={{ section: "storage" }} />
            }
            onClick={() => setPreparing(null)}
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
                !storage ||
                (storage.available_bytes != null &&
                  storage.available_bytes <
                    (storage.peak_additional_bytes ?? 0))
              }
              onClick={() => preparing && void startPrepare(preparing)}
            >
              <DownloadIcon data-icon="inline-start" />
              <Trans comment="确认开始下载并按需转换模型资源">开始准备</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

type DownloadTimingProps = { progress: ReturnType<typeof downloadProgress> };

function DownloadTiming({ progress }: DownloadTimingProps): ReactElement {
  if (progress?.total && progress.downloaded >= progress.total) {
    return (
      <Trans comment="下载字节已齐，仍在完成本地文件发布">正在完成下载…</Trans>
    );
  }
  if (progress?.stalled) {
    return (
      <Trans comment="一段时间没有收到新的下载字节，不代表已判定网络失败">
        暂未收到新数据
      </Trans>
    );
  }
  if (!progress?.downloaded) {
    return (
      <Trans comment="下载已启动，但尚无实际字节进度">等待下载数据…</Trans>
    );
  }
  if (progress.remainingSeconds === null) {
    return (
      <Trans comment="字节进度已有变化，但尚不能估算剩余时长">
        剩余时间估算中
      </Trans>
    );
  }
  const minutes = Math.max(1, Math.ceil(progress.remainingSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const extraMinutes = minutes % 60;
  if (hours > 0) {
    return (
      <Trans comment="根据近期下载速率估算的剩余时长；hours 为小时数，extraMinutes 为分钟数">
        预计剩余约 {hours} 小时 {extraMinutes} 分钟
      </Trans>
    );
  }
  return (
    <Trans comment="根据近期下载速率估算的剩余时长，向上取整">
      预计剩余约 {minutes} 分钟
    </Trans>
  );
}

function ResourceProgressPanel({ entry }: ModelEntryProps): ReactElement {
  const { t, i18n } = useLingui();
  const interrupted =
    typeof entry.resource === "string" ? null : entry.resource.Interrupted;
  if (interrupted) {
    return (
      <div className="flex flex-col gap-2 text-xs" role="status">
        <span>
          <Trans>上次准备已中断，请重新确认后重试。</Trans>
        </span>
        <span>
          {t(preparationPhaseLabels[interrupted.phase])} ·{" "}
          {interrupted.component}
        </span>
      </div>
    );
  }
  const nativeStage =
    typeof entry.resource === "string" ? null : entry.resource.Preparing;
  if (nativeStage) {
    return (
      <div className="flex flex-col gap-2 text-xs" role="status">
        <span>{t(preparationPhaseLabels[nativeStage.phase])}</span>
        <span className="truncate" title={nativeStage.component}>
          {nativeStage.component}
        </span>
        <Progress
          value={
            (nativeStage.total ?? 0) > 0
              ? Math.min(
                  100,
                  ((nativeStage.completed ?? 0) / (nativeStage.total ?? 1)) *
                    100,
                )
              : null
          }
        />
      </div>
    );
  }
  const progress = downloadProgress(entry.resource);
  const percent = downloadPercent(entry.resource);
  const rate = progress?.bytesPerSecond ?? null;
  const paused = variantOf(entry.resource) === "Paused";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0">
            {paused ? (
              <Trans comment="保留已下载数据，等待手动继续">已暂停</Trans>
            ) : (
              <Trans>下载中</Trans>
            )}
          </span>
          {progress?.currentFile && (
            <span className="truncate" title={progress.currentFile}>
              {progress.currentFile.split("/").slice(-1)[0]}
            </span>
          )}
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {formatBytes(progress?.downloaded)}
          {progress?.total ? ` / ${formatBytes(progress.total)}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Progress
          className="flex-1"
          value={percent ?? null}
          aria-label={t({
            comment: "模型资源的实际下载字节进度",
            message: "下载进度",
          })}
        />
        {percent !== null && (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {percent > 0 && percent < 0.1 ? "<" : ""}
            {new Intl.NumberFormat(i18n.locale, {
              maximumFractionDigits: 1,
            }).format(percent > 0 && percent < 0.1 ? 0.1 : percent)}
            %
          </span>
        )}
      </div>
      {paused && (
        <p className="text-muted-foreground text-xs">
          <Trans comment="暂停后断点和任务已保存，重启应用后也可继续">
            进度已保留，可随时继续下载。
          </Trans>
        </p>
      )}
      {!paused && (
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs tabular-nums">
          <span>
            <Trans comment="根据实际资源字节增量估算的下载速度">下载速率</Trans>
            {" · "}
            {rate === null ? (
              <Trans comment="尚未采到足够的下载进度样本">计算中</Trans>
            ) : (
              `${formatBytes(rate)}/s`
            )}
          </span>
          <span>
            <DownloadTiming progress={progress} />
          </span>
        </div>
      )}
    </div>
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
          <Trans comment="从保存的下载断点恢复任务">继续下载</Trans>
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
