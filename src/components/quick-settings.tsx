import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/use-theme";
import { dynamicActivate, isLocaleKey, locales } from "@/lib/i18n";

export function QuickSettings({
  active,
  labeled = false,
}: {
  active: boolean;
  labeled?: boolean;
}) {
  const { t, i18n } = useLingui();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  async function changeLanguage(value: string) {
    if (!isLocaleKey(value)) return;
    setLoading(true);
    setFailed(false);
    try {
      await dynamicActivate(value);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant={active || open ? "secondary" : "ghost"}
            size={labeled ? "default" : "icon"}
            className={labeled ? "w-full justify-start" : "size-10"}
            aria-label={t({
              comment: "底部应用设置菜单入口",
              message: "快捷设置",
            })}
            title={t({ comment: "应用设置入口", message: "设置" })}
          />
        }
      >
        <SettingsIcon data-icon={labeled ? "inline-start" : undefined} />
        {labeled && (
          <span className="max-sm:hidden">
            <Trans comment="首页底部的应用设置提示">应用设置</Trans>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={12}
        className="w-56"
        aria-label={t({
          comment: "单层应用偏好菜单的无障碍名称",
          message: "快捷设置",
        })}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans comment="外观选择框标签">主题</Trans>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              setTheme(value);
              setOpen(false);
            }}
          >
            <DropdownMenuRadioItem value="light" className="min-h-9">
              <SunIcon />
              <Trans comment="应用外观选项">浅色</Trans>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" className="min-h-9">
              <MoonIcon />
              <Trans comment="应用外观选项">深色</Trans>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans comment="界面语言选择标签">语言</Trans>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={i18n.locale}
            onValueChange={(value) => void changeLanguage(value)}
          >
            {Object.entries(locales).map(([value, label]) => (
              <DropdownMenuRadioItem
                key={value}
                value={value}
                disabled={loading}
                closeOnClick={false}
                className="min-h-9"
              >
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {failed && (
          <p role="alert" className="text-destructive px-2 py-1 text-xs">
            <Trans>语言切换失败，请重试。</Trans>
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="min-h-9"
            render={<Link to="/settings" />}
            onClick={() => setOpen(false)}
          >
            <SettingsIcon />
            <Trans comment="打开包含模型、存储等全部设置的页面">完整设置</Trans>
            <ChevronRightIcon className="ml-auto" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
