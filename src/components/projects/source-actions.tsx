import { useLingui } from "@lingui/react/macro";
import {
  BookOpenIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  QuoteIcon,
  ScissorsIcon,
  UserRoundCheckIcon,
} from "lucide-react";
import {
  type ComponentProps,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  type SegmentPlayback,
  type SegmentSpeaker,
  speakerLabel,
} from "@/components/analysis/role-source-block";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ByteRange, Segment } from "@/lib/bindings";
import { segmentPending } from "@/lib/chapter-audio";
import {
  sourceByteSelection,
  sourceSelection,
} from "@/lib/projects/source-selection";

type Selection = NonNullable<ReturnType<typeof sourceSelection>>;
type Target =
  | { kind: "line"; anchor: HTMLElement; line: number }
  | {
      kind: "segment";
      anchor: HTMLElement;
      line: number;
      segment: Segment;
      pinned: boolean;
    }
  | {
      kind: "selection";
      anchor: Range;
      selection: Selection | null;
      range: ByteRange | null;
    };

export function useSourceActions(
  viewport: RefObject<HTMLDivElement | null>,
  chapterId: string,
  visible: boolean,
) {
  const [current, setCurrent] = useState<{
    chapterId: string;
    target: Target;
  } | null>(null);
  const target =
    visible && current?.chapterId === chapterId ? current.target : null;
  const dragging = useRef(false);
  const dismissedAnchor = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimer = () => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (target: Target) => setCurrent({ chapterId, target });
  const dismiss = () => {
    if (target?.kind === "segment") dismissedAnchor.current = target.anchor;
    cancelTimer();
    setCurrent(null);
  };
  useEffect(() => {
    if (!visible) return;
    function updateSelection() {
      if (dragging.current) return;
      const selection = sourceSelection(viewport.current);
      const bytes = sourceByteSelection(viewport.current);
      const range =
        selection || bytes ? window.getSelection()?.getRangeAt(0) : null;
      if (range) {
        if (timer.current != null) clearTimeout(timer.current);
        setCurrent({
          chapterId,
          target: {
            kind: "selection",
            selection,
            range: bytes,
            anchor: range.cloneRange(),
          },
        });
      } else {
        setCurrent((current) =>
          current?.target.kind === "selection" ? null : current,
        );
      }
    }
    function pointerDown(event: PointerEvent) {
      if (
        !(event.target instanceof Node) ||
        !viewport.current?.contains(event.target)
      )
        return;
      dragging.current = true;
      setCurrent((current) =>
        current?.target.kind === "segment" && !current.target.pinned
          ? null
          : current,
      );
      if (timer.current != null) clearTimeout(timer.current);
    }
    function pointerEnd() {
      if (!dragging.current) return;
      dragging.current = false;
      updateSelection();
    }
    function scrolled() {
      setCurrent((current) => {
        const target = current?.target;
        if (!target || target.kind === "selection") return current;
        if (target.kind === "segment" && !target.pinned) return null;
        const view = viewport.current?.getBoundingClientRect();
        const anchor = target.anchor.getBoundingClientRect();
        return view &&
          target.anchor.isConnected &&
          anchor.bottom > view.top &&
          anchor.top < view.bottom
          ? current
          : null;
      });
    }
    const reader = viewport.current;
    document.addEventListener("selectionchange", updateSelection);
    document.addEventListener("pointerdown", pointerDown);
    window.addEventListener("pointerup", pointerEnd);
    window.addEventListener("pointercancel", pointerEnd);
    reader?.addEventListener("scroll", scrolled);
    return () => {
      dragging.current = false;
      if (timer.current != null) clearTimeout(timer.current);
      document.removeEventListener("selectionchange", updateSelection);
      document.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("pointerup", pointerEnd);
      window.removeEventListener("pointercancel", pointerEnd);
      reader?.removeEventListener("scroll", scrolled);
    };
  }, [chapterId, viewport, visible]);
  return {
    target,
    viewport,
    dismiss,
    cancelTimer,
    show,
    hover(segment: Segment, anchor: HTMLElement, line: number) {
      if (
        dragging.current ||
        dismissedAnchor.current === anchor ||
        target?.kind === "selection" ||
        (target?.kind === "segment" && target.pinned) ||
        sourceSelection(viewport.current)
      )
        return;
      cancelTimer();
      timer.current = setTimeout(() => {
        if (anchor.isConnected && !sourceSelection(viewport.current))
          show({ kind: "segment", segment, anchor, line, pinned: false });
      }, 180);
    },
    leave() {
      dismissedAnchor.current = null;
      cancelTimer();
      timer.current = setTimeout(() => {
        setCurrent((current) =>
          current?.target.kind === "segment" && !current.target.pinned
            ? null
            : current,
        );
      }, 240);
    },
  };
}

