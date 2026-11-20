export function Logo({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" className="fill-foreground" />
      <rect x="16" y="16" width="32" height="32" fill="none" strokeWidth="5" className="stroke-background" />
      <circle cx="32" cy="32" r="6" className="fill-background" />
    </svg>
  )
}

export function Brand() {
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-tight">
      <Logo />
      MCU Bridge
    </span>
  )
}
