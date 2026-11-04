import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CpuIcon,
  FolderIcon,
  GlobeIcon,
  KeyboardIcon,
  MonitorIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useDesktopSession } from "@/lib/desktop-session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldContent,
  FieldLabel,
  FieldTitle,
  FieldDescription,
} from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/hooks/use-theme";
import { dynamicActivate, isLocaleKey, locales } from "@/lib/i18n";
import { AppState } from "@/components/app-state";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

export function SettingsPage({ section }: { section: string }) {
  const { t, i18n } = useLingui();
  const { returnTo } = useDesktopSession();
  const [query, setQuery] = useState("");
  const [languageBusy, setLanguageBusy] = useState(false);
  const [languageFailed, setLanguageFailed] = useState(false);
  const [attemptedLanguage, setAttemptedLanguage] = useState("");
  async function changeLanguage(value: string) {
    if (!isLocaleKey(value) || languageBusy) return;
    setAttemptedLanguage(value);
    setLanguageBusy(true);
    setLanguageFailed(false);
    try {
      await dynamicActivate(value);
    } catch {
      setLanguageFailed(true);
    } finally {
      setLanguageBusy(false);
    }
  }
  const { theme, setTheme } = useTheme();
  const categories = [
    {
      id: "general",
      label: t({ comment: "设置类别，应用外观与偏好", message: "通用" }),
      icon: MonitorIcon,
    },
    {
      id: "models",
      label: t({
        comment: "设置类别，仅管理远程端点与凭据，不管理模型资源",
        message: "服务连接",
      }),
      icon: CpuIcon,
    },
    {
      id: "storage",
      label: t({
        comment: "设置类别，工程与模型文件目录",
        message: "存储位置",
      }),
      icon: FolderIcon,
    },
    {
      id: "language",
      label: t({ comment: "设置类别，界面语言", message: "语言" }),
      icon: GlobeIcon,
    },
    {
      id: "shortcuts",
      label: t({ comment: "设置类别，键盘操作", message: "快捷键" }),
      icon: KeyboardIcon,
    },
    {
      id: "privacy",
      label: t({
        comment: "设置类别，隐私与声音使用权",
        message: "隐私与许可",
      }),
      icon: ShieldCheckIcon,
    },
  ];
  const themes = [
    { value: "light", label: t({ comment: "应用外观选项", message: "浅色" }) },
    { value: "dark", label: t({ comment: "应用外观选项", message: "深色" }) },
  ];
  const languageItems = Object.entries(locales).map(([value, label]) => ({
    value,
    label,
  }));
  const activeCategory =
    categories.find((category) => category.id === section) ?? categories[0];
  const visibleCategories = categories.filter((category) =>
    category.label
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div
      className="bg-background flex h-full min-h-0"
      data-slot="settings-layout"
    >
      <div className="bg-card flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside
          className="bg-sidebar border-border flex w-64 shrink-0 flex-col border-r max-sm:w-48"
          data-slot="settings-navigation"
        >
          <div className="flex flex-col gap-5 px-5 pt-6 pb-4">
            <h2 className="text-lg font-semibold">
              <Trans comment="完整设置布局侧栏的标题">设置</Trans>
            </h2>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t({
                comment: "筛选完整设置左侧的分类导航",
                message: "搜索设置分类",
              })}
              placeholder={t({
                comment: "设置分类搜索输入提示",
                message: "搜索设置…",
              })}
            />
          </div>
          <nav
            aria-label={t({
              comment: "完整设置左侧的分类路由导航",
              message: "设置分类",
            })}
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3"
          >
            {visibleCategories.map((category) => (
              <Button
                key={category.id}
                variant={category.id === section ? "secondary" : "ghost"}
                className="h-10 w-full justify-start"
                nativeButton={false}
                render={
                  <Link
                    to="/settings/$section"
                    params={{ section: category.id }}
                    aria-current={category.id === section ? "page" : undefined}
                  />
                }
              >
                <category.icon data-icon="inline-start" />
                {category.label}
              </Button>
            ))}
            {visibleCategories.length === 0 && (
              <AppState
                kind="search"
                compact
                title={<Trans>没有匹配的设置分类</Trans>}
                actions={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setQuery("")}
                  >
                    <Trans comment="重置设置分类搜索关键词">清除搜索</Trans>
                  </Button>
                }
              />
            )}
          </nav>
          <div className="border-border mt-4 border-t p-3">
            <Button
              variant="ghost"
              className="w-full justify-start"
              nativeButton={false}
              render={<Link to={returnTo} />}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              <Trans comment="离开完整设置，返回进入前的页面或工程">
                返回工作区
              </Trans>
            </Button>
          </div>
        </aside>
        <main
          className="min-h-0 min-w-0 flex-1 overflow-y-auto"
          data-slot="settings-content"
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-9 lg:px-12">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {activeCategory.label}
                </h1>
                <Badge variant="outline">
                  <Trans comment="设置仅用于当前设计预览，不表示已持久化">
                    预览设置
                  </Trans>
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                <Trans>让制作环境适合你的工作方式。</Trans>
              </p>
            </div>
            {section === "general" && (
              <section>
                <div className="flex flex-col gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <Trans comment="通用设置中的外观分组">外观</Trans>
                      </CardTitle>
                      <CardDescription>
                        <Trans>浅色适合日间制作，深色适合长时间专注。</Trans>
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldLabel htmlFor="theme">
                              <Trans comment="外观选择框标签">主题</Trans>
                            </FieldLabel>
                            <FieldDescription>
                              <Trans>切换后立即预览整个应用。</Trans>
                            </FieldDescription>
                          </FieldContent>
                          <Select
                            items={themes}
                            value={theme}
                            onValueChange={(v) => {
                              if (v) setTheme(v);
                            }}
                          >
                            <SelectTrigger id="theme" className="w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {themes.map((v) => (
                                  <SelectItem key={v.value} value={v.value}>
                                    {v.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                      </FieldGroup>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <Trans comment="通用设置中的制作行为分组">
                          制作偏好
                        </Trans>
                      </CardTitle>
                      <CardDescription>
                        <Trans>
                          以下开关仅预览偏好状态，播放与通知将在桌面端接入。
                        </Trans>
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldLabel htmlFor="follow">
                              <Trans comment="播放偏好开关">自动跟随播放</Trans>
                            </FieldLabel>
                            <FieldDescription>
                              <Trans>播放时将正文滚动到当前片段。</Trans>
                            </FieldDescription>
                          </FieldContent>
                          <Switch id="follow" defaultChecked />
                        </Field>
                        <Separator />
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldLabel htmlFor="notify">
                              <Trans comment="后台生成通知偏好">
                                生成完成后提示
                              </Trans>
                            </FieldLabel>
                            <FieldDescription>
                              <Trans>在批量任务完成时接收提醒。</Trans>
                            </FieldDescription>
                          </FieldContent>
                          <Switch id="notify" defaultChecked />
                        </Field>
                      </FieldGroup>
                    </CardContent>
                  </Card>
                </div>
              </section>
            )}
            {section === "models" && (
              <section className="flex flex-col gap-6">
                <p className="text-muted-foreground text-sm leading-6">
                  <Trans>
                    这里只配置服务地址和凭据。模型下载、安装与资源状态统一在模型中心管理。
                  </Trans>
                </p>
                <Alert role="status">
                  <AlertTitle>
                    <Trans>模型服务尚未接入</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>以下为连接配置预览，不会保存凭据或发起连接。</Trans>
                  </AlertDescription>
                </Alert>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Trans comment="线上文本语义分析的连接偏好">
                        文本分析服务
                      </Trans>
                    </CardTitle>
                    <CardDescription>
                      <Trans>角色分析与朗读规划使用的服务连接。</Trans>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup>
                      <Field data-disabled>
                        <FieldLabel htmlFor="analysis-endpoint">
                          <Trans comment="远程 API 地址">服务地址</Trans>
                        </FieldLabel>
                        <Input
                          id="analysis-endpoint"
                          disabled
                          placeholder="https://…"
                        />
                      </Field>
                      <Field data-disabled>
                        <FieldLabel htmlFor="analysis-key">
                          <Trans comment="服务鉴权密钥，不在前端保存">
                            API 密钥
                          </Trans>
                        </FieldLabel>
                        <Input
                          id="analysis-key"
                          type="password"
                          disabled
                          autoComplete="off"
                        />
                      </Field>
                    </FieldGroup>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Trans comment="语音宿主与远程后端的连接偏好">
                        语音服务连接
                      </Trans>
                    </CardTitle>
                    <CardDescription>
                      <Trans>
                        仅配置远程语音服务。本地模型无需填写服务地址。
                      </Trans>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup>
                      <Field data-disabled>
                        <FieldLabel htmlFor="tts-endpoint">
                          <Trans comment="远程 API 地址">服务地址</Trans>
                        </FieldLabel>
                        <Input
                          id="tts-endpoint"
                          disabled
                          placeholder="https://…"
                        />
                      </Field>
                      <Field data-disabled>
                        <FieldLabel htmlFor="tts-key">
                          <Trans comment="服务鉴权密钥，不在前端保存">
                            API 密钥
                          </Trans>
                        </FieldLabel>
                        <Input
                          id="tts-key"
                          type="password"
                          disabled
                          autoComplete="off"
                        />
                      </Field>
                    </FieldGroup>
                  </CardContent>
                </Card>
              </section>
            )}
            {section === "storage" && (
              <section>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Trans comment="文件目录设置标题">存储位置</Trans>
                    </CardTitle>
                    <CardDescription>
                      <Trans>
                        工程、模型和缓存分别管理，避免混入私人文本与声音样本。
                      </Trans>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup>
                      {[
                        t({
                          comment: "工程文件目录设置项",
                          message: "工程目录",
                        }),
                        t({
                          comment: "模型权重目录设置项",
                          message: "模型目录",
                        }),
                        t({
                          comment: "临时音频与下载缓存目录设置项",
                          message: "缓存目录",
                        }),
                      ].map((label) => (
                        <Field key={label} orientation="horizontal">
                          <FieldContent>
                            <FieldTitle>{label}</FieldTitle>
                            <FieldDescription>
                              <Trans comment="尚未选择实际文件目录">
                                尚未选择位置
                              </Trans>
                            </FieldDescription>
                          </FieldContent>
                          <Button variant="outline" size="sm" disabled>
                            <Trans comment="打开系统文件目录选择器">
                              选择目录
                            </Trans>
                          </Button>
                        </Field>
                      ))}
                    </FieldGroup>
                  </CardContent>
                </Card>
              </section>
            )}
            {section === "language" && (
              <section>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Trans comment="界面语言设置标题">语言</Trans>
                    </CardTitle>
                    <CardDescription>
                      <Trans>切换界面语言，不改变工程原文。</Trans>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="locale">
                          <Trans comment="界面语言选择框标签">界面语言</Trans>
                        </FieldLabel>
                        <Select
                          items={languageItems}
                          value={i18n.locale}
                          disabled={languageBusy}
                          onValueChange={(v) => {
                            if (v) void changeLanguage(v);
                          }}
                        >
                          <SelectTrigger id="locale" className="w-52">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {languageItems.map((l) => (
                                <SelectItem key={l.value} value={l.value}>
                                  {l.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {languageBusy && (
                          <p
                            role="status"
                            className="text-muted-foreground text-xs"
                          >
                            <Trans>正在切换语言…</Trans>
                          </p>
                        )}
                        {languageFailed && (
                          <Alert variant="destructive">
                            <AlertTitle>
                              <Trans>语言切换失败</Trans>
                            </AlertTitle>
                            <AlertDescription>
                              <Trans>
                                已保留原来的界面语言，请检查连接后重试。
                              </Trans>
                              <div className="mt-3">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    void changeLanguage(attemptedLanguage)
                                  }
                                >
                                  <Trans comment="重新加载刚才选择的界面语言">
                                    重试切换
                                  </Trans>
                                </Button>
                              </div>
                            </AlertDescription>
                          </Alert>
                        )}
                      </Field>
                    </FieldGroup>
                  </CardContent>
                </Card>
              </section>
            )}
            {section === "shortcuts" && (
              <section>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Trans comment="可用键盘操作说明标题">快捷键</Trans>
                    </CardTitle>
                    <CardDescription>
                      <Trans>使用键盘在工作区中快速移动。</Trans>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <dl className="flex flex-col gap-5">
                      <div className="flex justify-between gap-4">
                        <dt>
                          <Trans comment="键盘快捷键说明">
                            折叠或展开一级菜单
                          </Trans>
                        </dt>
                        <dd>
                          <kbd className="bg-muted rounded border px-2 py-1 text-xs">
                            ⌘ / Ctrl + B
                          </kbd>
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt>
                          <Trans comment="键盘快捷键说明">移动焦点</Trans>
                        </dt>
                        <dd>
                          <kbd className="bg-muted rounded border px-2 py-1 text-xs">
                            Tab
                          </kbd>
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt>
                          <Trans comment="键盘快捷键说明">关闭详情面板</Trans>
                        </dt>
                        <dd>
                          <kbd className="bg-muted rounded border px-2 py-1 text-xs">
                            Esc
                          </kbd>
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              </section>
            )}
            {section === "privacy" && (
              <section>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Trans comment="隐私设置说明标题">隐私与许可</Trans>
                    </CardTitle>
                    <CardDescription>
                      <Trans>保留对文本、声音与生成结果的控制。</Trans>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-muted-foreground flex flex-col gap-5 text-sm leading-7">
                      <p>
                        <Trans>
                          仅导入你有权使用的文本与声音样本。工程资料、模型权重和输出文件保存在桌面宿主管理的目录。
                        </Trans>
                      </p>
                      <p>
                        <Trans>
                          使用线上模型前，应核对发送范围与服务方政策。凭据不应包含在工程导出中。
                        </Trans>
                      </p>
                      <Separator />
                      <p>CastGlean · MIT</p>
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
