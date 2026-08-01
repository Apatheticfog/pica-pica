import { Gauge } from "lucide-react";
import { usePerformanceMode } from "./PerformanceModeProvider";

export function PerformanceModeToggle() {
  const { enabled, setEnabled } = usePerformanceMode();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Performance mode"
      title={enabled ? "Disable performance mode" : "Enable performance mode"}
      onClick={() => setEnabled(!enabled)}
      className="flex h-9 items-center gap-2 rounded-lg px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-white/[.045] hover:text-white focus-visible:ring-2 focus-visible:ring-primary/70"
    >
      <Gauge className="size-4" aria-hidden="true" />
      <span className="hidden lg:inline">Performance</span>
      <span
        aria-hidden="true"
        className={`relative inline-block h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 ${enabled ? "border-white/45 bg-white" : "border-white/15 bg-white/10"}`}
      >
        <span
          className={`absolute top-0.5 size-3.5 rounded-full transition-transform duration-150 ${enabled ? "translate-x-[17px] bg-black" : "translate-x-0.5 bg-white/65"}`}
        />
      </span>
    </button>
  );
}
