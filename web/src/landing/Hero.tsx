import { motion } from "framer-motion"
import gsap from "gsap"
import { useLayoutEffect, useRef } from "react"
import { Button, ease } from "./ui"

const L1 = "From AI"
const L2 = "to actual hardware"

function Chars({ text }: { text: string }) {
  return (
    <>
      {text.split("").map((c, i) => (
        <span className="ch" key={i} aria-hidden="true">{c === " " ? " " : c}</span>
      ))}
    </>
  )
}

function Board() {
  const pins = Array.from({ length: 15 }, (_, i) => 24 + i * 18)
  return (
    <svg className="board-svg" viewBox="0 0 300 168" role="img" aria-label="Drawing of an ESP32 development board with a status LED">
      <g fill="none" stroke="var(--line-2)" strokeWidth="1">
        <rect x="1" y="1" width="298" height="166" rx="5" />
        <rect x="70" y="26" width="118" height="96" rx="2" stroke="var(--mute)" />
        <path d="M188 40h40v8h-34v8h34v8h-34v8h34v8h-34v8h34" stroke="var(--mute)" />
        <rect x="-4" y="62" width="30" height="44" rx="2" stroke="var(--mute)" />
        <rect x="236" y="130" width="14" height="14" rx="2" />
        <rect x="260" y="130" width="14" height="14" rx="2" />
      </g>
      {pins.map((x) => (
        <g key={x} fill="var(--dim)">
          <circle cx={x} cy="9" r="1.7" />
          <circle cx={x} cy="159" r="1.7" />
        </g>
      ))}
      <g fontFamily="var(--mono)" fontSize="8" fill="var(--mute)">
        <text x="78" y="62">ESP32-WROOM-32</text>
        <text x="78" y="76" fill="var(--dim)">Desk ESP32</text>
        <text x="30" y="88" fill="var(--dim)" fontSize="7">USB</text>
      </g>
      <circle className="led" cx="222" cy="104" r="4.5" stroke="var(--line-2)" strokeWidth="1" />
    </svg>
  )
}

export function Hero() {
  const root = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = root.current!
    const q = <T extends Element = HTMLElement>(s: string) => gsap.utils.toArray<T>(s, el)
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const ctx = gsap.context(() => {
      const logs = q(".log div:not(.rule)")
      const code = q(".code div")
      const verd = q(".verdict div")
      const stages = q(".stage")
      const board = el.querySelector(".board")
      const vertical = window.matchMedia("(max-width: 860px)").matches
      const axis = vertical ? "top" : "left"

      if (reduce) {
        gsap.set([logs, code, verd], { opacity: 1 })
        gsap.set(".link .fill", { scaleX: 1, scaleY: 1 })
        stages.forEach((s) => s.classList.add("on"))
        board?.classList.add("ok")
        return
      }

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } })
      tl.from(".ch", { yPercent: 115, duration: 1.1, ease: "power4.out", stagger: 0.022 }, 0.15)
        .from(".hero-copy p", { opacity: 0, y: 18, duration: 0.9 }, 0.75)
        .from(".rig", { opacity: 0, duration: 0.9 }, 0.95)

      const seq = gsap.timeline({ delay: 1.4, defaults: { ease: "power2.out" } })
      const travel = (n: number) => {
        const link = el.querySelectorAll(".link")[n]
        const dot = link.querySelector(".dot")
        const fill = link.querySelector(".fill")
        const t = gsap.timeline()
        t.set(dot, { opacity: 1, [axis]: "0%" })
          .to(dot, { [axis]: "100%", duration: 1.15, ease: "power1.inOut" }, 0)
          .to(fill, { [vertical ? "scaleY" : "scaleX"]: 1, duration: 1.15, ease: "power1.inOut" }, 0)
          .to(dot, { opacity: 0, duration: 0.2 }, ">-0.05")
        return t
      }

      seq
        .add(() => stages[0].classList.add("on"))
        .to(code, { opacity: 1, duration: 0.35, stagger: 0.32 })
        .add(travel(0), "+=0.2")
        .add(() => stages[1].classList.add("on"))
        .to(logs, { opacity: 1, duration: 0.3, stagger: 0.28 })
        .add(travel(1), "+=0.15")
        .add(() => stages[2].classList.add("on"))
        .to(verd[0], { opacity: 1, duration: 0.3 })
        .to(verd[1], { opacity: 1, duration: 0.3 }, "+=0.5")
        .to(verd[2], { opacity: 1, duration: 0.3 }, "+=0.55")
        .add(() => board?.classList.add("ok"))
        .to(verd[3], { opacity: 1, duration: 0.4 }, "+=0.1")
    }, el)
    return () => ctx.revert()
  }, [])

  return (
    <section className="hero" id="top" ref={root}>
      <div className="wrap">
        <h1 aria-label="From AI to actual hardware.">
          <span className="ln"><Chars text={L1} /></span>
          <span className="ln"><Chars text={L2} /><span className="ch" aria-hidden="true" style={{ color: "var(--accent)" }}>.</span></span>
        </h1>
        <div className="hero-copy">
          <p>
            An MCP-powered bridge between your AI coding agent and the microcontroller on your desk. <b>Compile in the cloud. Flash locally. Verify what actually happened.</b>
          </p>
          <div className="cta-row">
            <Button primary arrow href="#start" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 1.0 }}>Get started</Button>
            <Button href="#architecture" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 1.1 }}>Explore the architecture</Button>
          </div>
        </div>
      </div>

      <div className="rig" role="group" aria-label="Illustrated build and flash sequence">
        <div className="wrap">
          <div className="rig-grid">
            <div className="stage">
              <div className="stage-h"><i>01</i> Prompt</div>
              <div className="code">
                <div><span className="k">you</span>&nbsp; <span className="u">Blink the LED on my ESP32.</span></div>
                <div><span className="k">ai</span>&nbsp;&nbsp; list_devices</div>
                <div><span className="k">ai</span>&nbsp;&nbsp; build_and_flash</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;board: esp32-wroom-32</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;device: Desk ESP32</div>
              </div>
            </div>
            <div className="link" aria-hidden="true"><div className="fill" /><div className="dot" /></div>
            <div className="stage">
              <div className="stage-h"><i>02</i> Cloud build</div>
              <div className="log">
                <div>compiling sketch.ino</div>
                <div>linking for esp32-wroom-32</div>
                <div>bootloader.bin · partitions.bin · app.bin</div>
                <div><span className="ok">sha256 recorded per file</span></div>
                <div>relay: memory only, not stored</div>
              </div>
            </div>
            <div className="link" aria-hidden="true"><div className="fill" /><div className="dot" /></div>
            <div className="stage">
              <div className="stage-h"><i>03</i> Your desk</div>
              <div className="board"><Board /></div>
              <div className="verdict">
                <div>flashing over USB · esptool</div>
                <div>reading flash back</div>
                <div>sha256 matches</div>
                <div className="good">flash_confirmed: true</div>
              </div>
            </div>
          </div>
          <div className="rig-foot">
            <span>Illustrative sequence.</span>
            <span>A real job reports success only after the desktop app verifies it.</span>
          </div>
        </div>
      </div>
    </section>
  )
}
