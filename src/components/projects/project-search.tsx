import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { BookOpenIcon, FileTextIcon, SearchIcon } from "lucide-react";
import { useRef, useState } from "react";
import { AppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Chapter_Serialize } from "@/lib/bindings";
import { useLocalProjects } from "@/lib/local-projects";

export function ProjectSearch({
  chapters = [],
  onChapter,
}: {
  chapters?: readonly Chapter_Serialize[];
  onChapter?: (chapter: Chapter_Serialize) => void;
}) {
  const { t } = useLingui();
  const { projects } = useLocalProjects();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLocaleLowerCase();
  const ordinal = /^\d+$/.test(keyword) ? Number(keyword) : null;
  const input = useRef<HTMLInputElement>(null);
  const label = t`全局搜索`;
  const matchingProjects = open
    ? projects
        .filter((project) =>
          project.title.toLocaleLowerCase().includes(keyword),
        )
        .slice(0, 40)
    : [];
  const matchingChapters = open
    ? chapters
        .filter((chapter, index) =>
          ordinal === null
            ? chapter.title.toLocaleLowerCase().includes(keyword)
            : index + 1 === ordinal,
        )
        .slice(0, 40)
    : [];
  const projectItems = matchingProjects.map((project) => ({
    key: `project:${project.id}`,
    title: project.title,
    type: t`工程`,
    icon: BookOpenIcon,
    select: () => {
      if (project.sourceCount === 0)
        void navigate({ to: "/new", search: { draft: project.id } });
      else void navigate({ to: "/project/$id", params: { id: project.id } });
    },
  }));
  const chapterItems = matchingChapters.map((chapter) => ({
    key: `chapter:${chapter.id}`,
    title: chapter.title,
    type: t`章节`,
    icon: FileTextIcon,
    select: () => onChapter?.(chapter),
  }));
  const items =
    ordinal === null
      ? [...projectItems, ...chapterItems]
      : [...chapterItems, ...projectItems];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setQuery("");
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={<Button size="icon-sm" variant="ghost" />}
        aria-label={label}
        title={label}
      >
        <SearchIcon />
      </DialogTrigger>
      <DialogContent initialFocus={input} scrollable="standard">
        <DialogTitle>{label}</DialogTitle>
        <Combobox<(typeof items)[number]>
          inline
          open
          autoHighlight
          items={items}
          filter={null}
          inputValue={query}
          onInputValueChange={setQuery}
          itemToStringLabel={(item) => item.title}
          itemToStringValue={(item) => item.key}
          onValueChange={(item) => {
            if (!item) return;
            setOpen(false);
            item.select();
          }}
        >
          <ComboboxInput
            ref={input}
            aria-label={label}
            placeholder={chapters.length ? t`搜索工程或章节` : t`搜索工程`}
            showTrigger={false}
          />
          <ComboboxEmpty className="[&:not(:empty)]:flex">
            <AppState
              kind="search"
              compact
              className="min-h-32"
              title={<Trans>没有匹配结果</Trans>}
            />
          </ComboboxEmpty>
          <ComboboxList
            aria-label={label}
            className="max-h-72 shrink overflow-y-auto"
          >
            {(item) => (
              <ComboboxItem key={item.key} value={item}>
                <item.icon />
                <span className="min-w-0 flex-1 truncate" title={item.title}>
                  {item.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.type}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </Combobox>
      </DialogContent>
    </Dialog>
  );
}
