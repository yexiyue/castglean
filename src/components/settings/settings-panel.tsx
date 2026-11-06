import { LlmSettings } from "./llm-settings";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  CpuIcon,
  FolderIcon,
  GlobeIcon,
  InfoIcon,
  KeyboardIcon,
  MonitorIcon,
} from "lucide-react";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import { AboutSettings } from "@/components/settings/about-settings";
import { EngineStorageSettings } from "@/components/settings/engine-storage-settings";
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
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/hooks/use-theme";
import { dynamicActivate, isLocaleKey, locales } from "@/lib/i18n";

/**
 * 设置内容面板：左侧分类导航 + 右侧分区内容。
 * 作为对话框内容复用，分类切换由宿主控制，不依赖路由。
 */
export function SettingsPanel({
  section,
  onSectionChange,
}: {
  section: string;
  onSectionChange: (section: string) => void;
}) {
  const { t, i18n } = useLingui();
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
      id: "about",
      label: t({
        comment: "设置类别，应用信息与品牌介绍",
        message: "关于",
      }),
      icon: InfoIcon,
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
  // 未知分区（如手输的 ?settings=xxx）回落到第一个分类，不留空白面板。
  const activeSection = activeCategory.id;
  const visibleCategories = categories.filter((category) =>
    category.label
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div
      className="bg-background flex size-full min-h-0"
      data-slot="settings-layout"
    >
      <div className="bg-card flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside
          className="bg-sidebar border-border flex w-48 shrink-0 flex-col border-r max-sm:w-40"
          data-slot="settings-navigation"
        >
          <div className="flex flex-col gap-3 px-3 pt-4 pb-2">
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
              comment: "完整设置左侧的分类导航",
              message: "设置分类",
            })}
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2"
          >
            {visibleCategories.map((category) => (
              <Button
                key={category.id}
                variant={category.id === activeSection ? "secondary" : "ghost"}
                className="h-9 w-full justify-start px-2"
                aria-current={
                  category.id === activeSection ? "page" : undefined
                }
                onClick={() => onSectionChange(category.id)}
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
        </aside>
        <main
          className="min-h-0 min-w-0 flex-1 overflow-y-auto"
          data-slot="settings-content"
        >
          <div className="[&_[data-slot=card]]:border-border mx-auto flex max-w-2xl flex-col gap-6 p-6 [&_[data-slot=card-content]]:px-0 [&_[data-slot=card-header]]:px-0 [&_[data-slot=card]]:rounded-none [&_[data-slot=card]]:border-0 [&_[data-slot=card]]:border-b [&_[data-slot=card]]:bg-transparent [&_[data-slot=card]]:pb-6 [&_[data-slot=card]]:ring-0">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold">
                  {activeCategory.label}
                </h2>
              </div>
            </div>
            {activeSection === "general" && (
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
                          <Switch id="follow" disabled />
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
                          <Switch id="notify" disabled />
                        </Field>
                      </FieldGroup>
                    </CardContent>
                  </Card>
                </div>
              </section>
            )}
            {activeSection === "models" && (
              <section className="flex flex-col gap-6">
                <p className="text-muted-foreground text-sm leading-6">
                  <Trans>
                    这里只配置服务地址和凭据。模型下载、安装与资源状态统一在模型中心管理。
                  </Trans>
                </p>
                <LlmSettings />
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
            {activeSection === "storage" && <EngineStorageSettings />}
            {activeSection === "language" && (
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
            {activeSection === "shortcuts" && (
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
            {activeSection === "about" && <AboutSettings />}
          </div>
        </main>
      </div>
    </div>
  );
}
