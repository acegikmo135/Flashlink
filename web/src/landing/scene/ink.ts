import { addAfterEffect } from "@react-three/fiber"

/**
 * Auto text colour. The 3D canvas is sampled every few frames; every character of the overlay copy takes
 * light or dark ink from the pixels directly behind it (with hysteresis), so text stays readable even
 * where it crosses a bright module and a dark PCB on the same line.
 */
const CHAR_LEAVES = ".eyebrow, .h2, .where > span, .beat-h, .beat-c, .hw-btn, .name, .sub, .tier, .hw-info .note, .also, .phase .st, .phase .cap, .hero-sub, .hero-tag, .foot > span, .foot a, .nav .brand, .nav ul a"
const BLOCK_LEAVES = ".hero h1 .ln, .hero-scroll, .final h2 .ln, .hash > div, .hash small, .btn"

function split(el: HTMLElement) {
  if (el.dataset.split) return
  el.dataset.split = "1"
  const text = el.textContent ?? ""
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  nodes.forEach((node) => {
    const wrap = document.createElement("span")
    wrap.className = "ics"; wrap.setAttribute("aria-hidden", "true")
    for (const ch of node.data) {
      const s = document.createElement("span")
      s.className = "ic"; s.textContent = ch
      wrap.appendChild(s)
    }
    node.replaceWith(wrap)
  })
  const sr = document.createElement("span")
  sr.className = "sr-only"; sr.textContent = text
  el.prepend(sr)
}

export function startInk(gl: HTMLCanvasElement) {
  const c = document.createElement("canvas")
  const ctx = c.getContext("2d", { willReadFrequently: true })!
  const rng = document.createRange()
  let n = 0
  return addAfterEffect(() => {
    if (++n % 10) return
    const W = window.innerWidth, H = window.innerHeight
    const w = 256, h = Math.max(64, Math.round((256 * H) / W))
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, w, h)
    try { ctx.drawImage(gl, 0, 0, w, h) } catch { return }
    const d = ctx.getImageData(0, 0, w, h).data
    const lumAt = (r: { left: number; right: number; top: number; bottom: number }) => {
      const x0 = Math.max(0, Math.floor((r.left / W) * w)), x1 = Math.min(w, Math.max(x0 + 1, Math.ceil((r.right / W) * w)))
      const y0 = Math.max(0, Math.floor((r.top / H) * h)), y1 = Math.min(h, Math.max(y0 + 1, Math.ceil((r.bottom / H) * h)))
      let sum = 0, cnt = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255; cnt++ }
      return cnt ? sum / cnt : 0
    }
    document.querySelectorAll<HTMLElement>(CHAR_LEAVES).forEach(split)
    // ---- reads first (no layout thrash) ----
    const writes: [HTMLElement, boolean][] = []
    const visible = (el: HTMLElement) => { const w2 = el.closest<HTMLElement>("[data-win]"); return !(w2 && Number(w2.style.opacity || "1") < 0.05) }
    document.querySelectorAll<HTMLElement>(CHAR_LEAVES).forEach((leaf) => {
      if (!visible(leaf)) return
      const lr = leaf.getBoundingClientRect()
      if (lr.bottom < 0 || lr.top > H || lr.width === 0) return
      leaf.querySelectorAll<HTMLElement>(":scope .ic").forEach((ic) => {
        const r = ic.getBoundingClientRect()
        if (r.width === 0) return
        const lum = lumAt(r)
        const light = ic.dataset.tone === "light"
        if (!light && lum > 0.46) writes.push([ic, true]); else if (light && lum < 0.34) writes.push([ic, false])
      })
    })
    document.querySelectorAll<HTMLElement>(BLOCK_LEAVES).forEach((el) => {
      if (!visible(el)) return
      rng.selectNodeContents(el)
      const r = rng.getBoundingClientRect()
      if (r.bottom < 0 || r.top > H || r.width === 0) return
      const lum = lumAt(r), light = el.dataset.tone === "light"
      if (!light && lum > 0.5) writes.push([el, true]); else if (light && lum < 0.36) writes.push([el, false])
    })
    for (const [el, light] of writes) { if (light) el.dataset.tone = "light"; else delete el.dataset.tone }
  })
}
