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

/** The MCU Bridge mark: two bridge arches — the first ink, the second the blue signal. */
export function Mark() {
  return (
    <svg viewBox="32 52 176 160" aria-hidden="true">
      
      <path d="M104 204V108A48 48 0 0 1 200 108V204H168V108A16 16 0 0 0 136 108V204Z" fill="var(--accent)" />
      <path d="M40 204V108A48 48 0 0 1 136 108V204H104V108A16 16 0 0 0 72 108V204Z" fill="currentColor" />
    </svg>
  )
}
