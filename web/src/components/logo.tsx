/** The MCU Bridge mark on its ink tile: two bridge arches, the second one the blue signal. */
export function Logo({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#07090D" />
      <rect x=".5" y=".5" width="63" height="63" rx="13.5" fill="none" stroke="#ffffff" strokeOpacity=".12" />
      <g transform="translate(3.50 0.65) scale(0.2375)">
        
        <path d="M104 204V108A48 48 0 0 1 200 108V204H168V108A16 16 0 0 0 136 108V204Z" fill="#3185FF" />
        <path d="M40 204V108A48 48 0 0 1 136 108V204H104V108A16 16 0 0 0 72 108V204Z" fill="#F4F6F8" />
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
