import { useRef } from "react";
import { cn } from "@/lib/utils";

export function PanelResizeHandle({
  label,
  value,
  min,
  max,
  direction = 1,
  onChange,
  hidden,
  className = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  direction?: number;
  onChange: (value: number) => void;
  hidden?: boolean;
  className?: string;
}) {
  const drag = useRef<{ x: number; value: number } | null>(null);
  const resize = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  if (hidden) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: An interactive splitter needs pointer capture and keyboard resizing, not a document rule.
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn(
        "hover:bg-accent/30 focus-visible:bg-accent/30 z-10 w-1 shrink-0 cursor-col-resize touch-none",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          resize(value + (event.key === "ArrowRight" ? 16 : -16) * direction);
        }
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          resize(event.key === "Home" ? min : max);
        }
      }}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          resize(
            drag.current.value + (event.clientX - drag.current.x) * direction,
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
