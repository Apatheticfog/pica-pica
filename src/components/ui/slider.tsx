import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-valuetext": ariaValueText,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  const values = value ?? defaultValue ?? [min];
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn("relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Track data-slot="slider-track" className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/15">
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-white" />
      </SliderPrimitive.Track>
      {Array.from({ length: values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={ariaLabel && values.length > 1 ? `${ariaLabel} ${index + 1}` : ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-valuetext={ariaValueText}
          className="block size-3.5 shrink-0 rounded-full border-2 border-white bg-white shadow-[0_1px_5px_rgba(0,0,0,.55)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-white/55 disabled:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  );
}
