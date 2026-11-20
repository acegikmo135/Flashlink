import { cn } from "@/lib/utils"

/** iOS-style segmented control with a sliding thumb. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode; aria?: string }[]
  className?: string
  size?: "sm" | "md"
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div role="radiogroup" className={cn("relative grid rounded-full bg-secondary p-[3px]", size === "sm" ? "text-xs" : "text-sm", className)} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-[3px] left-[3px] rounded-full bg-card shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-500 [transition-timing-function:var(--spring)] dark:bg-[#636366]"
        style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.aria}
          onClick={() => onChange(o.value)}
          className={cn("relative z-10 flex items-center justify-center gap-1.5 rounded-full px-3 font-medium transition-colors duration-200", size === "sm" ? "py-1" : "py-1.5", o.value === value ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
