import { AnimatePresence, motion } from "framer-motion"
import { useSyncExternalStore } from "react"
import { BOARDS, DOCS, DOCS_BOARDS, DOCS_SECURITY, HASH_SENT, README_START, REPO, TIER } from "./data"
import { Button, ease } from "./ui"

/* tiny external store for the hardware stop index (written by scroll, read by React/Framer) */
let stop = 0
const subs = new Set<() => void>()
export const setStop = (i: number) => { if (i !== stop) { stop = i; subs.forEach((f) => f()) } }
const useStop = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => stop)

const Words = ({ text }: { text: string }) => (
  <>
    {text.split(" ").map((w, i) => (
      <span key={i}><span className="wi"><span className="w">{w}</span></span>{" "}</span>
    ))}
  </>
)

/* ---------------- 01 · the connection ---------------- */
export function Hero() {
  return (
    <section id="s0" className="scene" data-scene="0">
      <div className="pin hero">
        <div className="hero-copy" data-win="-1,0.42" data-scene="0">
          <h1 aria-label="Give intelligence a physical connection.">
            <span className="ln" aria-hidden="true"><Words text="Give intelligence" /></span>
            <span className="ln" aria-hidden="true"><Words text="a" /><span className="wi"><span className="w"><em>physical</em></span></span>{" "}<Words text="connection." /></span>
          </h1>
          <p className="hero-sub">An MCP-powered bridge between your AI coding agent and the hardware on your desk.</p>
          <div className="cta-row">
            <Button primary arrow href={README_START} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 1.5 }}>Get started</Button>
            <Button href="#story" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 1.6 }}>Explore Flashlink</Button>
          </div>
        </div>
        <div className="hero-tag mono" data-fade data-win="-1,0.3" data-scene="0">ESP32-WROOM-32<br /><span>development board</span></div>
        <div className="hero-scroll mono" data-fade>Scroll</div>
      </div>
    </section>
  )
}

