import { useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { BookOpenIcon, HeadphonesIcon, UsersIcon } from "lucide-react";
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
import logoUrl from "../../assets/brand/logo.png";

export function AppSidebar({
  projectId,
  section = "chapters",
}: {
  projectId: string;
  section?: "chapters" | "characters" | "results";
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
    <Sidebar
      collapsible="none"
      className="border-sidebar-border sticky top-0 h-full shrink-0 border-r"
    >
      <SidebarHeader className="border-sidebar-border h-(--app-header-height) shrink-0 items-center justify-center border-b p-0">
        <Link
          to="/"
          aria-label="CastGlean"
          className="focus-visible:ring-ring flex size-10 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
        >
          <img src={logoUrl} alt="" className="size-8 object-contain" />
        </Link>
      </SidebarHeader>
      <SidebarContent className="items-center py-3">
        <nav
          aria-label={t({
            comment: "仅属于当前小说工程的业务导航",
            message: "工程导航",
          })}
        >
          <ul className="flex flex-col items-center gap-2">
            {nav.map((item) => (
              <li key={item.id}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant={item.id === section ? "selected" : "ghost"}
                        size="icon"
                        className="size-10"
                        nativeButton={false}
                        render={
                          <Link
                            to="/project/$id"
                            params={{ id: projectId }}
                            search={{ section: item.id }}
                            aria-current={
                              item.id === section ? "page" : undefined
                            }
                          />
                        }
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
    </Sidebar>
  );
}
