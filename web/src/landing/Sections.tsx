import { AnimatePresence, motion } from "framer-motion"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useLayoutEffect, useRef, useState } from "react"
import { CAPS, DOCS, DOCS_BOARDS, DOCS_SECURITY, GAP, HW, JOURNEY, REPO, SECURITY, SHOTS } from "./data"
import { Arrow, Button, ease } from "./ui"

gsap.registerPlugin(ScrollTrigger)

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** Gentle scroll reveals (GSAP). Applies to any element with [data-rv] inside the section. */
function useReveal(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    if (reduced()) return
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-rv]").forEach((el) => {
        gsap.from(el, {
          opacity: 0, y: 28, duration: 1, ease: "power3.out", delay: Number(el.dataset.rv) || 0,
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
        })
      })
    }, ref)
    return () => ctx.revert()
  }, [ref])
}

export function Gap() {
  const ref = useRef<HTMLElement>(null)
  useReveal(ref)
  useLayoutEffect(() => {
    if (reduced()) return
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(".gap-line").forEach((el) => {
        gsap.fromTo(el, { opacity: 0.28 }, { opacity: 1, ease: "none", scrollTrigger: { trigger: el, start: "top 82%", end: "top 55%", scrub: true } })
      })
    }, ref)
    return () => ctx.revert()
  }, [])
  return (
    <section className="sec" ref={ref} id="problem">
      <div className="wrap">
        <p className="eyebrow" data-rv><b>00</b>The gap</p>
        <h2 className="h2" data-rv="0.08" style={{ marginTop: 22, maxWidth: "18ch" }}>Writing firmware was never the hard part.</h2>
        <div className="gap-lines">
          {GAP.map((g, i) => (
            <div className="gap-line" key={g.t}>
              <span className="n">0{i + 1}</span>
              <span className="t">{g.t}</span>
              <span className="m">{g.m}</span>
            </div>
          ))}
        </div>
        <p className="gap-end" data-rv>The bridge closes the loop, and tells you <span>what actually happened.</span></p>
      </div>
    </section>
  )
}