/* ---------------- 02 · the moment it becomes real ---------------- */
const BEATS = [
  { w: [0, 0.2], h: "An instruction.", c: "Your AI agent asks for a flash.", where: "Your AI" },
  { w: [0.2, 0.42], h: "Built in the cloud.", c: "The sketch compiles remotely. Your PC never has to.", where: "Cloud" },
  { w: [0.42, 0.66], h: "Received by your PC.", c: "The Flashlink app on Windows picks the firmware up.", where: "Your PC" },
  { w: [0.66, 1.02], h: "Written over USB.", c: "Not by the cloud. By the app, with the right tool for the chip.", where: "USB" },
]
export function Story() {
  return (
    <section id="story" className="scene" data-scene="1">
      <div className="pin story">
        <header className="head"><span className="eyebrow mono">How it works</span><h2 className="h2">From a single instruction<br />to a physical result.</h2></header>
        <div className="where mono">
          {BEATS.map((b, i) => <span key={i} data-win={b.w.join(",")} data-scene="1" data-where>{b.where}</span>)}
        </div>
        <div className="beats">
          {BEATS.map((b, i) => (
            <div className="beat" key={i} data-win={b.w.join(",")} data-scene="1">
              <div className="beat-h">{b.h}</div>
              <p className="beat-c">{b.c}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------------- 03 · the product ---------------- */
export function Product() {
  return (
    <section id="product" className="scene product" data-scene="2">
      <div className="prod-head">
        <span className="eyebrow mono">The product</span>
        <h2 className="h2 wide">Everything connected.<br /><em>One conversation.</em></h2>
      </div>
      <div className="prod-stage">
        <figure className="fig f1" data-reveal="x">
          <div className="mask"><img src="/media/product-devices.webp" alt="Flashlink dashboard: connected boards with their chips, ports and names" width={2160} height={1350} loading="lazy" /></div>
          <figcaption className="mono">Every board, by the name you gave it.</figcaption>
        </figure>
        <figure className="fig f2" data-reveal="y">
          <div className="mask"><img src="/media/product-activity.webp" alt="Flashlink dashboard: activity log of builds and flashes" width={2160} height={1350} loading="lazy" /></div>
          <figcaption className="mono">Every job logged. Every verdict recorded.</figcaption>
        </figure>
        <figure className="fig f3" data-reveal="x">
          <div className="mask"><img src="/media/product-overview.webp" alt="Flashlink dashboard overview" width={2160} height={1350} loading="lazy" /></div>
          <figcaption className="mono">The bench at a glance.</figcaption>
        </figure>
        <figure className="fig f4" data-reveal="y">
          <div className="mask"><img src="/media/product-access.webp" alt="Flashlink dashboard: connector and access settings" width={2160} height={1350} loading="lazy" /></div>
          <figcaption className="mono">Connect an assistant once.</figcaption>
        </figure>
      </div>
      <p className="prod-note mono">Real dashboard, sample data.</p>
    </section>
  )
}

/* ---------------- 04 · built for real hardware ---------------- */
export function Hardware({ goStop }: { goStop: (i: number) => void }) {
  const i = useStop()
  const b = BOARDS[i]
  return (
    <section id="hardware" className="scene" data-scene="3">
      <div className="pin hw">
        <header className="head"><span className="eyebrow mono">Hardware</span><h2 className="h2">Made for the hardware<br />you already own.</h2></header>
        <nav className="hw-nav" aria-label="Boards">
          {BOARDS.map((x, n) => (
            <button key={x.name} className="hw-btn" aria-current={n === i} onClick={() => goStop(n)}>
              {x.name}
              {n === i && <motion.span className="hw-ind" layoutId="hw-ind" transition={{ duration: 0.4, ease }} />}
            </button>
          ))}
        </nav>
        <div className="hw-info">
          <AnimatePresence mode="wait">
            <motion.div key={b.name} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.45, ease }}>
              <div className="name">{b.name}</div>
              <div className="mono sub">{b.sub}</div>
              <div className={`tier t${b.tier}`}><i />{TIER[b.tier]}</div>
              <p className="note">{b.note}</p>
            </motion.div>
          </AnimatePresence>
          <p className="also mono">
            Also supported: ESP32-S2, S3 and C3, ESP8266 and Arduino Mega (implemented, awaiting validation), and CH32V003 (unit-tested only). <a href={DOCS_BOARDS} target="_blank" rel="noreferrer">Full list</a>
          </p>
        </div>
      </div>
    </section>
  )
}

/* ---------------- 05 · proof, not promise ---------------- */
const PHASES = [
  { w: [0.0, 0.24], h: "Sent.", c: "Firmware streams to your PC through memory. It is not stored." },
  { w: [0.24, 0.5], h: "Written.", c: "The desktop app flashes the chip." },
  { w: [0.5, 0.74], h: "Read back.", c: "The chip’s flash is read straight off the board." },
  { w: [0.74, 0.92], h: "Matched.", c: "SHA-256 of what was sent against what was read." },
]
export function Proof() {
  return (
    <section id="proof" className="scene" data-scene="4">
      <div className="pin proof">
        <header className="head"><span className="eyebrow mono">Verification</span><h2 className="h2">A flash isn’t finished<br />until it’s verified.</h2></header>
        <div className="phases">
          {PHASES.map((p, i) => (
            <div className="phase" key={i} data-at={p.w[0]} data-scene="4">
              <span className="st">{p.h}</span>
              <span className="mono cap">{p.c}</span>
            </div>
          ))}
          <div className="phase confirmed" data-at="0.93" data-scene="4">
            <span className="st">Confirmed.</span>
            <span className="mono cap">flash_confirmed: true</span>
          </div>
        </div>
        <div className="hash mono" aria-hidden="true" data-at="0.5" data-scene="4" data-show>
          <div><b>sent</b> <span data-hash="sent" data-from="0.5" data-to="0.7">{HASH_SENT}</span></div>
          <div><b>read</b> <span data-hash="read" data-from="0.76" data-to="0.9">{HASH_SENT}</span></div>
          <small>sample digest, for illustration</small>
        </div>
      </div>
    </section>
  )
}

/* ---------------- 06 · the final frame ---------------- */
export function Final() {
  return (
    <section id="final" className="scene" data-scene="5">
      <div className="pin final">
        <div className="final-copy">
          <h2 className="huge" data-final>
            <span className="ln"><Words text="Make your AI" /></span>
            <span className="ln"><span className="wi"><span className="w"><em>touch</em></span></span>{" "}<Words text="hardware." /></span>
          </h2>
          <p className="hero-sub" data-final-fade>Install the Windows app, add one connector, and ask for a flash.</p>
          <div className="cta-row" data-final-fade>
            <Button primary arrow href={README_START} target="_blank" rel="noreferrer">Get started</Button>
            <Button href={REPO} target="_blank" rel="noreferrer">View on GitHub</Button>
          </div>
        </div>
        <footer className="foot mono">
          <span>Flashlink · MIT licensed</span>
          <nav aria-label="Footer">
            <a href={DOCS} target="_blank" rel="noreferrer">Docs</a>
            <a href={DOCS_BOARDS} target="_blank" rel="noreferrer">Supported boards</a>
            <a href={DOCS_SECURITY} target="_blank" rel="noreferrer">Security</a>
            <a href="/login">Sign in</a>
          </nav>
        </footer>
      </div>
    </section>
  )
}
