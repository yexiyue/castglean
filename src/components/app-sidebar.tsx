import { useLingui } from "@lingui/react/macro";
import { BookOpenIcon, HeadphonesIcon, UsersIcon } from "lucide-react";
import { RailFooter, RailHomeLink } from "@/components/app-header-actions";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AppSidebar({
  section = "chapters",
  onSectionChange,
}: {
  section?: "chapters" | "characters" | "results";
  onSectionChange: (section: "chapters" | "characters" | "results") => void;
}) {
  const { t } = useLingui();
  const nav = [
    {
      id: "chapters" as const,
      label: t({
        comment: "当前工程的章节与正文制作入口",
        message: "章节制作",
      }),
      icon: BookOpenIcon,
    },
    {
      id: "characters" as const,
      label: t({
        comment: "当前工程内稳定角色身份与选声列表",
        message: "工程角色",
      }),
      icon: UsersIcon,
    },
    {
      id: "results" as const,
      label: t({
        comment: "当前工程的音频采用与导出结果",
        message: "制作结果",
      }),
      icon: HeadphonesIcon,
    },
  ];
  return (
    <Sidebar collapsible="none" className="sticky top-0 h-full shrink-0">
      <SidebarHeader className="h-(--app-header-height) shrink-0 items-center justify-center p-0">
        <RailHomeLink />
      </SidebarHeader>
      <SidebarContent className="items-center px-1 py-3">
        <nav
          className="w-full"
          aria-label={t({
            comment: "仅属于当前小说工程的业务导航",
            message: "工程导航",
          })}
        >
          <ul className="flex w-full flex-col items-center gap-1">
            {nav.map((item) => (
              <li key={item.id}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant={item.id === section ? "secondary" : "ghost"}
                        size="icon-lg"
                        onClick={() => onSectionChange(item.id)}
                        aria-current={item.id === section ? "page" : undefined}
                        aria-label={item.label}
                      />
                    }
                  >
                    <item.icon />
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10}>
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        </nav>
      </SidebarContent>
      <RailFooter />
    </Sidebar>
  );
}
