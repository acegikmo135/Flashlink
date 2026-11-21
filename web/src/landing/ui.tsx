import { motion, type HTMLMotionProps } from "framer-motion"
import type { ReactNode } from "react"

export const ease = [0.22, 1, 0.36, 1] as const

export function Arrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2 8h11M9 4l4 4-4 4" />
    </svg>
  )
}

type BtnProps = HTMLMotionProps<"a"> & { primary?: boolean; small?: boolean; children: ReactNode; arrow?: boolean }

/** Framer Motion owns button hover / press / entrance. */
export function Button({ primary, small, children, arrow, className = "", ...rest }: BtnProps) {
  return (
    <motion.a
      className={`btn ${primary ? "primary" : ""} ${small ? "sm" : ""} ${className}`}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97, y: 0 }}
      transition={{ duration: 0.18, ease }}
      {...rest}
    >
      {children}
      {arrow && <Arrow />}
    </motion.a>
  )
}

export function Mark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
      <path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3" />
      <circle cx="12" cy="12" r="1.6" fill="var(--accent)" stroke="none" />
    </svg>
  )
}
