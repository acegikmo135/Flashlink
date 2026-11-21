import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "@fontsource-variable/geist-pixel"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import "./landing.css"
import { Nav } from "./Nav"
import { Final, Hardware, Hero, Product, Proof, Story, setStop } from "./Scenes"
import { S } from "./scene/store"

gsap.registerPlugin(ScrollTrigger)
const SceneCanvas = lazy(() => import("./scene/SceneCanvas"))

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const PIN = [true, true, false, true, true, true]

function webglOk() {
  try {
    const c = document.createElement("canvas")
    return !!(c.getContext("webgl2") || c.getContext("webgl"))
  } catch { return false }
}

export default function LandingPage() {
  const root = useRef<HTMLDivElement>(null)
  const [mode] = useState<"gl" | "static">(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    S.reduced = reduced
    return reduced || !webglOk() ? "static" : "gl"
  })
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!ready) return
    if (S.reduced) { S.intro = 1; return }
    const tw = gsap.to(S, { intro: 1, duration: 2.8, ease: "power3.out" })
    return () => { tw.kill() }
  }, [ready])
  const offsets = useRef<{ top: number; h: number }[]>([])

  useEffect(() => {
    const prev = document.title
    document.title = "MCU Bridge — Give intelligence a physical connection"
    const el = document.documentElement
    const bg = el.style.backgroundColor
    el.style.backgroundColor = "#07090d"
    const bb = document.body.style.background
    document.body.style.background = "transparent"
    return () => { document.title = prev; el.style.backgroundColor = bg; document.body.style.background = bb }
  }, [])

  /* hero headline entrance + final headline + product reveals (GSAP) */
  useLayoutEffect(() => {
    const r = root.current!
    const ctx = gsap.context(() => {
      if (!S.reduced) {
        // Hero entrance is pure CSS (compositor-driven, immune to main-thread jank while WebGL boots).
        // Hero EXIT: scrubbed, clearly visible — lines lift out of their masks in sequence, then sub + CTAs.
        const end = () => "+=" + Math.round(window.innerHeight * 0.62)
        gsap.timeline({ scrollTrigger: { trigger: "#s0", start: "top top", end, scrub: 0.5 } })
          .to("#s0 .ln", { yPercent: -70, opacity: 0, stagger: 0.14, ease: "power1.in" }, 0)
          .to("#s0 .hero-sub", { y: -46, opacity: 0, ease: "power1.in" }, 0.12)
          .to("#s0 .cta-row", { y: -56, opacity: 0, ease: "power1.in" }, 0.2)
          .to("#s0 .hero-tag, #s0 .hero-scroll", { opacity: 0, ease: "none" }, 0)
        // Story arrives with the scroll: heading + first line rise in as the scene enters the viewport.
        gsap.from("#story .head", { y: 36, opacity: 0, duration: 1, ease: "power3.out", scrollTrigger: { trigger: "#story", start: "top 85%", once: true } })
        gsap.from("#final .w", { yPercent: 115, duration: 1.1, ease: "power4.out", stagger: 0.06, scrollTrigger: { trigger: "#final", start: "top 55%", once: true } })
        gsap.from("#final [data-final-fade]", { opacity: 0, y: 16, duration: 0.9, ease: "power3.out", stagger: 0.12, scrollTrigger: { trigger: "#final", start: "top 45%", once: true } })
        gsap.from("#product .big", { opacity: 0, y: 40, duration: 1.1, ease: "power3.out", scrollTrigger: { trigger: "#product", start: "top 70%", once: true } })
        gsap.utils.toArray<HTMLElement>("#product .fig").forEach((fig) => {
          const from = fig.dataset.reveal === "x" ? "inset(0 100% 0 0)" : "inset(100% 0 0 0)"
          const mask = fig.querySelector(".mask")!
          gsap.fromTo(mask, { clipPath: from }, { clipPath: "inset(0% 0% 0% 0%)", ease: "none", scrollTrigger: { trigger: fig, start: "top 88%", end: "top 48%", scrub: true } })
          gsap.fromTo(fig.querySelector("img"), { scale: 1.22 }, { scale: 1, ease: "none", scrollTrigger: { trigger: fig, start: "top 90%", end: "bottom 30%", scrub: true } })
          gsap.from(fig.querySelector("figcaption"), { opacity: 0, y: 12, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: fig, start: "top 55%", once: true } })
        })
        gsap.utils.toArray<HTMLElement>("#product .f2 .mask").forEach((m) => gsap.fromTo(m, { rotateY: -12 }, { rotateY: -5, ease: "none", scrollTrigger: { trigger: m, start: "top 90%", end: "bottom 20%", scrub: true } }))
      }
    }, r)
    return () => ctx.revert()
  }, [])

  /* scroll → global scene time + overlay painting */
  useLayoutEffect(() => {
    const r = root.current!
    const scenes = Array.from(r.querySelectorAll<HTMLElement>(".scene"))
    const measure = () => {
      const y = window.scrollY
      offsets.current = scenes.map((s) => { const b = s.getBoundingClientRect(); return { top: b.top + y, h: b.height } })
    }
    const wins = Array.from(r.querySelectorAll<HTMLElement>("[data-win]"))
    const ats = Array.from(r.querySelectorAll<HTMLElement>("[data-at]"))
    const hashes = Array.from(r.querySelectorAll<HTMLElement>("[data-hash]"))
    const vh = () => window.innerHeight
    let lastStop = -1

    const paint = () => {
      const y = window.scrollY, o = offsets.current
      if (!o.length) return
      let i = 0
      for (let n = 0; n < o.length; n++) if (y >= o[n].top - 1) i = n
      S.q = o.map((s, n) => {
        if (!PIN[n]) return clamp((y - s.top) / s.h)
        return clamp((y - s.top) / Math.max(1, s.h - vh()))
      })
      const { top, h } = o[i]
      let local: number
      if (PIN[i]) {
        const dist = Math.max(1, h - vh())
        const d = y - top
        local = d < dist ? clamp(d / dist) * 0.85 : 0.85 + 0.15 * clamp((d - dist) / vh())
      } else local = clamp((y - top) / h)
      S.t = i + local
      for (const w of wins) {
        const sc = Number(w.dataset.scene), [a, b] = w.dataset.win!.split(",").map(Number), q = S.q[sc]
        const op = clamp(Math.min((q - a) / 0.05, (b - q) / 0.05))
        w.style.opacity = String(op); w.style.transform = `translate3d(0,${(1 - op) * 22}px,0)`
      }
      for (const el of ats) {
        const sc = Number(el.dataset.scene)
        el.classList.toggle("on", S.q[sc] >= Number(el.dataset.at))
      }
      for (const el of hashes) {
        const q = S.q[4], a = Number(el.dataset.from), b = Number(el.dataset.to)
        const n = Math.round(clamp((q - a) / (b - a)) * 64)
        const full = el.textContent!.length === 64 ? el.textContent! : (el.dataset.full ||= el.textContent!)
        el.dataset.full = full
        el.textContent = full.slice(0, n).padEnd(64, "·")
      }
      const hq = S.q[3]
      const u = hq * 3, idx = clamp(Math.round(u), 0, 3)
      if (idx !== lastStop) { lastStop = idx; setStop(idx) }
    }

    if (mode === "static") return
    const st = ScrollTrigger.create({ start: 0, end: "max", onUpdate: paint, onRefresh: () => { measure(); paint() } })
    measure(); paint()
    const onResize = () => { measure(); paint() }
    window.addEventListener("resize", onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(r)
    return () => { st.kill(); window.removeEventListener("resize", onResize); ro.disconnect() }
  }, [mode])

  const goStop = useCallback((i: number) => {
    const o = offsets.current[3]
    if (!o) return
    const dist = o.h - window.innerHeight
    // stops are reached at q = i/3 of the pinned distance
    window.scrollTo({ top: o.top + (i / 3) * dist + 2, behavior: "smooth" })
  }, [])

  /* debug hook for visual review: ?t=3.4 */
  useEffect(() => {
    const t = new URLSearchParams(location.search).get("t")
    if (t) { (window as any).__FL = { S } }
  }, [])

  return (
    <div className={`lp ${mode === "static" ? "static" : ""} ${ready ? "ready" : ""}`} id="top" ref={root}>
      <div className="poster" aria-hidden="true" />
      {mode === "gl" && (
        <Suspense fallback={null}>
          <SceneCanvas onReady={() => setReady(true)} />
        </Suspense>
      )}
      <Nav />
      <main className="main">
        <Hero />
        <Story />
        <Product />
        <Hardware goStop={goStop} />
        <Proof />
        <Final />
      </main>
    </div>
  )
}
