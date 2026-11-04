import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import {
  CloudIcon,
  CpuIcon,
  DownloadIcon,
  FolderIcon,
  InfoIcon,
  PackageCheckIcon,
  RotateCcwIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { AppState } from "@/components/app-state";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  previewModels,
  modelCapabilities,
  modelStates,
  supports,
} from "@/lib/preview-models";
import type { PreviewModel } from "@/lib/preview-models";

export function ModelCenter() {
  const { t } = useLingui();
  const { model: selectedId } = useSearch({ from: "/models" });
  const navigate = useNavigate({ from: "/models" });
  const details = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId) {
      details.current?.focus({ preventScroll: true });
      details.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedId]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [preparing, setPreparing] = useState<PreviewModel | null>(null);
  const selected = previewModels.find((model) => model.id === selectedId);
  const visible = previewModels.filter(
    (model) =>
      (filter === "all" || model.kind === filter) &&
      `${t(model.name)} ${t(model.description)}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
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
            <Trans>
              以下为能力与资源状态示例，大小和进度仅供界面预览；尚未连接真实模型服务。
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(String(value))}
          >
            <TabsList variant="line">
              <TabsTrigger value="all">
                <Trans comment="模型目录筛选">全部</Trans>
              </TabsTrigger>
              <TabsTrigger value="local">
                <Trans comment="在当前设备运行的模型目录">本地模型</Trans>
              </TabsTrigger>
              <TabsTrigger value="cloud">
                <Trans comment="通过远程服务运行的模型目录">云端服务</Trans>
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
        <div
          className={
            selected
              ? "grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"
              : "grid gap-6"
          }
        >
          <div className="flex min-w-0 flex-col gap-3">
            {visible.map((model) => (
              <Card
                key={model.id}
                data-model-id={model.id}
                className={selectedId === model.id ? "ring-ring" : undefined}
              >
                <CardContent className="flex flex-wrap items-start gap-4 py-5">
                  <div className="bg-secondary text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                    {model.kind === "cloud" ? (
                      <CloudIcon className="size-5" />
                    ) : (
                      <CpuIcon className="size-5" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">{t(model.name)}</h2>
                      <Badge variant="outline">
                        <Trans comment="能力和资源数据仅为设计夹具">示例</Trans>
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-xs leading-5">
                      {t(model.description)}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {model.capabilities.map((capability) => (
                        <Badge key={capability} variant="secondary">
                          {t(modelCapabilities[capability])}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto sm:flex-col sm:items-end">
                    <span
                      className={
                        model.state === "failed"
                          ? "text-destructive text-xs"
                          : "text-muted-foreground text-xs"
                      }
                    >
                      {t(modelStates[model.state])}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void navigate({ search: { model: model.id } })
                      }
                    >
                      <Trans comment="查看模型资源、能力和准备操作">
                        管理模型
                      </Trans>
                    </Button>
                  </div>
                  {model.state === "paused" && (
                    <div className="flex w-full items-center gap-3 sm:pl-14">
                      <Progress
                        value={42}
                        aria-label={t({
                          comment: "固定的示例下载进度，不是真实任务",
                          message: "示例下载进度",
                        })}
                        className="flex-1"
                      />
                      <span className="text-muted-foreground text-xs tabular-nums">
                        42%
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {visible.length === 0 && (
              <AppState
                kind="search"
                title={<Trans>没有匹配的模型</Trans>}
                actions={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    <Trans comment="重置搜索关键词与分类筛选">
                      清除搜索与筛选
                    </Trans>
                  </Button>
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
                  <CardTitle>{t(selected.name)}</CardTitle>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void navigate({ search: {} })}
                  >
                    <Trans comment="收起模型管理详情面板">收起</Trans>
                  </Button>
                </div>
                <CardDescription>
                  {t(modelStates[selected.state])}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <dl className="flex flex-col gap-3 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">
                      <Trans comment="模型运行位置">运行方式</Trans>
                    </dt>
                    <dd>
                      {selected.kind === "cloud" ? (
                        <Trans comment="通过远程服务运行的模型目录">
                          云端服务
                        </Trans>
                      ) : (
                        <Trans comment="模型在本机执行">本机运行</Trans>
                      )}
                    </dd>
                  </div>
                  {selected.size && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">
                        <Trans comment="模型下载体积为示例数值">
                          资源大小（示例）
                        </Trans>
                      </dt>
                      <dd>{selected.size}</dd>
                    </div>
                  )}
                </dl>
                <div className="flex flex-col gap-2">
                  {Object.entries(modelCapabilities).map(([key, label]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span>{t(label)}</span>
                      <span className="text-muted-foreground">
                        {supports(
                          selected,
                          key as keyof typeof modelCapabilities,
                        ) ? (
                          <Trans comment="示例模型具备该项能力">支持</Trans>
                        ) : (
                          <Trans comment="示例模型不具备该项能力">不支持</Trans>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {selected.state === "failed" ? (
                  <Alert variant="destructive">
                    <AlertTitle>
                      <Trans>资源校验未通过</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        示例文件不完整。重新下载并通过校验后，才能加载模型。
                      </Trans>
                    </AlertDescription>
                  </Alert>
                ) : selected.state === "installed" ? (
                  <Alert>
                    <PackageCheckIcon />
                    <AlertTitle>
                      <Trans>资源已安装，尚未加载</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        安装与运行分开管理。加载成功后，才能生成试听或章节音频。
                      </Trans>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <p className="text-muted-foreground text-xs leading-6">
                    <Trans>
                      准备资源不会更改工程的模型选择，也不会替换角色音色。
                    </Trans>
                  </p>
                )}
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-3">
                {selected.kind === "cloud" ? (
                  <Button
                    nativeButton={false}
                    render={
                      <Link
                        to="/settings/$section"
                        params={{ section: "models" }}
                      />
                    }
                  >
                    <Trans comment="前往远程服务连接偏好">配置服务连接</Trans>
                  </Button>
                ) : selected.state === "installed" ? (
                  <>
                    <Button disabled>
                      <Trans comment="加载已安装权重到设备，尚未接入">
                        加载模型
                      </Trans>
                    </Button>
                    <Button
                      variant="outline"
                      nativeButton={false}
                      render={
                        <Link
                          to="/voices"
                          search={{ model: selected.id, library: "preset" }}
                        />
                      }
                    >
                      <Trans comment="查看该模型随附的声音">浏览预置音色</Trans>
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => setPreparing(selected)}>
                    {selected.state === "failed" ? (
                      <RotateCcwIcon data-icon="inline-start" />
                    ) : (
                      <DownloadIcon data-icon="inline-start" />
                    )}
                    {selected.state === "paused" ? (
                      <Trans comment="查看恢复模型资源下载前的确认">
                        继续下载
                      </Trans>
                    ) : selected.state === "failed" ? (
                      <Trans comment="重新准备损坏的模型资源">重新下载</Trans>
                    ) : (
                      <Trans comment="查看模型资源下载前的确认">下载模型</Trans>
                    )}
                  </Button>
                )}
                {supports(selected, "clone") || supports(selected, "design") ? (
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={
                      <Link to="/voices/new" search={{ model: selected.id }} />
                    }
                  >
                    <Trans comment="用该模型进入音色创建">创建音色</Trans>
                  </Button>
                ) : null}
                <p className="text-muted-foreground text-xs leading-5">
                  <Trans>预览未连接服务，不会下载、加载或移除本地资源。</Trans>
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
              {preparing && t(preparing.name)}
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg p-4 text-sm">
            <span>
              <Trans comment="模型下载体积为示例数值">资源大小（示例）</Trans>
            </span>
            <span>{preparing?.size}</span>
          </div>
          <p className="text-muted-foreground text-sm leading-6">
            <Trans>
              下载完成后还需校验与加载。开始前请确认资源来源、存储位置和可用空间；当前仅预览确认信息。
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
            <Button disabled>
              <Trans comment="正式发起模型下载，宿主尚未接入">开始下载</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