function SourceTool({
  label,
  children,
  disabled,
  onClick,
  onPointerDown,
  shortcut,
}: Pick<
  ComponentProps<typeof Button>,
  "children" | "disabled" | "onClick" | "onPointerDown"
> & {
  label: string;
  shortcut?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            aria-keyshortcuts={shortcut}
            focusableWhenDisabled
            disabled={disabled}
            onClick={onClick}
            onPointerDown={onPointerDown}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function SourceActions({
  actions,
  characters,
  playback,
  boundary,
  onReference,
  onAssign,
  onEdit,
}: {
  actions: ReturnType<typeof useSourceActions>;
  characters: SegmentSpeaker[];
  playback: SegmentPlayback | null;
  boundary: (line: number) => {
    label: string;
    run: () => void;
    disabled: boolean;
  };
  onReference: (selection: Selection) => void;
  onAssign?: (range: ByteRange) => void;
  onEdit: (segment: Segment) => void;
}) {
  const { t } = useLingui();
  const { target, dismiss } = actions;
  const element = target?.anchor;
  const connected =
    element instanceof HTMLElement
      ? element.isConnected
      : element?.startContainer.isConnected;
  const selectionAnchor =
    target?.kind === "selection"
      ? {
          getBoundingClientRect: () => {
            const range = target.anchor.getBoundingClientRect();
            const view = actions.viewport.current?.getBoundingClientRect();
            if (!view) return range;
            const left = Math.max(
              view.left + 8,
              Math.min(range.left, view.right - 8),
            );
            const right = Math.max(left, Math.min(range.right, view.right - 8));
            const top = Math.max(
              view.top + 8,
              Math.min(range.top, view.bottom - 8),
            );
            const bottom = Math.max(
              top,
              Math.min(range.bottom, view.bottom - 8),
            );
            return new DOMRect(left, top, right - left, bottom - top);
          },
          contextElement:
            target.anchor.startContainer.parentElement ?? undefined,
        }
      : undefined;
  const line =
    target?.kind === "selection" ? target.selection?.line : target?.line;
  const lineAction = line === undefined ? null : boundary(line);
  const segment = target?.kind === "segment" ? target.segment : null;
  const pending = segment && segmentPending(segment);
  const speaking = segment?.id === playback?.playingId && playback?.playing;
  const label =
    segment &&
    speakerLabel(segment, characters, {
      narrator: t`旁白`,
      unknown: t`未知`,
      ambiguous: t`歧义`,
      unassigned: t`未标注`,
    });
  const focusPanel =
    target?.kind === "line" || (target?.kind === "segment" && target.pinned);
  const popup = useRef<HTMLDivElement>(null);
  function assignSelection() {
    if (target?.kind !== "selection" || !target.range || !onAssign) return;
    window.getSelection()?.removeAllRanges();
    dismiss();
    onAssign(target.range);
  }
  const handleAssignShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.isComposing ||
      event.repeat ||
      event.key !== "Enter" ||
      !event.altKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      target?.kind !== "selection" ||
      !target.range ||
      !onAssign ||
      !actions.viewport.current?.contains(document.activeElement)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    assignSelection();
  });
  const dismissOnEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing || !popup.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (popup.current.contains(document.activeElement)) {
      const restore =
        element instanceof HTMLElement && element.isConnected
          ? element
          : actions.viewport.current;
      restore?.focus({ preventScroll: true });
    }
    dismiss();
  });
  useEffect(() => {
    if (!target || !connected) return;
    // A nested tooltip can otherwise consume Escape before the floating toolbar sees it.
    const onKeyDown = (event: KeyboardEvent) => {
      handleAssignShortcut(event);
      dismissOnEscape(event);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [target, connected]);
  return (
    <Popover
      open={!!target && !!connected}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      {target && (
        <PopoverContent
          key={target.kind}
          ref={popup}
          data-source-actions={target.kind}
          anchor={
            selectionAnchor ??
            (element instanceof HTMLElement ? element : undefined)
          }
          initialFocus={focusPanel ? undefined : false}
          finalFocus={() =>
            focusPanel && element instanceof HTMLElement && element.isConnected
              ? element
              : false
          }
          side="top"
          collisionBoundary={actions.viewport.current ?? undefined}
          align="start"
          className="w-max max-w-(--available-width) flex-row items-center gap-1.5 p-1 select-none"
          onPointerEnter={actions.cancelTimer}
          onPointerLeave={actions.leave}
          onFocus={actions.cancelTimer}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              actions.leave();
          }}
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 px-1.5 py-0.5">
            <PopoverTitle
              className="min-w-0 truncate text-xs font-medium"
              title={label ?? undefined}
            >
              {segment
                ? label
                : target.kind === "selection"
                  ? t`选中的原文`
                  : t`第 ${(line ?? 0) + 1} 行`}
            </PopoverTitle>
            {segment && segment.kind !== "unassigned" && (
              <span className="text-xs text-muted-foreground">
                {segment.kind === "speech"
                  ? t`台词`
                  : segment.kind === "thought"
                    ? t`内心独白`
                    : t`旁白`}
                {pending && <> · {t`归属待确认`}</>}
              </span>
            )}
          </div>
          <Separator orientation="vertical" className="my-1.5" />
          <TooltipProvider delay={300}>
            <div className="flex shrink-0 items-center gap-0.5">
              {segment && playback?.playable.has(segment.id) && (
                <SourceTool
                  label={
                    speaking
                      ? t`暂停此片段`
                      : segment.id === playback.playingId
                        ? t`继续播放此片段`
                        : t`播放此片段`
                  }
                  onClick={() => playback.toggle(segment.id)}
                >
                  {speaking ? <PauseIcon /> : <PlayIcon />}
                </SourceTool>
              )}
              {segment && (
                <SourceTool
                  label={pending ? t`修正归属` : t`片段属性`}
                  onClick={() => {
                    dismiss();
                    onEdit(segment);
                  }}
                >
                  <PencilIcon />
                </SourceTool>
              )}
              {target.kind === "selection" && target.range && onAssign && (
                <SourceTool
                  label={t({
                    comment: "Assign a speaker to the selected manuscript text",
                    message: "归属给角色",
                  })}
                  shortcut="Alt+Enter"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={assignSelection}
                >
                  <UserRoundCheckIcon />
                </SourceTool>
              )}
              {target.kind === "selection" && target.selection && (
                <SourceTool
                  label={t`引用选中的原文`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    dismiss();
                    if (target.selection) onReference(target.selection);
                  }}
                >
                  <QuoteIcon />
                </SourceTool>
              )}
              {lineAction && !segment && (
                <SourceTool
                  label={lineAction.label}
                  disabled={lineAction.disabled}
                  onPointerDown={(event) => {
                    if (target.kind === "selection") event.preventDefault();
                  }}
                  onClick={() => {
                    dismiss();
                    lineAction.run();
                  }}
                >
                  {lineAction.label === t`合并此章` ? (
                    <BookOpenIcon />
                  ) : (
                    <ScissorsIcon />
                  )}
                </SourceTool>
              )}
            </div>
          </TooltipProvider>
        </PopoverContent>
      )}
    </Popover>
  );
}