export function Journey() {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const root = ref.current!
    const ctx = gsap.context(() => {
      const items = gsap.utils.toArray<HTMLElement>(".jr-rail li")
      const k = root.querySelector<HTMLElement>(".jr-now .k")!
      const h = root.querySelector<HTMLElement>(".jr-now h3")!
      const p = root.querySelector<HTMLElement>(".jr-now p")!
      const prog = root.querySelector<HTMLElement>(".jr-prog")!
      const set = (i: number) => {
        items.forEach((li, n) => (li.dataset.s = n < i ? "done" : n === i ? "now" : "idle"))
        const s = JOURNEY[i]
        k.textContent = `0${i + 1} / 0${JOURNEY.length}`
        h.textContent = s.h
        p.textContent = s.p
        gsap.fromTo([h, p], { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out", stagger: 0.05, overwrite: true })
      }
      const mm = gsap.matchMedia()
      mm.add("(min-width: 1001px) and (prefers-reduced-motion: no-preference)", () => {
        set(0)
        let cur = 0
        ScrollTrigger.create({
          trigger: ".jr-stage", start: "top top", end: `+=${JOURNEY.length * 60}%`, pin: true, scrub: 0.4, anticipatePin: 1,
          onUpdate: (self) => {
            gsap.set(prog, { scaleY: self.progress })
            const i = Math.min(JOURNEY.length - 1, Math.floor(self.progress * JOURNEY.length * 0.999))
            if (i !== cur) { cur = i; set(i) }
          },
        })
      })
      mm.add("(min-width: 1001px) and (prefers-reduced-motion: reduce)", () => {
        // static: everything shown, no pinning
        items.forEach((li) => (li.dataset.s = "done"))
        gsap.set(prog, { scaleY: 1 })
        k.textContent = `0${JOURNEY.length} / 0${JOURNEY.length}`
        h.textContent = JOURNEY[JOURNEY.length - 1].h
        p.textContent = JOURNEY[JOURNEY.length - 1].p
      })
      mm.add("(max-width: 1000px)", () => {
        gsap.set(prog, { scaleY: 1 })
        items.forEach((li) => (li.dataset.s = "done"))
      })
    }, ref)
    return () => ctx.revert()
  }, [])
  return (
    <section className="journey" id="architecture" ref={ref}>
      <div className="jr-stage">
        <div className="wrap jr-grid">
          <div className="jr-head">
            <p className="eyebrow"><b>01</b>Architecture</p>
            <h2 className="h2" style={{ marginTop: 22 }}>One instruction. <em>A real device.</em></h2>
            <p className="lead">Eight hops between a sentence and a chip, and each one is checked.</p>
            <div className="jr-now" aria-live="off">
              <div className="k" />
              <h3 />
              <p />
            </div>
            <a className="docs-link" href="https://github.com/acegikmo135/Flashlink/blob/main/docs/architecture.md" target="_blank" rel="noreferrer">Read the architecture <Arrow /></a>
          </div>
          <ol className="jr-rail">
            <div className="jr-prog" />
            {JOURNEY.map((s, i) => (
              <li key={s.nm} data-s="idle" className={i === JOURNEY.length - 1 ? "final" : ""}>
                <span className="pip" />
                <span className="nm">{s.nm}</span>
                <span className="tg">{s.tg}</span>
                <span className="ds">{s.p}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

export function Product() {
  const ref = useRef<HTMLElement>(null)
  useReveal(ref)
  const [i, setI] = useState(0)
  const s = SHOTS[i]
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setI((v) => (v + 1) % SHOTS.length)
    if (e.key === "ArrowLeft") setI((v) => (v + SHOTS.length - 1) % SHOTS.length)
  }
  return (
    <section className="sec" id="product" ref={ref}>
      <div className="wrap">
        <p className="eyebrow" data-rv><b>02</b>The product</p>
        <h2 className="h2" data-rv="0.08" style={{ marginTop: 22, maxWidth: "20ch" }}>A dashboard that tells the truth about your bench.</h2>
        <div className="tabs" role="tablist" aria-label="Product views" onKeyDown={onKey} data-rv="0.12">
          {SHOTS.map((t, n) => (
            <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={n === i} aria-controls="shot-panel" tabIndex={n === i ? 0 : -1} className="tab" onClick={() => setI(n)}>
              {t.tab}
              {n === i && <motion.span className="bar" layoutId="tab-bar" transition={{ duration: 0.35, ease }} />}
            </button>
          ))}
        </div>
        <div className="shot-grid" id="shot-panel" role="tabpanel" aria-labelledby={`tab-${s.id}`}>
          <AnimatePresence mode="wait">
            <motion.div key={s.id + "c"} className="shot-cap" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease }}>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
              <ul>{s.b.map((x) => <li key={x}>{x}</li>)}</ul>
            </motion.div>
          </AnimatePresence>
          <div>
            <div className="shot">
              <AnimatePresence mode="popLayout">
                <motion.img key={s.id} src={s.img} alt={`MCU Bridge dashboard, ${s.tab} view`} width={2160} height={1350} loading="lazy"
                  initial={{ opacity: 0, scale: 1.015 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5, ease }} />
              </AnimatePresence>
            </div>
            <p className="note">Real dashboard UI. Boards, names and jobs shown are sample data.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Capabilities() {
  const ref = useRef<HTMLElement>(null)
  useReveal(ref)
  return (
    <section className="sec" ref={ref}>
      <div className="wrap">
        <p className="eyebrow" data-rv><b>03</b>What the assistant can do</p>
        <h2 className="h2" data-rv="0.08" style={{ marginTop: 22, maxWidth: "20ch" }}>Twenty tools. <em>Four jobs.</em></h2>
        <div className="caps">
          {CAPS.map((c, n) => (
            <div className="cap" key={c.k} data-rv>
              <h3><span className="idx">0{n + 1}</span>{c.k}</h3>
              <div>
                <p>{c.p}</p>
                <div className="tools">{c.tools.map((t) => <span key={t}>{t}</span>)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Hardware() {
  const ref = useRef<HTMLElement>(null)
  useReveal(ref)
  const label = ["", "Verified on real hardware", "Implemented, awaiting validation", "Unit-tested only"]
  return (
    <section className="sec" id="hardware" ref={ref}>
      <div className="wrap">
        <p className="eyebrow" data-rv><b>04</b>Hardware</p>
        <h2 className="h2" data-rv="0.08" style={{ marginTop: 22, maxWidth: "20ch" }}>Honest about what has touched real silicon.</h2>
        <p className="lead" data-rv="0.12" style={{ marginTop: 22 }}>Support is a claim, so each family says how far it has actually been tested.</p>
        <div className="hw">
          <div className="hw-key" data-rv>
            <span className="tier t1"><i />Verified on real hardware</span>
            <span className="tier t2"><i />Implemented, awaiting validation</span>
            <span className="tier t3"><i />Unit-tested only</span>
          </div>
          {HW.map((h) => (
            <div className="hw-row" key={h.fam} data-rv>
              <span className="fam">{h.fam}</span>
              <span className="bd">{h.bd}</span>
              <span className="st">
                <span className={`tier t${h.tier}`}><i />{label[h.tier]}</span>
                <span>{h.note}</span>
              </span>
            </div>
          ))}
          <p className="hw-foot">ESP32-C6/H2/P4, RP2040 and nRF are not supported yet. <a href={DOCS_BOARDS} target="_blank" rel="noreferrer" style={{ color: "var(--fg)", borderBottom: "1px solid var(--line-2)" }}>Full list and limits</a>.</p>
        </div>
      </div>
    </section>
  )
}

export function Security() {
  const ref = useRef<HTMLElement>(null)
  useReveal(ref)
  return (
    <section className="sec" ref={ref}>
      <div className="wrap sec-grid">
        <div>
          <p className="eyebrow" data-rv><b>05</b>Security</p>
          <h2 className="h2" data-rv="0.08" style={{ marginTop: 22 }}>Firmware moves. <em>It doesn’t stay.</em></h2>
          <p className="retain" data-rv="0.12">
            <b>What is kept.</b> Cloud compile sends your sketch source to a public Arduino build service, so do not compile secrets. Each build’s source text is kept in your own build history so it can be re-flashed, and you can remove it any time with <span className="mono">delete_build</span>.
          </p>
          <a className="docs-link" data-rv="0.16" href={DOCS_SECURITY} target="_blank" rel="noreferrer">Read the security model <Arrow /></a>
        </div>
        <div className="sec-list">
          {SECURITY.map((s) => (
            <div className="sec-item" key={s.h} data-rv>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Start() {
  const ref = useRef<HTMLElement>(null)
  useReveal(ref)
  return (
    <section className="sec" id="start" ref={ref}>
      <div className="wrap">
        <p className="eyebrow" data-rv><b>06</b>Get started</p>
        <h2 className="h2" data-rv="0.08" style={{ marginTop: 22, maxWidth: "18ch" }}>Three steps. About ten minutes.</h2>
        <p className="lead" data-rv="0.12" style={{ marginTop: 22 }}>You need a free Cloudflare account, a Windows 10 or 11 PC with a board plugged in, and an AI chat that supports MCP connectors.</p>
        <div className="steps">
          <div className="step" data-rv>
            <div><span className="n">01</span><h3>Deploy your cloud</h3><p>Once. The script creates the database, deploys the Worker and prints your URL and an invite code.</p></div>
            <pre className="term"><span className="p">$ </span><span className="c">git clone https://github.com/acegikmo135/Flashlink.git</span>{"\n"}<span className="p">$ </span><span className="c">cd Flashlink</span>{"\n"}<span className="p">$ </span><span className="c">node scripts/setup.mjs</span></pre>
          </div>
          <div className="step" data-rv>
            <div><span className="n">02</span><h3>Install the Windows app</h3><p>A per-user install with no admin rights. Pair it from the link it shows, press Approve, and it lives in your tray.</p></div>
            <div>
              <div className="term"><span className="c">MCUBridge-Setup.exe</span>{"\n"}<span className="p">Unsigned build: SmartScreen may say “More info, Run anyway”.</span></div>
              <a className="docs-link" href="https://github.com/acegikmo135/Flashlink/releases/tag/desktop-latest" target="_blank" rel="noreferrer">Get the installer from GitHub Releases <Arrow /></a>
            </div>
          </div>
          <div className="step" data-rv>
            <div><span className="n">03</span><h3>Connect your AI</h3><p>Add your Worker as a custom connector and sign in once. No token to copy.</p></div>
            <pre className="term"><span className="p"># claude.ai · ChatGPT · Gemini</span>{"\n"}<span className="c">Settings → Connectors → Add custom connector</span>{"\n"}<span className="c">https://&lt;your-worker&gt;/mcp</span>{"\n\n"}<span className="p"># Claude Code</span>{"\n"}<span className="p">$ </span><span className="c">claude mcp add --transport http mcu-bridge https://&lt;your-worker&gt;/mcp \{"\n"}    --header "Authorization: Bearer &lt;token&gt;"</span></pre>
          </div>
        </div>
        <a className="docs-link" data-rv href={DOCS} target="_blank" rel="noreferrer">Full setup guide <Arrow /></a>
      </div>
    </section>
  )
}

export function Final() {
  return (
    <section className="final sec" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="wrap">
        <h2>Your next firmware update<br /><em>starts with a conversation.</em></h2>
        <div className="cta-row">
          <Button primary arrow href="#start">Get started</Button>
          <Button href={REPO} target="_blank" rel="noreferrer">View on GitHub</Button>
        </div>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer>
      <div className="wrap">
        <span>Flashlink · MCU Bridge · MIT licensed</span>
        <nav aria-label="Footer">
          <a href={DOCS} target="_blank" rel="noreferrer">Docs</a>
          <a href={DOCS_BOARDS} target="_blank" rel="noreferrer">Supported boards</a>
          <a href={DOCS_SECURITY} target="_blank" rel="noreferrer">Security</a>
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          <a href="/login">Sign in</a>
        </nav>
      </div>
    </footer>
  )
}
