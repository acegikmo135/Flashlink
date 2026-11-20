export function Logo({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#007aff" />
      <g fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="14" y="14" width="36" height="36" rx="7" />
        <path d="M24 8v6M32 8v6M40 8v6M24 50v6M32 50v6M40 50v6M8 24h6M8 32h6M8 40h6M50 24h6M50 32h6M50 40h6" strokeWidth="3" />
        <path d="M25 39a5 5 0 0 1-.6-9.9 7.5 7.5 0 0 1 14.2 1.3A4.3 4.3 0 0 1 38 39z" strokeWidth="3" />
      </g>
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
