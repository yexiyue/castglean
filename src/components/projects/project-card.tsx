import type { ReactNode } from "react";
import type { LocalProjectListItem } from "@/lib/bindings";

/** 书名首字作为卡片标识；标题为空时退到一个中性点。 */
function titleInitial(title: string) {
  return title.trim().charAt(0) || "·";
}

/**
 * 工程卡片的标识与标题区：首字标识块 + 标题 + 章数或续导提示。
 * 卡片本身是链接，这里只负责内容。
 */
export function ProjectCardContent({
  project,
  hint,
}: {
  project: LocalProjectListItem;
  hint: ReactNode;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-item bg-accent text-base font-medium text-accent-foreground"
      >
        {titleInitial(project.title)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {project.title}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground tabular-nums">
          {hint}
        </span>
        {project.description ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {project.description}
          </span>
        ) : null}
      </span>
    </>
  );
}
