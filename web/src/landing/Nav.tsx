import { AnimatePresence, motion } from "framer-motion"
import { useEffect, useState } from "react"
import { DOCS, README_START, REPO } from "./data"
import { Button, Mark, ease } from "./ui"

const LINKS = [
  { href: "#story", label: "Experience" },
  { href: "#hardware", label: "Hardware" },
  { href: DOCS, label: "Docs", ext: true },
  { href: REPO, label: "GitHub", ext: true },
]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener("scroll", on, { passive: true })
    return () => window.removeEventListener("scroll", on)
  }, [])
  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : ""
    return () => { document.documentElement.style.overflow = "" }
  }, [open])

  return (
    <>
      <motion.header className="nav" data-scrolled={scrolled} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.1 }}>
        <div className="wrap">
          <a className="brand" href="#top" aria-label="Flashlink home" onClick={() => setOpen(false)}>
            <Mark /> Flashlink
          </a>
          <nav aria-label="Primary">
            <ul>
              {LINKS.map((l) => (
                <li key={l.label}>
                  <a href={l.href} {...(l.ext ? { target: "_blank", rel: "noreferrer" } : {})}>{l.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="nav-right">
            <Button small primary href={README_START} target="_blank" rel="noreferrer">Get started</Button>
            <button className="menu-btn" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <span />
            </button>
          </div>
        </div>
      </motion.header>
      <AnimatePresence>
        {open && (
          <motion.div className="sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease }}>
            {[...LINKS, { href: README_START, label: "Get started", ext: true }].map((l, i) => (
              <motion.a
                key={l.label} className="row" href={l.href}
                {...("ext" in l && l.ext ? { target: "_blank", rel: "noreferrer" } : {})}
                onClick={() => setOpen(false)}
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease, delay: 0.05 + i * 0.05 }}
              >
                {l.label}
              </motion.a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
