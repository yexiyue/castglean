import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "cn";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": label,
  getAriaValueText,
  ...props
}: SliderPrimitive.Root.Props & {
  getAriaValueText?: SliderPrimitive.Thumb.Props["getAriaValueText"];
}) {
  const current = value ?? defaultValue ?? min;
  const values = Array.isArray(current) ? current : [current];

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="bg-muted relative grow overflow-hidden rounded-full select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {values.map((_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-label={label}
            getAriaValueText={getAriaValueText}
            // biome-ignore lint/suspicious/noArrayIndexKey: Thumb identity is its fixed position, not its changing value; preserve focus while dragging.
            key={index}
            className="border-ring ring-ring/50 bg-card relative block size-3 shrink-0 rounded-full border transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 active:ring-3 disabled:pointer-events-none disabled:opacity-50 has-[:focus-visible]:ring-3 has-[:focus-visible]:outline-hidden"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
